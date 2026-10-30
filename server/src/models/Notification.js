import mongoose from 'mongoose'

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        'new_report',
        'high_priority_report',
        'report_accepted',
        'report_rejected',
        'collector_assigned',
        'report_work_started',
        'report_collected',
        'priority_raised',
        'report_overdue',
      ],
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
    },
    report: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WasteReport',
    },
    deduplicationKey: {
      type: String,
      required: true,
      maxlength: 180,
    },
    readAt: {
      type: Date,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
)

notificationSchema.index({ recipient: 1, createdAt: -1, _id: -1 })
notificationSchema.index({ deduplicationKey: 1 }, { unique: true })

const Notification = mongoose.model('Notification', notificationSchema)

export default Notification
