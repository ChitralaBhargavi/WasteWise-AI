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
  const user = await User.findOne({ email }).exec()
  if (!user) {
    throw new OperatorError('No existing account matches that email address.')
  }
  if (user.role === 'admin') {
    console.info(`Account ${user.email} already has the admin role.`)
    return
  }

  user.role = 'admin'
  await user.save()
  console.info(`Promoted existing account ${user.email} to admin.`)
}

try {
  await promoteExistingUser()
} catch (error) {
  console.error(error instanceof OperatorError
    ? error.message
    : 'Admin promotion failed; verify MongoDB availability and retry.')
  process.exitCode = 1
} finally {
  if (mongoose.connection.readyState !== 0) {
    await disconnectFromDatabase()
  }
}
