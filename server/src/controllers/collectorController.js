import mongoose from 'mongoose'
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { env } from '../config/env.js'
import CollectionRequest from '../models/CollectionRequest.js'
import { notifyRecipients } from '../services/notifications.js'
import WasteReport from '../models/WasteReport.js'
import { getReportTiming } from '../utils/reportPriority.js'

const defaultPageSize = 20
const maximumPageSize = 100
const safeReportSelection = [
  '_id',
  'reportedBy',
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
const allowedTransitions = new Map([
  ['reported', 'assigned'],
  ['assigned', 'in_progress'],
  ['in_progress', 'collected'],
])
const workflowStatuses = new Set(['assigned', 'in_progress', 'collected'])

export async function listAssignedReports(req, res) {
  const page = parsePositiveInteger(req.query.page, 1, 'page')
  const limit = parsePositiveInteger(req.query.limit, defaultPageSize, 'limit')

  if (limit > maximumPageSize) {
    throw createHttpError(400, `limit cannot be greater than ${maximumPageSize}.`)
  }

  const offset = (page - 1) * limit
  if (!Number.isSafeInteger(offset)) {
    throw createHttpError(400, 'The requested page is too large.')
  }

  const assignedReportIds = await CollectionRequest.distinct('wasteReport', {
    assignedCollector: new mongoose.Types.ObjectId(req.user.id),
    status: { $ne: 'cancelled' },
  }).exec()
  const filter = { _id: { $in: assignedReportIds }, reviewStatus: 'accepted' }
  const [reports, totalItems] = await Promise.all([
    WasteReport.find(filter)
      .select(safeReportSelection)
      .sort({ createdAt: -1, _id: -1 })
      .skip(offset)
      .limit(limit)
      .exec(),
    WasteReport.countDocuments(filter),
  ])

  res.status(200).json({
    data: reports.map(toCollectorReportResponse),
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
    },
  })
}

export async function getAssignedReportById(req, res) {
  const report = await findAssignedReport(req.params.id, req.user.id)
  res.status(200).json({ data: { report: toCollectorReportResponse(report) } })
}

export async function updateAssignedReportStatus(req, res) {
  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw createHttpError(400, 'Request body must be a JSON object.')
  }
  const fields = Object.keys(req.body)
  if (fields.length !== 1 || fields[0] !== 'status') {
    throw createHttpError(400, 'Request body may contain only the status field.')
  }
  if (typeof req.body.status !== 'string' || !workflowStatuses.has(req.body.status)) {
    throw createHttpError(400, 'status must be one of: assigned, in_progress, collected.')
  }

  const report = await findAssignedReport(req.params.id, req.user.id)
  const expectedNextStatus = allowedTransitions.get(report.status)
  if (req.body.status !== expectedNextStatus) {
    throw createHttpError(400, `A report with status "${report.status}" cannot transition to "${req.body.status}".`)
  }
  if (req.body.status === 'collected' && !req.file) {
    throw createHttpError(400, 'Upload an AFTER cleanup photo before marking this report collected.')
  }
  if (req.body.status !== 'collected' && req.file) {
    throw createHttpError(400, 'An AFTER cleanup photo can only be uploaded when marking the report collected.')
  }

  let afterImagePath
  if (req.file) {
    await mkdir(env.reportImageUploadDirectory, { recursive: true })
    const extensionByMimeType = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    }
    afterImagePath = `${randomUUID()}${extensionByMimeType[req.file.detectedMimeType]}`
    try {
      await writeFile(path.join(env.reportImageUploadDirectory, afterImagePath), req.file.buffer, {
        flag: 'wx',
        mode: 0o600,
      })
    } catch (error) {
      await removeUncommittedImage(afterImagePath)
      throw error
    }
  }

  const changedAt = new Date()
  let updated
  try {
    updated = await WasteReport.findOneAndUpdate(
      { _id: report._id, status: report.status, reviewStatus: 'accepted' },
      {
        $set: {
          status: req.body.status,
          ...(afterImagePath ? {
            afterImagePath,
            afterImageMimeType: req.file.detectedMimeType,
          } : {}),
        },
        $push: {
          statusHistory: {
            previousStatus: report.status,
            status: req.body.status,
            changedAt,
            changedBy: new mongoose.Types.ObjectId(req.user.id),
          },
          ...(afterImagePath ? {
            collectionProofHistory: {
              submittedAt: changedAt,
              submittedBy: new mongoose.Types.ObjectId(req.user.id),
            },
          } : {}),
        },
      },
      { returnDocument: 'after', runValidators: true },
    )
      .select(safeReportSelection)
      .exec()
  } catch (error) {
    await removeUncommittedImage(afterImagePath)
    throw error
  }

  if (!updated) {
    await removeUncommittedImage(afterImagePath)
    throw createHttpError(409, 'The report status changed before this update could be applied. Refresh and try again.')
  }

  if (req.body.status === 'in_progress' || req.body.status === 'collected') {
    const startedWork = req.body.status === 'in_progress'
    await notifyRecipients({
      recipientIds: [updated.reportedBy],
      type: startedWork ? 'report_work_started' : 'report_collected',
      title: startedWork ? 'Collection work started' : 'Report collected',
      message: startedWork
        ? 'A collector has started work on your report.'
        : 'Your reported waste has been collected.',
      reportId: updated._id,
      deduplicationKey: `report:${updated._id}:status:${req.body.status}`,
    })
  }

  res.status(200).json({ data: { report: toCollectorReportResponse(updated) } })
}

async function findAssignedReport(id, collectorId) {
  if (!mongoose.isObjectIdOrHexString(id)) {
    throw createHttpError(400, 'Report ID must be a valid MongoDB ObjectId.')
  }

  const assignment = await CollectionRequest.exists({
    wasteReport: new mongoose.Types.ObjectId(id),
    assignedCollector: new mongoose.Types.ObjectId(collectorId),
    status: { $ne: 'cancelled' },
  }).exec()

  if (!assignment) {
    throw createHttpError(404, 'Assigned waste report was not found.')
  }

  const report = await WasteReport.findById(id).select(safeReportSelection).exec()
  if (!report || report.reviewStatus !== 'accepted') {
    throw createHttpError(404, 'Assigned waste report was not found.')
  }

  return report
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

function toCollectorReportResponse(report) {
  const timing = getReportTiming(report)
  return {
    id: report._id.toString(),
    category: report.category,
    ...(report.description !== undefined ? { description: report.description } : {}),
    ...(report.location ? { location: report.location.toObject() } : {}),
    status: report.status,
    priority: timing.priority,
    dueAt: timing.dueAt,
    isOverdue: timing.isOverdue,
    reviewStatus: report.reviewStatus,
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

async function removeUncommittedImage(imagePath) {
  if (!imagePath) return
  try {
    await unlink(path.join(env.reportImageUploadDirectory, imagePath))
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to clean up an uncommitted collection proof image.')
    }
  }
}

function createHttpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}
