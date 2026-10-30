import mongoose from 'mongoose'

export function requireDatabaseConnection(_req, res, next) {
  if (mongoose.connection.readyState === 1) {
    next()
    return
  }

  res.status(503).json({
    error: {
      message: 'The database is temporarily unavailable.',
    },
  })
}
