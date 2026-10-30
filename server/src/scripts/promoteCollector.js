import mongoose from 'mongoose'
import { connectToDatabase, disconnectFromDatabase } from '../config/db.js'
import User from '../models/User.js'

const email = process.argv[2]?.trim().toLowerCase()

class OperatorError extends Error {}

async function promoteExistingUser() {
  if (process.argv.length !== 3 || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new OperatorError('Provide exactly one valid existing account email address.')
  }

  await connectToDatabase()
  const user = await User.findOne({ email }).select('_id email role').exec()
  if (!user) {
    throw new OperatorError('No existing account matches that email address.')
  }
  if (user.role === 'collector') {
    console.info(`Account ${user.email} already has the collector role.`)
    return
  }

  const result = await User.updateOne(
    { _id: user._id, email },
    { $set: { role: 'collector' } },
    { runValidators: true, timestamps: false },
  ).exec()
  if (result.matchedCount !== 1) {
    throw new OperatorError('No existing account matches that email address.')
  }

  console.info(`Promoted existing account ${user.email} to collector.`)
}

try {
  await promoteExistingUser()
} catch (error) {
  console.error(error instanceof OperatorError
    ? error.message
    : 'Collector promotion failed; verify MongoDB availability and retry.')
  process.exitCode = 1
} finally {
  if (mongoose.connection.readyState !== 0) {
    await disconnectFromDatabase()
  }
}
