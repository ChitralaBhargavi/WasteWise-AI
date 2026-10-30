import app from './app.js'
import { env } from './config/env.js'
import { connectToDatabase, disconnectFromDatabase } from './config/db.js'

async function startServer() {
  await connectToDatabase()

  app.listen(env.port, () => {
    console.info(`WasteWise API listening on http://localhost:${env.port}`)
  })
}

startServer().catch(async (error) => {
  console.error(`Unable to start WasteWise API because the initial MongoDB connection failed (${error.name}).`)
  try {
    await disconnectFromDatabase()
  } catch (disconnectError) {
    console.error(`Unable to clean up the failed MongoDB connection (${disconnectError.name}).`)
  }
  process.exitCode = 1
})
