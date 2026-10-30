import cors from 'cors'
import cookieParser from 'cookie-parser'
import express from 'express'
import { env } from './config/env.js'
import { errorHandler } from './middleware/errorHandler.js'
import { notFound } from './middleware/notFound.js'
import { requestLogger } from './middleware/requestLogger.js'
import { validateJsonBody } from './middleware/validateJsonBody.js'
import { csrfProtection } from './middleware/csrfProtection.js'
import apiRoutes from './routes/apiRoutes.js'

const app = express()

app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || env.corsOrigins.includes(origin)) {
      callback(null, true)
      return
    }

    const error = new Error('This origin is not allowed by the CORS policy.')
    error.status = 403
    callback(error)
  },
}))
app.use(requestLogger)
app.use(cookieParser())
app.use(express.json({ limit: '100kb' }))
app.use(validateJsonBody)
app.use(csrfProtection)
app.use('/api', apiRoutes)
app.use(notFound)
app.use(errorHandler)

export default app
