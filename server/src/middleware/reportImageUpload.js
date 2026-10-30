import multer from 'multer'
import sharp from 'sharp'
import { env } from '../config/env.js'

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.reportImageMaxBytes,
    files: 1,
    fields: 3,
    parts: 4,
  },
})

export function receiveReportImage(req, res, next) {
  if (!req.is('multipart/form-data')) {
    next()
    return
  }

  upload.single('image')(req, res, (error) => {
    if (error) {
      next(error)
      return
    }

    if (req.file) {
      sanitizeImage(req.file)
        .then((sanitizedImage) => {
          req.file.buffer = sanitizedImage.buffer
          req.file.detectedMimeType = sanitizedImage.mimeType
          next()
        })
        .catch(next)
      return
    }

    next()
  })
}

async function sanitizeImage(file) {
  let metadata
  try {
    metadata = await sharp(file.buffer, { failOn: 'error', limitInputPixels: 25_000_000 }).metadata()
  } catch {
    throw createUploadError(415, 'Upload a valid JPEG, PNG, or WebP image.')
  }

  const mimeTypeByFormat = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  }
  const mimeType = mimeTypeByFormat[metadata.format]
  if (!mimeType || mimeType !== file.mimetype || !allowedMimeTypes.has(mimeType)) {
    throw createUploadError(415, 'Upload a valid JPEG, PNG, or WebP image.')
  }

  let sanitizedBuffer
  try {
    const outputOptions = mimeType === 'image/jpeg'
      ? { quality: 85 }
      : mimeType === 'image/webp'
        ? { quality: 85 }
        : { compressionLevel: 9 }
    sanitizedBuffer = await sharp(file.buffer, {
      failOn: 'error',
      limitInputPixels: 25_000_000,
    })
      .rotate()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .toFormat(metadata.format, outputOptions)
      .toBuffer()
  } catch {
    throw createUploadError(415, 'The uploaded file could not be decoded as a supported image.')
  }
  if (sanitizedBuffer.length > env.reportImageMaxBytes) {
    throw createUploadError(413, 'The processed image exceeds the configured size limit.')
  }
  return { buffer: sanitizedBuffer, mimeType }
}

function createUploadError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}
