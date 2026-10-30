import mongoose from 'mongoose'

const locationSchema = new mongoose.Schema(
  {
    address: {
      type: String,
      trim: true,
      maxlength: 300,
    },
    latitude: {
      type: Number,
      min: -90,
      max: 90,
    },
    longitude: {
      type: Number,
      min: -180,
      max: 180,
    },
  },
  {
    _id: false,
  },
)

const statusHistorySchema = new mongoose.Schema(
  {
    previousStatus: {
      type: String,
      enum: ['reported', 'assigned', 'in_progress', 'collected', 'verified'],
    },
    status: {
      type: String,
      required: true,
      enum: ['reported', 'assigned', 'in_progress', 'collected', 'verified'],
    },
    changedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    _id: false,
  },
)

const reviewHistorySchema = new mongoose.Schema(
  {
    decision: {
      type: String,
      required: true,
      enum: ['accepted', 'rejected'],
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    reviewedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { _id: false },
)

const collectionProofHistorySchema = new mongoose.Schema(
  {
    submittedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { _id: false },
)

const wasteReportSchema = new mongoose.Schema(
  {
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    category: {
      type: String,
      required: true,
      enum: ['plastic', 'paper', 'metal', 'glass', 'organic', 'other'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    location: {
      type: locationSchema,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    status: {
      type: String,
      enum: ['reported', 'assigned', 'in_progress', 'collected', 'verified'],
      default: 'reported',
    },
    reviewStatus: {
      type: String,
      enum: ['pending_review', 'accepted', 'rejected'],
      default: 'pending_review',
    },
    reviewHistory: {
      type: [reviewHistorySchema],
      default: [],
    },
    collectionProofHistory: {
      type: [collectionProofHistorySchema],
      default: [],
    },
    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },
    imagePath: {
      type: String,
      trim: true,
    },
    imageMimeType: {
      type: String,
      enum: ['image/jpeg', 'image/png', 'image/webp'],
    },
    afterImagePath: {
      type: String,
      trim: true,
    },
    afterImageMimeType: {
      type: String,
      enum: ['image/jpeg', 'image/png', 'image/webp'],
    },
  },
  {
    timestamps: true,
  },
)

wasteReportSchema.index({ reportedBy: 1, createdAt: -1 })
wasteReportSchema.index({ category: 1 })
wasteReportSchema.index({ reviewStatus: 1, status: 1, createdAt: -1 })

const WasteReport = mongoose.model('WasteReport', wasteReportSchema)

export default WasteReport
