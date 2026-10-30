import mongoose from 'mongoose'
import CollectionRequest from '../models/CollectionRequest.js'
import Notification from '../models/Notification.js'
import User from '../models/User.js'
import WasteReport from '../models/WasteReport.js'
import { overdueExpression } from '../utils/reportPriority.js'

export async function notifyRecipients({
  recipientIds,
  type,
  title,
  message,
  reportId,
  deduplicationKey,
}) {
  const uniqueRecipientIds = [...new Set(recipientIds.map((id) => id?.toString()).filter(Boolean))]
  await Promise.all(uniqueRecipientIds.map(async (recipientId) => {
    try {
      await Notification.updateOne(
        { deduplicationKey: `${deduplicationKey}:recipient:${recipientId}` },
        {
          $setOnInsert: {
            recipient: new mongoose.Types.ObjectId(recipientId),
            type,
            title,
            message,
            ...(reportId ? { report: new mongoose.Types.ObjectId(reportId) } : {}),
            deduplicationKey: `${deduplicationKey}:recipient:${recipientId}`,
          },
        },
        { upsert: true, runValidators: true },
      ).exec()
    } catch (error) {
      console.warn(`Unable to create in-app notification (${error.name ?? 'Error'}).`)
    }
  }))
}

export async function notifyAdmins(notification) {
  try {
    const adminIds = await User.distinct('_id', { role: 'admin' }).exec()
    await notifyRecipients({ ...notification, recipientIds: adminIds })
  } catch (error) {
    console.warn(`Unable to find in-app notification recipients (${error.name ?? 'Error'}).`)
  }
}

export async function notifyAssignedCollector(reportId, notification) {
  try {
    const assignment = await CollectionRequest.findOne({
      wasteReport: reportId,
      status: { $ne: 'cancelled' },
      assignedCollector: { $exists: true },
    })
      .select('assignedCollector')
      .sort({ createdAt: -1, _id: -1 })
      .exec()
    if (assignment?.assignedCollector) {
      await notifyRecipients({
        ...notification,
        recipientIds: [assignment.assignedCollector],
        deduplicationKey: `${notification.deduplicationKey}:collector:${assignment._id}`,
      })
    }
  } catch (error) {
    console.warn(`Unable to find in-app notification recipients (${error.name ?? 'Error'}).`)
  }
}

export async function createOverdueNotificationsForUser(user) {
  try {
    const recipientId = new mongoose.Types.ObjectId(user.id)
    let reportFilter
    if (user.role === 'citizen') {
      reportFilter = { reportedBy: recipientId }
    } else if (user.role === 'collector') {
      const reportIds = await CollectionRequest.distinct('wasteReport', {
        assignedCollector: recipientId,
        status: { $ne: 'cancelled' },
      }).exec()
      reportFilter = { _id: { $in: reportIds }, reviewStatus: 'accepted' }
    } else {
      return
    }

    const overdueReports = WasteReport.find({
      ...reportFilter,
      $expr: overdueExpression(new Date()),
    })
      .select('_id')
      .lean()
      .cursor()

    for await (const report of overdueReports) {
      const isCitizen = user.role === 'citizen'
      await notifyRecipients({
        recipientIds: [recipientId],
        type: 'report_overdue',
        title: 'Report past its service target',
        message: isCitizen
          ? 'One of your reports has passed its service target and still needs attention.'
          : 'An assigned report has passed its service target and still needs attention.',
        reportId: report._id,
        deduplicationKey: `report:${report._id}:overdue`,
      })
    }
  } catch (error) {
    console.warn(`Unable to check for overdue report notifications (${error.name ?? 'Error'}).`)
  }
}
