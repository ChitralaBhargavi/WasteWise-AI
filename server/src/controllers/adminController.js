import mongoose from 'mongoose'
import CollectionRequest from '../models/CollectionRequest.js'
import User from '../models/User.js'
import WasteReport from '../models/WasteReport.js'
import {
  notifyAdmins,
  notifyAssignedCollector,
  notifyRecipients,
} from '../services/notifications.js'
import { getReportTiming, overdueExpression, reportPriorities } from '../utils/reportPriority.js'

const defaultPageSize = 20
const maximumPageSize = 100
const roles = new Set(['citizen', 'collector', 'admin'])
const statuses = new Set(['reported', 'assigned', 'in_progress', 'collected', 'verified'])
const reviewStatuses = new Set(['pending_review', 'accepted', 'rejected'])
const categories = new Set(['plastic', 'paper', 'metal', 'glass', 'organic', 'other'])
const activeAssignmentStatuses = { $ne: 'cancelled' }
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
const exportReportSelection = [
  '_id',
  'reportedBy',
  'category',
  'description',
  'location',
  'status',
  'priority',
  'reviewStatus',
  'reviewHistory',
  'createdAt',
  'updatedAt',
].join(' ')

export async function getOverview(_req, res) {
  const now = new Date()
  const firstDay = new Date()
  firstDay.setUTCHours(0, 0, 0, 0)
  firstDay.setUTCDate(firstDay.getUTCDate() - 29)
  const [
    totalUsers,
    citizens,
    collectors,
    totalReports,
    pendingReviewReports,
    activeReports,
    overdueReports,
    urgentHighReports,
    reportsByStatus,
    reportsByReviewStatus,
    reportsByCategory,
    reportActivity,
    activeAssignments,
    cancelledAssignments,
    unassignedReportCountResult,
    collectorWorkload,
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ role: 'citizen' }),
    User.countDocuments({ role: 'collector' }),
    WasteReport.countDocuments({}),
    WasteReport.countDocuments({
      $or: [{ reviewStatus: 'pending_review' }, { reviewStatus: { $exists: false } }],
    }),
    WasteReport.countDocuments({
      status: { $in: ['assigned', 'in_progress'] },
      reviewStatus: { $ne: 'rejected' },
    }),
    WasteReport.countDocuments({ $expr: overdueExpression(now) }),
    WasteReport.countDocuments({
      priority: { $in: ['high', 'urgent'] },
      status: { $nin: ['collected', 'verified'] },
      reviewStatus: { $ne: 'rejected' },
    }),
    WasteReport.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    WasteReport.aggregate([
      { $group: { _id: { $ifNull: ['$reviewStatus', 'pending_review'] }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    WasteReport.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    WasteReport.aggregate([
      { $match: { createdAt: { $type: 'date', $gte: firstDay } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    CollectionRequest.countDocuments({ status: activeAssignmentStatuses }),
    CollectionRequest.countDocuments({ status: 'cancelled' }),
    WasteReport.aggregate([
      { $match: { status: 'reported', reviewStatus: 'accepted' } },
      {
        $lookup: {
          from: CollectionRequest.collection.name,
          let: { reportId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$wasteReport', '$$reportId'] },
                status: activeAssignmentStatuses,
              },
            },
            { $limit: 1 },
            { $project: { _id: 1 } },
          ],
          as: 'activeAssignments',
        },
      },
      { $match: { 'activeAssignments.0': { $exists: false } } },
      { $count: 'count' },
    ]),
    CollectionRequest.aggregate([
      { $match: { status: activeAssignmentStatuses, assignedCollector: { $exists: true } } },
      { $group: { _id: '$assignedCollector', activeAssignments: { $sum: 1 } } },
      {
        $lookup: {
          from: User.collection.name,
          localField: '_id',
          foreignField: '_id',
          as: 'collector',
        },
      },
      { $unwind: { path: '$collector', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          collectorId: { $toString: '$_id' },
          name: '$collector.name',
          email: '$collector.email',
          activeAssignments: 1,
        },
      },
      { $sort: { activeAssignments: -1, name: 1 } },
    ]),
  ])

  const unassignedEligibleReports = unassignedReportCountResult[0]?.count ?? 0
  const dailyCounts = new Map(reportActivity.map((entry) => [entry._id, entry.count]))
  const reportsOverLast30Days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(firstDay)
    date.setUTCDate(date.getUTCDate() + index)
    const dateKey = date.toISOString().slice(0, 10)
    return { date: dateKey, count: dailyCounts.get(dateKey) ?? 0 }
  })

  res.status(200).json({
    data: {
      users: { total: totalUsers, citizens, collectors },
      reports: {
        total: totalReports,
        pendingReview: pendingReviewReports,
        active: activeReports,
        overdue: overdueReports,
        urgentOrHigh: urgentHighReports,
        byStatus: reportsByStatus.map(({ _id, count }) => ({ status: _id, count })),
        byReviewStatus: reportsByReviewStatus.map(({ _id, count }) => ({ status: _id, count })),
        byCategory: reportsByCategory.map(({ _id, count }) => ({ category: _id, count })),
        unassignedEligible: unassignedEligibleReports,
        createdPerDayLast30Days: reportsOverLast30Days,
      },
      collectionRequests: { active: activeAssignments, cancelled: cancelledAssignments },
      collectorWorkload,
    },
  })
}

export async function listReports(req, res) {
  const now = new Date()
  const page = parsePage(req.query)
  const filter = parseReportFilter(req.query, now)

  const [reports, totalItems] = await Promise.all([
    WasteReport.find(filter)
      .select(safeReportSelection)
      .populate('reportedBy', 'name email role')
      .sort({ createdAt: -1, _id: -1 })
      .skip(page.offset)
      .limit(page.limit)
      .exec(),
    WasteReport.countDocuments(filter),
  ])
  const reportIds = reports.map((report) => report._id)
  const assignments = await CollectionRequest.find({
    wasteReport: { $in: reportIds },
    status: activeAssignmentStatuses,
  })
    .select('wasteReport assignedCollector status createdAt')
    .populate('assignedCollector', 'name email role')
    .exec()
  const assignmentByReport = new Map(assignments.map((assignment) => [
    assignment.wasteReport.toString(),
    toAssignmentSummary(assignment),
  ]))

  res.status(200).json({
    data: reports.map((report) => toAdminReportSummary(report, assignmentByReport.get(report.id), now)),
    pagination: pagination(page, totalItems),
  })
}

export async function exportReports(req, res) {
  const now = new Date()
  const filter = parseReportFilter(req.query, now)
  const reports = await WasteReport.find(filter)
    .select(exportReportSelection)
    .populate('reportedBy', 'name email')
    .sort({ createdAt: -1, _id: -1 })
    .lean()
    .exec()
  const reportIds = reports.map((report) => report._id)
  const assignments = reportIds.length
    ? await CollectionRequest.find({
        wasteReport: { $in: reportIds },
        status: activeAssignmentStatuses,
      })
      .select('wasteReport assignedCollector createdAt _id')
      .populate('assignedCollector', 'name')
      .sort({ createdAt: -1, _id: -1 })
      .lean()
      .exec()
    : []
  const assignmentByReport = new Map()
  for (const assignment of assignments) {
    const reportId = assignment.wasteReport.toString()
    if (!assignmentByReport.has(reportId)) {
      assignmentByReport.set(reportId, assignment)
    }
  }
  const headers = [
    'report_id',
    'category',
    'status',
    'review_status',
    'rejection_reason',
    'reviewed_at',
    'priority',
    'due_at',
    'overdue',
    'description',
    'location_address',
    'latitude',
    'longitude',
    'citizen_name',
    'citizen_email',
    'assigned_collector',
    'created_at',
    'updated_at',
  ].map(toCsvCell).join(',')
  const rows = reports.map((report) => {
    const assignment = assignmentByReport.get(report._id.toString())
    const citizen = report.reportedBy
    const collector = assignment?.assignedCollector
    const timing = getReportTiming(report, now)
    return [
      report._id,
      report.category,
      report.status,
      report.reviewStatus ?? 'pending_review',
      report.reviewHistory?.at(-1)?.reason,
      report.reviewHistory?.at(-1)?.reviewedAt,
      timing.priority,
      timing.dueAt,
      timing.isOverdue,
      report.description,
      report.location?.address,
      report.location?.latitude,
      report.location?.longitude,
      citizen?.name,
      citizen?.email,
      collector?.name,
      report.createdAt,
      report.updatedAt,
    ].map(toCsvCell).join(',')
  })

  res
    .status(200)
    .set({
      'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="wastewise-reports.csv"',
      'Content-Type': 'text/csv; charset=utf-8',
    })
    .send([headers, ...rows].join('\r\n'))
}

export async function getReportById(req, res) {
  const id = validateObjectId(req.params.id, 'Report')
  const report = await WasteReport.findById(id)
    .select(safeReportSelection)
    .populate('reportedBy', 'name email role')
    .populate('reviewHistory.reviewedBy', 'name email role')
    .exec()
  if (!report) {
    throw createHttpError(404, 'Waste report was not found.')
  }

  const assignments = await CollectionRequest.find({ wasteReport: id })
    .select('wasteReport assignedCollector status notes createdAt updatedAt')
    .populate('assignedCollector', 'name email role')
    .sort({ createdAt: -1 })
    .exec()

  res.status(200).json({
    data: {
      report: {
        ...toAdminReportSummary(report),
        statusHistory: (report.statusHistory ?? []).map((entry) => ({
          ...(entry.previousStatus ? { previousStatus: entry.previousStatus } : {}),
          status: entry.status,
          changedAt: entry.changedAt,
          changedBy: entry.changedBy?.toString(),
        })),
        reviewHistory: (report.reviewHistory ?? []).map((entry) => ({
          decision: entry.decision,
          ...(entry.reason ? { reason: entry.reason } : {}),
          reviewedAt: entry.reviewedAt,
          reviewedBy: entry.reviewedBy?._id
            ? toSafeUser(entry.reviewedBy)
            : null,
        })),
        collectionProofHistory: (report.collectionProofHistory ?? []).map((entry) => ({
          submittedAt: entry.submittedAt,
          submittedBy: entry.submittedBy?.toString(),
        })),
        assignments: assignments.map(toAssignmentSummary),
      },
    },
  })
}

export async function updateReportPriority(req, res) {
  const reportId = validateObjectId(req.params.id, 'Report')
  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw createHttpError(400, 'Request body must be a JSON object.')
  }
  const fields = Object.keys(req.body)
  if (fields.length !== 1 || fields[0] !== 'priority') {
    throw createHttpError(400, 'Request body may contain only the priority field.')
  }
  if (typeof req.body.priority !== 'string' || !reportPriorities.includes(req.body.priority)) {
    throw createHttpError(400, 'priority must be low, medium, high, or urgent.')
  }

  const previousReport = await WasteReport.findById(reportId).select('priority').exec()
  if (!previousReport) {
    throw createHttpError(404, 'Waste report was not found.')
  }

  const report = await WasteReport.findByIdAndUpdate(
    reportId,
    { $set: { priority: req.body.priority } },
    { returnDocument: 'after', runValidators: true },
  )
    .select(safeReportSelection)
    .exec()
  if (!report) {
    throw createHttpError(404, 'Waste report was not found.')
  }
  const previousPriority = previousReport.priority ?? 'medium'
  const priorityRank = { low: 0, medium: 1, high: 2, urgent: 3 }
  if (report.priority !== previousPriority
    && priorityRank[report.priority] > priorityRank[previousPriority]
    && ['high', 'urgent'].includes(report.priority)) {
    const notification = {
      type: 'priority_raised',
      title: 'Report priority raised',
      message: `A report's priority was raised to ${report.priority}.`,
      reportId: report._id,
      deduplicationKey: `report:${report._id}:priority-raised:${report.priority}`,
    }
    await notifyAdmins(notification)
    await notifyAssignedCollector(report._id, notification)
  }
  res.status(200).json({ data: { report: toAdminReportSummary(report) } })
}

export async function reviewReport(req, res) {
  const reportId = validateObjectId(req.params.id, 'Report')
  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw createHttpError(400, 'Request body must be a JSON object.')
  }

  const { decision, reason } = req.body
  const expectedFields = decision === 'rejected' ? ['decision', 'reason'] : ['decision']
  if (Object.keys(req.body).length !== expectedFields.length
    || expectedFields.some((field) => !Object.hasOwn(req.body, field))) {
    throw createHttpError(400, decision === 'rejected'
      ? 'A rejection must include only decision and reason.'
      : 'An acceptance must include only decision.')
  }
  if (!['accepted', 'rejected'].includes(decision)) {
    throw createHttpError(400, 'decision must be accepted or rejected.')
  }
  if (decision === 'rejected'
    && (typeof reason !== 'string' || reason.trim().length === 0 || reason.trim().length > 500)) {
    throw createHttpError(400, 'A rejection reason between 1 and 500 characters is required.')
  }

  const changedAt = new Date()
  const update = await WasteReport.findOneAndUpdate(
    { _id: reportId, reviewStatus: 'pending_review' },
    {
      $set: { reviewStatus: decision },
      $push: {
        reviewHistory: {
          decision,
          ...(decision === 'rejected' ? { reason: reason.trim() } : {}),
          reviewedAt: changedAt,
          reviewedBy: new mongoose.Types.ObjectId(req.user.id),
        },
      },
    },
    { returnDocument: 'after', runValidators: true },
  )
    .select(`${safeReportSelection} reportedBy`)
    .populate('reportedBy', 'name email role')
    .populate('reviewHistory.reviewedBy', 'name email role')
    .exec()

  if (!update) {
    const exists = await WasteReport.exists({ _id: reportId }).exec()
    if (!exists) {
      throw createHttpError(404, 'Waste report was not found.')
    }
    throw createHttpError(409, 'Only a report pending review can be accepted or rejected.')
  }

  const summary = toAdminReportSummary(update)
  await notifyRecipients({
    recipientIds: [update.reportedBy?._id ?? update.reportedBy],
    type: decision === 'accepted' ? 'report_accepted' : 'report_rejected',
    title: decision === 'accepted' ? 'Report accepted' : 'Report rejected',
    message: decision === 'accepted'
      ? 'Your waste report has been accepted for collection.'
      : 'Your waste report was rejected after review.',
    reportId: update._id,
    deduplicationKey: `report:${update._id}:review:${decision}`,
  })
  summary.reviewHistory = (update.reviewHistory ?? []).map((entry) => ({
    decision: entry.decision,
    ...(entry.reason ? { reason: entry.reason } : {}),
    reviewedAt: entry.reviewedAt,
    reviewedBy: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
    },
  }))
  res.status(200).json({ data: { report: summary } })
}

export async function listUsers(req, res) {
  const page = parsePage(req.query)
  const filter = {}
  if (req.query.role !== undefined) {
    if (typeof req.query.role !== 'string' || !roles.has(req.query.role)) {
      throw createHttpError(400, 'role must be citizen, collector, or admin.')
    }
    filter.role = req.query.role
  }
  const [users, totalItems] = await Promise.all([
    User.find(filter)
      .select('_id name email role createdAt')
      .sort({ createdAt: -1, _id: -1 })
      .skip(page.offset)
      .limit(page.limit)
      .exec(),
    User.countDocuments(filter),
  ])

  res.status(200).json({
    data: users.map(toSafeUser),
    pagination: pagination(page, totalItems),
  })
}

export async function listCollectors(_req, res) {
  const collectors = await User.find({ role: 'collector' })
    .select('_id name email role')
    .sort({ name: 1, _id: 1 })
    .exec()
  res.status(200).json({ data: collectors.map(toSafeUser) })
}

export async function listAssignments(req, res) {
  const page = parsePage(req.query)
  const filter = {}
  if (req.query.status !== undefined) {
    if (typeof req.query.status !== 'string'
      || !['pending', 'assigned', 'in_progress', 'collected', 'cancelled'].includes(req.query.status)) {
      throw createHttpError(400, 'status is not a supported collection request status.')
    }
    filter.status = req.query.status
  }
  const [assignments, totalItems] = await Promise.all([
    CollectionRequest.find(filter)
      .select('wasteReport assignedCollector status notes createdAt updatedAt')
      .populate({ path: 'assignedCollector', select: 'name email role' })
      .populate({
        path: 'wasteReport',
        select: 'category status createdAt',
      })
      .sort({ createdAt: -1, _id: -1 })
      .skip(page.offset)
      .limit(page.limit)
      .exec(),
    CollectionRequest.countDocuments(filter),
  ])

  res.status(200).json({
    data: assignments.map(toAssignmentSummary),
    pagination: pagination(page, totalItems),
  })
}

export async function assignReport(req, res) {
  const reportId = validateObjectId(req.params.id, 'Report')
  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw createHttpError(400, 'Request body must be a JSON object.')
  }
  const keys = Object.keys(req.body)
  if (keys.length !== 1 || keys[0] !== 'collectorId') {
    throw createHttpError(400, 'Request body may contain only collectorId.')
  }
  const collectorId = validateObjectId(req.body.collectorId, 'Collector')
  if (collectorId === req.user.id) {
    throw createHttpError(400, 'An administrator cannot assign a report to their own account.')
  }

  const collector = await User.findOne({ _id: collectorId, role: 'collector' })
    .select('_id name email role')
    .exec()
  if (!collector) {
    throw createHttpError(400, 'The selected account is not an eligible collector.')
  }

  const report = await WasteReport.findById(reportId)
    .select('_id reportedBy status reviewStatus statusHistory')
    .exec()
  if (!report) {
    throw createHttpError(404, 'Waste report was not found.')
  }
  if (report.status !== 'reported') {
    throw createHttpError(409, 'Only reports with status "reported" can be assigned.')
  }
  if (report.reviewStatus !== 'accepted') {
    throw createHttpError(409, 'Only accepted reports can be assigned to a collector.')
  }

  await CollectionRequest.init()
  const existingAssignment = await CollectionRequest.exists({
    wasteReport: report._id,
    status: activeAssignmentStatuses,
  }).exec()
  if (existingAssignment) {
    throw createHttpError(409, 'This report already has an active assignment.')
  }

  const assignment = await CollectionRequest.create({
    wasteReport: report._id,
    assignedCollector: collector._id,
    status: 'assigned',
    activeAssignmentKey: report._id,
  })

  const changedAt = new Date()
  const updatedReport = await WasteReport.findOneAndUpdate(
    { _id: report._id, status: 'reported', reviewStatus: 'accepted' },
    {
      $set: { status: 'assigned' },
      $push: {
        statusHistory: {
          previousStatus: 'reported',
          status: 'assigned',
          changedAt,
          changedBy: new mongoose.Types.ObjectId(req.user.id),
        },
      },
    },
    { returnDocument: 'after', runValidators: true },
  ).exec()

  if (!updatedReport) {
    await CollectionRequest.deleteOne({ _id: assignment._id }).exec()
    throw createHttpError(409, 'The report changed before it could be assigned. Refresh and try again.')
  }

  await notifyRecipients({
    recipientIds: [report.reportedBy],
    type: 'collector_assigned',
    title: 'Collector assigned',
    message: 'A collector has been assigned to your accepted report.',
    reportId: report._id,
    deduplicationKey: `report:${report._id}:assignment:${assignment._id}:citizen`,
  })
  await notifyRecipients({
    recipientIds: [collector._id],
    type: 'collector_assigned',
    title: 'New report assigned',
    message: 'A waste report has been assigned to you.',
    reportId: report._id,
    deduplicationKey: `report:${report._id}:assignment:${assignment._id}:collector`,
  })

  res.status(201).json({
    data: {
      assignment: toAssignmentSummary(await CollectionRequest.findById(assignment._id)
        .populate('assignedCollector', 'name email role')
        .populate({ path: 'wasteReport', select: 'category status createdAt' })
        .exec()),
      report: { id: updatedReport._id.toString(), status: updatedReport.status },
    },
  })
}

function parsePage(query) {
  const pageNumber = parsePositiveInteger(query.page, 1, 'page')
  const limit = parsePositiveInteger(query.limit, defaultPageSize, 'limit')
  if (limit > maximumPageSize) {
    throw createHttpError(400, `limit cannot be greater than ${maximumPageSize}.`)
  }
  const offset = (pageNumber - 1) * limit
  if (!Number.isSafeInteger(offset)) {
    throw createHttpError(400, 'The requested page is too large.')
  }
  return { page: pageNumber, limit, offset }
}

function parseReportFilter(query, now = new Date()) {
  const filter = {}
  if (query.status !== undefined) {
    if (typeof query.status !== 'string' || !statuses.has(query.status)) {
      throw createHttpError(400, 'status is not a supported report status.')
    }
    filter.status = query.status
  }
  if (query.category !== undefined) {
    if (typeof query.category !== 'string' || !categories.has(query.category)) {
      throw createHttpError(400, 'category is not a supported waste category.')
    }
    filter.category = query.category
  }
  if (query.reviewStatus !== undefined) {
    if (typeof query.reviewStatus !== 'string' || !reviewStatuses.has(query.reviewStatus)) {
      throw createHttpError(400, 'reviewStatus is not a supported report review status.')
    }
    filter.reviewStatus = query.reviewStatus
  }
  if (query.priority !== undefined) {
    if (typeof query.priority !== 'string' || !reportPriorities.includes(query.priority)) {
      throw createHttpError(400, 'priority is not a supported report priority.')
    }
    filter.priority = query.priority === 'medium'
      ? { $in: ['medium', null] }
      : query.priority
  }
  if (query.overdue !== undefined) {
    if (typeof query.overdue !== 'string' || !['true', 'false'].includes(query.overdue)) {
      throw createHttpError(400, 'overdue must be true or false.')
    }
    filter.$expr = { $eq: [overdueExpression(now), query.overdue === 'true'] }
  }
  return filter
}

function toCsvCell(value) {
  if (value === undefined || value === null) return '""'
  const text = value instanceof Date ? value.toISOString() : String(value)
  const safeText = typeof value === 'string' && ['=', '+', '-', '@'].includes(value.trimStart()[0])
    ? `'${value}`
    : text
  return `"${safeText.replaceAll('"', '""')}"`
}

function parsePositiveInteger(value, fallback, label) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw createHttpError(400, `${label} must be a positive integer.`)
  }
  const result = Number(value)
  if (!Number.isSafeInteger(result)) {
    throw createHttpError(400, `${label} must be a safe positive integer.`)
  }
  return result
}

function validateObjectId(value, label) {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createHttpError(400, `${label} ID must be a valid MongoDB ObjectId.`)
  }
  return new mongoose.Types.ObjectId(value)
}

function toSafeUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    ...(user.createdAt ? { createdAt: user.createdAt } : {}),
  }
}

function toAdminReportSummary(report, assignment, now = new Date()) {
  const owner = report.reportedBy && typeof report.reportedBy === 'object'
    ? toSafeUser(report.reportedBy)
    : null
  const timing = getReportTiming(report, now)
  return {
    id: report._id.toString(),
    category: report.category,
    ...(report.description !== undefined ? { description: report.description } : {}),
    ...(report.location ? { location: report.location.toObject?.() ?? report.location } : {}),
    status: report.status,
    priority: timing.priority,
    dueAt: timing.dueAt,
    isOverdue: timing.isOverdue,
    reviewStatus: report.reviewStatus ?? 'pending_review',
    ...(report.reviewHistory?.length ? {
      reviewHistory: report.reviewHistory.map((entry) => ({
        decision: entry.decision,
        ...(entry.reason ? { reason: entry.reason } : {}),
        reviewedAt: entry.reviewedAt,
      })),
    } : {}),
    ...(report.imagePath ? { imageUrl: `/reports/${report._id.toString()}/image` } : {}),
    ...(report.afterImagePath ? { afterImageUrl: `/reports/${report._id.toString()}/image?variant=after` } : {}),
    ...(owner ? { citizen: owner } : { citizen: null }),
    ...(assignment ? { assignment } : {}),
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  }
}

function toAssignmentSummary(assignment) {
  const collector = assignment.assignedCollector
  const report = assignment.wasteReport
  return {
    id: assignment._id.toString(),
    status: assignment.status,
    ...(assignment.notes ? { notes: assignment.notes } : {}),
    collector: collector?._id ? toSafeUser(collector) : null,
    report: report && report.category !== undefined
      ? {
          id: report._id.toString(),
          category: report.category,
          status: report.status,
          createdAt: report.createdAt,
        }
      : { id: report?.toString?.() ?? null },
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
  }
}

function pagination(page, totalItems) {
  return {
    page: page.page,
    limit: page.limit,
    totalItems,
    totalPages: Math.ceil(totalItems / page.limit),
  }
}

function createHttpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}
