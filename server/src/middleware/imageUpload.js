import multer from 'multer'
import { env } from '../config/env.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.aiUploadMaxBytes,
    files: 1,
    fields: 0,
    parts: 1,
  },
})

export function receiveImage(req, res, next) {
  upload.single('image')(req, res, (error) => {
    if (error) {
      next(error)
      return
    }

    if (!req.file) {
      const missingFileError = new Error('A multipart image file is required in the image field.')
      missingFileError.status = 400
      next(missingFileError)
      return
    }

    req.file.detectedMimeType = detectImageMimeType(req.file.buffer)
    if (!req.file.detectedMimeType) {
      const invalidImageError = new Error('Upload a valid JPEG, PNG, or WebP image.')
      invalidImageError.status = 415
      next(invalidImageError)
      return
    }

    next()
  })
}

function detectImageMimeType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png'
  }
  if (
    buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}
