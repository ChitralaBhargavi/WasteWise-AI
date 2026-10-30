import mongoose from 'mongoose'
import Notification from '../models/Notification.js'
import { createOverdueNotificationsForUser } from '../services/notifications.js'

const defaultPageSize = 20
const maximumPageSize = 50

export async function listNotifications(req, res) {
  validateQuery(req.query)
  const page = parsePositiveInteger(req.query.page, 1, 'page')
  const limit = parsePositiveInteger(req.query.limit, defaultPageSize, 'limit')
  if (limit > maximumPageSize) {
    throw createHttpError(400, `limit cannot be greater than ${maximumPageSize}.`)
  }
  const offset = (page - 1) * limit
  if (!Number.isSafeInteger(offset)) {
    throw createHttpError(400, 'The requested page is too large.')
  }

  await createOverdueNotificationsForUser(req.user)
  const recipient = new mongoose.Types.ObjectId(req.user.id)
  const [notifications, totalItems, unreadCount] = await Promise.all([
    Notification.find({ recipient })
      .select('_id type title message report createdAt readAt')
      .sort({ createdAt: -1, _id: -1 })
      .skip(offset)
      .limit(limit)
      .lean()
      .exec(),
    Notification.countDocuments({ recipient }),
    Notification.countDocuments({ recipient, readAt: { $exists: false } }),
  ])

  res.status(200).json({
    data: notifications.map(toNotificationResponse),
    unreadCount,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
    },
  })
}

export async function markNotificationRead(req, res) {
  validateEmptyRequestBody(req.body)
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    throw createHttpError(400, 'Notification ID must be a valid MongoDB ObjectId.')
  }
  const recipient = new mongoose.Types.ObjectId(req.user.id)
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient, readAt: { $exists: false } },
    { $set: { readAt: new Date() } },
    { returnDocument: 'after', runValidators: true },
  )
    .select('_id type title message report createdAt readAt')
    .lean()
    .exec()

  if (notification) {
    res.status(200).json({ data: { notification: toNotificationResponse(notification) } })
    return
  }
  const alreadyRead = await Notification.findOne({ _id: req.params.id, recipient })
    .select('_id type title message report createdAt readAt')
    .lean()
    .exec()
  if (!alreadyRead) {
    throw createHttpError(404, 'Notification was not found.')
  }
  res.status(200).json({ data: { notification: toNotificationResponse(alreadyRead) } })
}

export async function markAllNotificationsRead(req, res) {
  validateEmptyRequestBody(req.body)
  const result = await Notification.updateMany(
    { recipient: new mongoose.Types.ObjectId(req.user.id), readAt: { $exists: false } },
    { $set: { readAt: new Date() } },
  ).exec()
  res.status(200).json({ data: { updatedCount: result.modifiedCount } })
}

function toNotificationResponse(notification) {
  return {
    id: notification._id.toString(),
    type: notification.type,
    title: notification.title,
    message: notification.message,
    ...(notification.report ? { reportId: notification.report.toString() } : {}),
    createdAt: notification.createdAt,
    ...(notification.readAt ? { readAt: notification.readAt } : {}),
    isRead: Boolean(notification.readAt),
  }
}

function validateQuery(query) {
  const allowedKeys = new Set(['page', 'limit'])
  for (const key of Object.keys(query)) {
    if (!allowedKeys.has(key)) {
      throw createHttpError(400, `Unsupported query parameter: ${key}.`)
    }
  }
}

function validateEmptyRequestBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
    throw createHttpError(400, 'Notification read requests must have an empty JSON object body.')
  }
}

function parsePositiveInteger(value, fallback, label) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw createHttpError(400, `${label} must be a positive integer.`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw createHttpError(400, `${label} must be a safe positive integer.`)
  }
  return parsed
}

function createHttpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}
