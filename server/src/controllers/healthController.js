import mongoose from 'mongoose'
import { env } from '../config/env.js'

export async function getHealth(_req, res) {
  const databaseConnected = mongoose.connection.readyState === 1
  const ai = await getAiReadiness()

  res.status(200).json({
    status: databaseConnected ? 'ok' : 'degraded',
    message: 'WasteWise API is running.',
    timestamp: new Date().toISOString(),
    database: {
      status: databaseConnected ? 'connected' : 'disconnected',
    },
    ai,
  })
}

async function getAiReadiness() {
  try {
    const response = await fetch(`${env.aiServiceUrl}/health`, {
      signal: AbortSignal.timeout(Math.min(env.aiRequestTimeoutMs, 1500)),
    })
    if (!response.ok) {
      return { service: 'unavailable', model: 'unknown' }
    }
    const payload = await response.json()
    if (payload?.status !== 'ok' || typeof payload.model?.ready !== 'boolean') {
      return { service: 'unavailable', model: 'unknown' }
    }
    return {
      service: 'available',
      model: payload.model.ready ? 'ready' : 'not_ready',
    }
  } catch {
    return { service: 'unavailable', model: 'unknown' }
  }
}
