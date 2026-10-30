import mongoose from 'mongoose'
import { env } from './env.js'

let listenersRegistered = false
let connectionPromise
let hasConnected = false
let intentionalDisconnect = false

export async function connectToDatabase() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection
  }

  if (connectionPromise) {
    return connectionPromise
  }

  if (!listenersRegistered) {
    mongoose.connection.on('connected', () => {
      hasConnected = true
      console.info(`MongoDB connected to database "${env.mongodbDatabase}".`)
    })

    mongoose.connection.on('disconnected', () => {
      if (hasConnected && !intentionalDisconnect) {
        console.error('MongoDB connection was lost. Database-backed requests are unavailable.')
      }
    })

    mongoose.connection.on('error', (error) => {
      console.error(`MongoDB connection error (${error.name}).`)
    })

    listenersRegistered = true
  }

  const pendingConnection = mongoose.connect(env.mongodbUri, {
    dbName: env.mongodbDatabase,
  }).then(() => mongoose.connection)
  connectionPromise = pendingConnection

  try {
    return await pendingConnection
  } finally {
    connectionPromise = undefined
  }
}

export async function disconnectFromDatabase() {
  intentionalDisconnect = true
  try {
    await mongoose.disconnect()
  } finally {
    intentionalDisconnect = false
  }
}
