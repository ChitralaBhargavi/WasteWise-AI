import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import mongoose from 'mongoose'
import { env } from '../config/env.js'
import CollectionRequest from '../models/CollectionRequest.js'
import WasteReport from '../models/WasteReport.js'

export async function getAuthorizedReportImage(req, res, next) {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    throw createHttpError(400, 'Report ID must be a valid MongoDB ObjectId.')
  }

  const report = await WasteReport.findById(req.params.id)
    .select('_id reportedBy reviewStatus imagePath imageMimeType afterImagePath afterImageMimeType')
    .exec()
  const variant = req.query.variant ?? 'before'
  if (!['before', 'after'].includes(variant)) {
    throw createHttpError(400, 'Image variant must be before or after.')
  }
  const imagePathReference = variant === 'after' ? report?.afterImagePath : report?.imagePath
  const imageMimeType = variant === 'after' ? report?.afterImageMimeType : report?.imageMimeType
  if (!report || !imagePathReference || !imageMimeType) {
    throw createHttpError(404, 'Report image was not found.')
  }

  if (req.user.role === 'citizen' && report.reportedBy.toString() !== req.user.id) {
    throw createHttpError(404, 'Report image was not found.')
  }
  if (req.user.role === 'collector') {
    const assignment = await CollectionRequest.exists({
      wasteReport: report._id,
      assignedCollector: new mongoose.Types.ObjectId(req.user.id),
      status: { $ne: 'cancelled' },
    }).exec()
    const accepted = await WasteReport.exists({ _id: report._id, reviewStatus: 'accepted' }).exec()
    if (!assignment || !accepted) {
      throw createHttpError(404, 'Report image was not found.')
    }
  }
  if (!['citizen', 'collector', 'admin'].includes(req.user.role)) {
    throw createHttpError(403, 'You are not authorized to access this resource.')
  }

  const filename = path.basename(imagePathReference)
  if (filename !== imagePathReference || !/^[0-9a-f-]+\.(jpg|png|webp)$/.test(filename)) {
    throw createHttpError(500, 'The report image reference is invalid.')
  }
  const imagePath = path.join(env.reportImageUploadDirectory, filename)
  try {
    const imageStat = await stat(imagePath)
    if (!imageStat.isFile()) {
      throw createHttpError(404, 'Report image was not found.')
    }
    res
      .status(200)
      .set({
        'Cache-Control': 'private, no-store',
        'Content-Length': String(imageStat.size),
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Type': imageMimeType,
        'X-Content-Type-Options': 'nosniff',
      })
    createReadStream(imagePath).on('error', next).pipe(res)
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw createHttpError(404, 'Report image was not found.')
    }
    throw error
  }
}

function createHttpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}
