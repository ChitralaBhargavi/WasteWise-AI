import mongoose from 'mongoose'
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { env } from '../config/env.js'
import WasteReport from '../models/WasteReport.js'
import { notifyAdmins } from '../services/notifications.js'
import { findDuplicateReport, isReportOwner, withReportCreationLock } from '../services/duplicateReports.js'
import { getReportTiming } from '../utils/reportPriority.js'

const categories = new Set(['plastic', 'paper', 'metal', 'glass', 'organic', 'other'])
const reportFields = new Set(['category', 'description', 'location', 'image'])
const locationFields = new Set(['address', 'latitude', 'longitude'])
const defaultPageSize = 20
const maximumPageSize = 100
const safeReportSelection = [
  '_id',
  'category',
  'description',
  'location',
  'status',
  'priority',
  'reviewStatus',
  'reviewHistory',
  'collectionProofHistory',
  'statusHistory',
  'imagePath',
  'imageMimeType',
  'afterImagePath',
  'afterImageMimeType',
  'createdAt',
  'updatedAt',
].join(' ')

export async function createReport(req, res) {
  const input = validateReportInput(req.body)
  let imagePath
  if (req.file) {
    await mkdir(env.reportImageUploadDirectory, { recursive: true })
    const extensionByMimeType = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    }
    imagePath = `${randomUUID()}${extensionByMimeType[req.file.detectedMimeType]}`
    await writeFile(path.join(env.reportImageUploadDirectory, imagePath), req.file.buffer, {
      flag: 'wx',
      mode: 0o600,
    })
  }

  try {
    const report = await withReportCreationLock(async () => {
      const duplicate = await findDuplicateReport({
        category: input.category,
        location: input.location,
      })
      if (duplicate) {
        const beingHandled = ['assigned', 'in_progress'].includes(duplicate.status)
        const message = beingHandled
          ? 'A similar waste report already exists at this location and has already been assigned for collection. Please check the existing report instead of submitting a duplicate.'
          : !duplicate.reviewStatus || duplicate.reviewStatus === 'pending_review'
            ? 'A similar report has already been submitted at this location and is awaiting review.'
            : 'A similar waste report already exists at this location and has been accepted for collection.'
        const error = createHttpError(409, message)
        error.duplicate = {
          existingReport: {
            ...(isReportOwner(duplicate, req.user.id) ? { id: duplicate._id.toString() } : {}),
            status: duplicate.status,
            reviewStatus: duplicate.reviewStatus,
          },
        }
        throw error
      }

      return WasteReport.create({
        ...input,
        reportedBy: req.user.id,
        status: 'reported',
        reviewStatus: 'pending_review',
        ...(imagePath ? { imagePath, imageMimeType: req.file.detectedMimeType } : {}),
        statusHistory: [{
          status: 'reported',
          changedAt: new Date(),
          changedBy: req.user.id,
        }],
      })
    })
    await notifyAdmins({
      type: 'new_report',
      title: 'New citizen report',
      message: 'A new waste report is waiting for administrative review.',
      reportId: report._id,
      deduplicationKey: `report:${report._id}:submitted`,
    })
    if (['high', 'urgent'].includes(report.priority)) {
      await notifyAdmins({
        type: 'high_priority_report',
        title: 'High-priority report created',
        message: `A new ${report.priority}-priority waste report needs attention.`,
        reportId: report._id,
        deduplicationKey: `report:${report._id}:high-priority-created`,
      })
    }
    res.status(201).json({ data: { report: toReportResponse(report) } })
  } catch (error) {
    if (imagePath) {
      await unlink(path.join(env.reportImageUploadDirectory, imagePath))
    }
    throw error
  }
}

export async function listMyReports(req, res) {
  const page = parsePositiveInteger(req.query.page, 1, 'page')
  const limit = parsePositiveInteger(req.query.limit, defaultPageSize, 'limit')

  if (limit > maximumPageSize) {
    throw createHttpError(400, `limit cannot be greater than ${maximumPageSize}.`)
  }

  const offset = (page - 1) * limit
  if (!Number.isSafeInteger(offset)) {
    throw createHttpError(400, 'The requested page is too large.')
  }

  const ownerId = new mongoose.Types.ObjectId(req.user.id)
  const [reports, totalItems] = await Promise.all([
    WasteReport.find({ reportedBy: ownerId })
      .select(safeReportSelection)
      .sort({ createdAt: -1, _id: -1 })
      .skip(offset)
      .limit(limit)
      .exec(),
    WasteReport.countDocuments({ reportedBy: ownerId }),
  ])

  res.status(200).json({
    data: reports.map(toReportResponse),
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
    },
  })
}

export async function getMyReportById(req, res) {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    throw createHttpError(400, 'Report ID must be a valid MongoDB ObjectId.')
  }

  const report = await WasteReport.findOne({
    _id: req.params.id,
    reportedBy: new mongoose.Types.ObjectId(req.user.id),
  })
    .select(safeReportSelection)
    .exec()

  if (!report) {
    throw createHttpError(404, 'Waste report was not found.')
  }

  res.status(200).json({ data: { report: toReportResponse(report) } })
}

function validateReportInput(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw createHttpError(400, 'Request body must be a JSON object.')
  }

  const normalizedBody = { ...body }
  if (typeof normalizedBody.location === 'string') {
    try {
      normalizedBody.location = JSON.parse(normalizedBody.location)
    } catch {
      throw createHttpError(400, 'location must contain valid JSON.')
    }
  }
  if (normalizedBody.image !== undefined) {
    throw createHttpError(400, 'image must be uploaded as a multipart file.')
  }
  rejectUnknownFields(normalizedBody, reportFields, 'Request')

  if (typeof normalizedBody.category !== 'string' || !categories.has(normalizedBody.category)) {
    throw createHttpError(400, 'category must be one of: plastic, paper, metal, glass, organic, other.')
  }

  const reportData = { category: normalizedBody.category }

  if (normalizedBody.description !== undefined) {
    if (typeof normalizedBody.description !== 'string') {
      throw createHttpError(400, 'description must be a string.')
    }
    if (normalizedBody.description.length > 500) {
      throw createHttpError(400, 'description cannot exceed 500 characters.')
    }
    reportData.description = normalizedBody.description.trim()
  }

  if (normalizedBody.location !== undefined) {
    reportData.location = validateLocation(normalizedBody.location)
  }

  return reportData
}

function validateLocation(location) {
  if (location === null || typeof location !== 'object' || Array.isArray(location)) {
    throw createHttpError(400, 'location must be a JSON object.')
  }

  rejectUnknownFields(location, locationFields, 'location')
  const result = {}

  if (location.address !== undefined) {
    if (typeof location.address !== 'string' || location.address.trim().length > 300) {
      throw createHttpError(400, 'location.address must be a string of at most 300 characters.')
    }
    result.address = location.address.trim()
  }

  validateCoordinate(location.latitude, result, 'latitude', -90, 90)
  validateCoordinate(location.longitude, result, 'longitude', -180, 180)
  if ((result.latitude === undefined) !== (result.longitude === undefined)) {
    throw createHttpError(400, 'location.latitude and location.longitude must be provided together.')
  }

  return result
}

function validateCoordinate(value, destination, field, minimum, maximum) {
  if (value === undefined) {
    return
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw createHttpError(400, `location.${field} must be a number between ${minimum} and ${maximum}.`)
  }
  destination[field] = value
}

function rejectUnknownFields(value, allowedFields, label) {
  const unsupportedField = Object.keys(value).find((field) => !allowedFields.has(field))
  if (unsupportedField) {
    throw createHttpError(400, `${label} contains an unsupported field: ${unsupportedField}.`)
  }
}

function parsePositiveInteger(value, fallback, label) {
  if (value === undefined) {
    return fallback
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw createHttpError(400, `${label} must be a positive integer.`)
  }

  const result = Number(value)
  if (!Number.isSafeInteger(result)) {
    throw createHttpError(400, `${label} must be a safe positive integer.`)
  }
  return result
}

function toReportResponse(report) {
  const timing = getReportTiming(report)
  return {
    id: report._id.toString(),
    category: report.category,
    ...(report.description !== undefined ? { description: report.description } : {}),
    ...(report.location ? { location: report.location.toObject() } : {}),
    status: report.status,
    reviewStatus: report.reviewStatus,
    serviceStatus: citizenServiceStatus(report, timing.isOverdue),
    isOverdue: timing.isOverdue,
    reviewHistory: (report.reviewHistory ?? []).map((entry) => ({
      decision: entry.decision,
      ...(entry.reason ? { reason: entry.reason } : {}),
      reviewedAt: entry.reviewedAt,
    })),
    ...(report.imagePath ? { imageUrl: `/reports/${report._id.toString()}/image` } : {}),
    ...(report.afterImagePath ? { afterImageUrl: `/reports/${report._id.toString()}/image?variant=after` } : {}),
    collectionProofHistory: (report.collectionProofHistory ?? []).map((entry) => ({
      submittedAt: entry.submittedAt,
    })),
    statusHistory: (report.statusHistory ?? []).map((entry) => ({
      ...(entry.previousStatus ? { previousStatus: entry.previousStatus } : {}),
      status: entry.status,
      changedAt: entry.changedAt,
    })),
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  }
}

function citizenServiceStatus(report, isOverdue) {
  if (isOverdue) return 'attention_needed'
  if (report.status === 'assigned' || report.status === 'in_progress') return 'being_handled'
  if (report.status === 'collected' || report.status === 'verified') return 'collection_complete'
  if (report.reviewStatus === 'rejected') return 'report_rejected'
  if (!report.reviewStatus || report.reviewStatus === 'pending_review') return 'under_review'
  return 'report_received'
}

function createHttpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}
