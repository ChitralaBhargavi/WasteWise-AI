import mongoose from 'mongoose'

const collectionRequestSchema = new mongoose.Schema(
  {
    wasteReport: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WasteReport',
      required: true,
    },
    assignedCollector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    activeAssignmentKey: {
      type: mongoose.Schema.Types.ObjectId,
      select: false,
    },
    status: {
      type: String,
      enum: ['pending', 'assigned', 'in_progress', 'collected', 'cancelled'],
      default: 'pending',
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
  },
)

collectionRequestSchema.index({ assignedCollector: 1, status: 1 })
collectionRequestSchema.index(
  { activeAssignmentKey: 1 },
  { unique: true, sparse: true },
)

const CollectionRequest = mongoose.model('CollectionRequest', collectionRequestSchema)

export default CollectionRequest
