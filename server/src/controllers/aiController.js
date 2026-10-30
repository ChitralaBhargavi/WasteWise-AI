import { Blob } from 'node:buffer'
import { env } from '../config/env.js'

const categories = new Set(['plastic', 'paper', 'metal', 'glass', 'organic', 'other'])
const maximumResponseBytes = 64 * 1024

export async function classifyImage(req, res, next) {
  try {
    const form = new FormData()
    form.set('image', new Blob([req.file.buffer], { type: req.file.detectedMimeType }), 'upload')

    let upstream
    try {
      upstream = await fetch(`${env.aiServiceUrl}/api/classify`, {
        method: 'POST',
        body: form,
        redirect: 'error',
        signal: AbortSignal.timeout(env.aiRequestTimeoutMs),
      })
    } catch (error) {
      res.status(error.name === 'TimeoutError' ? 504 : 503).json({
        error: {
          code: error.name === 'TimeoutError' ? 'ai_service_timeout' : 'ai_service_unavailable',
          message: error.name === 'TimeoutError'
            ? 'The AI classification service did not respond in time.'
            : 'The AI classification service is unavailable.',
        },
      })
      return
    }

    if (!upstream.ok) {
      const status = upstream.status === 400 || upstream.status === 413 || upstream.status === 415
        ? upstream.status
        : upstream.status === 503
          ? 503
          : 502
      const messages = {
        400: 'The uploaded image could not be decoded.',
        413: 'The uploaded image exceeds the configured size limit.',
        415: 'Upload a JPEG, PNG, or WebP image.',
        503: 'The AI classification model is not ready.',
        502: 'The AI classification service returned an invalid response.',
      }
      res.status(status).json({
        error: {
          code: status === 503 ? 'model_not_ready' : status === 502 ? 'ai_upstream_error' : 'invalid_image',
          message: messages[status],
        },
      })
      return
    }

    const payload = await readJsonResponse(upstream)
    const result = validateClassification(payload)
    if (!result) {
      res.status(502).json({
        error: {
          code: 'ai_upstream_error',
          message: 'The AI classification service returned an invalid response.',
        },
      })
      return
    }

    res.status(200).json({
      data: {
        ...result,
        confidence_note: 'Softmax scores are not calibrated probabilities and do not guarantee correctness.',
        disposal_guidance: null,
      },
    })
  } catch (error) {
    next(error)
  }
}

async function readJsonResponse(response) {
  if (!response.body) {
    return null
  }
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maximumResponseBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

function validateClassification(payload) {
  if (
    payload === null
    || typeof payload !== 'object'
    || payload.inference_success !== true
    || !categories.has(payload.predicted_category)
    || !isUnitInterval(payload.confidence)
    || typeof payload.model_name !== 'string'
    || payload.model_name.length < 1
    || payload.model_name.length > 100
    || typeof payload.model_version !== 'string'
    || payload.model_version.length < 1
    || payload.model_version.length > 100
    || hasControlCharacters(payload.model_name)
    || hasControlCharacters(payload.model_version)
    || payload.probabilities === null
    || typeof payload.probabilities !== 'object'
  ) {
    return null
  }

  const entries = Object.entries(payload.probabilities)
  if (
    entries.length !== categories.size
    || entries.some(([category, value]) => !categories.has(category) || !isUnitInterval(value))
    || Math.abs(entries.reduce((sum, [, value]) => sum + value, 0) - 1) > 0.02
  ) {
    return null
  }
  const probabilities = Object.fromEntries(entries)
  const highestProbability = Math.max(...Object.values(probabilities))
  if (
    Math.abs(probabilities[payload.predicted_category] - payload.confidence) > 0.02
    || highestProbability - payload.confidence > 0.02
  ) return null

  return {
    inference_success: true,
    predicted_category: payload.predicted_category,
    confidence: payload.confidence,
    probabilities,
    model_name: payload.model_name,
    model_version: payload.model_version,
  }
}

function isUnitInterval(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function hasControlCharacters(value) {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code < 32 || code === 127) return true
  }
  return false
}
