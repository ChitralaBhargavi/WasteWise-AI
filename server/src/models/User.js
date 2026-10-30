import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

export const passwordHashRounds = 12

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ['citizen', 'collector', 'admin'],
      default: 'citizen',
    },
  },
  {
    timestamps: true,
  },
)

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('passwordHash')) {
    return
  }

  this.passwordHash = await bcrypt.hash(this.passwordHash, passwordHashRounds)
})

const User = mongoose.model('User', userSchema)

export default User
