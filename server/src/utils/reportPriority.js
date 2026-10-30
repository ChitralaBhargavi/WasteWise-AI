import { env } from '../config/env.js'

export const reportPriorities = ['low', 'medium', 'high', 'urgent']

export function getReportTiming(report, now = new Date()) {
  const priority = reportPriorities.includes(report.priority) ? report.priority : 'medium'
  const createdAt = report.createdAt instanceof Date
    ? report.createdAt
    : typeof report.createdAt === 'string' || typeof report.createdAt === 'number'
      ? new Date(report.createdAt)
      : null
  const validCreatedAt = createdAt && Number.isFinite(createdAt.getTime())
  const dueAt = validCreatedAt
    ? new Date(createdAt.getTime() + env.reportDueHours[priority] * 60 * 60 * 1000)
    : null
  const completed = ['collected', 'verified'].includes(report.status) || report.reviewStatus === 'rejected'

  return {
    priority,
    dueAt,
    isOverdue: Boolean(dueAt && !completed && dueAt.getTime() <= now.getTime()),
  }
}

export function overdueExpression(now = new Date()) {
  const createdAt = {
    $convert: {
      input: '$createdAt',
      to: 'date',
      onError: null,
      onNull: null,
    },
  }
  const dueAt = {
    $dateAdd: {
      startDate: createdAt,
      unit: 'hour',
      amount: {
        $switch: {
          branches: [
            { case: { $eq: ['$priority', 'low'] }, then: env.reportDueHours.low },
            { case: { $eq: ['$priority', 'high'] }, then: env.reportDueHours.high },
            { case: { $eq: ['$priority', 'urgent'] }, then: env.reportDueHours.urgent },
          ],
          default: env.reportDueHours.medium,
        },
      },
    },
  }

  return {
    $cond: [
      {
        $and: [
          { $eq: [{ $type: createdAt }, 'date'] },
          { $ne: ['$status', 'collected'] },
          { $ne: ['$status', 'verified'] },
          { $ne: ['$reviewStatus', 'rejected'] },
        ],
      },
      { $lte: [dueAt, now] },
      false,
    ],
  }
}
