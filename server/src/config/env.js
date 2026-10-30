import dotenv from 'dotenv'
import path from 'node:path'

dotenv.config()

function parsePort(value) {
  const port = Number(value)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.')
  }
  return port
}

function parsePositiveInteger(name, value, { minimum, maximum }) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
  }
  return parsed
}

function parseReportDueHours() {
  return Object.freeze({
    low: parsePositiveInteger('REPORT_DUE_HOURS_LOW', process.env.REPORT_DUE_HOURS_LOW ?? '72', {
      minimum: 1,
      maximum: 8760,
    }),
    medium: parsePositiveInteger('REPORT_DUE_HOURS_MEDIUM', process.env.REPORT_DUE_HOURS_MEDIUM ?? '48', {
      minimum: 1,
      maximum: 8760,
    }),
    high: parsePositiveInteger('REPORT_DUE_HOURS_HIGH', process.env.REPORT_DUE_HOURS_HIGH ?? '24', {
      minimum: 1,
      maximum: 8760,
    }),
    urgent: parsePositiveInteger('REPORT_DUE_HOURS_URGENT', process.env.REPORT_DUE_HOURS_URGENT ?? '4', {
      minimum: 1,
      maximum: 8760,
    }),
  })
}

const corsOrigins = (process.env.CORS_ORIGINS ?? process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

if (corsOrigins.length === 0) {
  throw new Error('CORS_ORIGINS must contain at least one allowed origin.')
}

const frontendOrigins = (process.env.FRONTEND_ORIGIN ?? corsOrigins.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

if (frontendOrigins.length === 0) {
  throw new Error('FRONTEND_ORIGIN must contain at least one allowed origin.')
}

const jwtSecret = process.env.JWT_SECRET
if (!jwtSecret || jwtSecret.length < 32 || /^(replace|change-me|your-)/i.test(jwtSecret)) {
  throw new Error('JWT_SECRET must be a unique secret of at least 32 characters. Generate one before starting the API.')
}

const jwtExpiresInSeconds = Number(process.env.JWT_EXPIRES_IN_SECONDS ?? '900')
if (!Number.isInteger(jwtExpiresInSeconds) || jwtExpiresInSeconds < 60 || jwtExpiresInSeconds > 3600) {
  throw new Error('JWT_EXPIRES_IN_SECONDS must be an integer between 60 and 3600.')
}

const cookieSameSite = (process.env.COOKIE_SAME_SITE ?? 'lax').toLowerCase()
if (!['lax', 'strict', 'none'].includes(cookieSameSite)) {
  throw new Error('COOKIE_SAME_SITE must be lax, strict, or none.')
}

if (cookieSameSite === 'none' && process.env.NODE_ENV !== 'production') {
  throw new Error('COOKIE_SAME_SITE=none requires NODE_ENV=production and HTTPS.')
}

export const env = Object.freeze({
  port: parsePort(process.env.PORT ?? '3000'),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigins: Object.freeze(corsOrigins),
  frontendOrigins: Object.freeze(frontendOrigins),
  mongodbUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/wastewise_ai',
  mongodbDatabase: process.env.MONGODB_DB_NAME ?? (process.env.NODE_ENV === 'test' ? 'wastewise_ai_auth_test' : 'wastewise_ai'),
  jwtSecret,
  jwtIssuer: process.env.JWT_ISSUER ?? 'wastewise-ai-api',
  jwtAudience: process.env.JWT_AUDIENCE ?? 'wastewise-ai-client',
  jwtExpiresInSeconds,
  cookieSameSite,
  cookieSecure: process.env.NODE_ENV === 'production',
  authCookieName: process.env.AUTH_COOKIE_NAME ?? 'ww_access',
  csrfCookieName: process.env.CSRF_COOKIE_NAME ?? 'ww_csrf',
  aiServiceUrl: parseAiServiceUrl(process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8000'),
  aiUploadMaxBytes: parsePositiveInteger('AI_UPLOAD_MAX_BYTES', process.env.AI_UPLOAD_MAX_BYTES ?? '5242880', {
    minimum: 1024,
    maximum: 20971520,
  }),
  reportImageMaxBytes: parsePositiveInteger('REPORT_IMAGE_MAX_BYTES', process.env.REPORT_IMAGE_MAX_BYTES ?? '5242880', {
    minimum: 1024,
    maximum: 20971520,
  }),
  duplicateReportRadiusMeters: parsePositiveInteger(
    'DUPLICATE_REPORT_RADIUS_METERS',
    process.env.DUPLICATE_REPORT_RADIUS_METERS ?? '50',
    { minimum: 1, maximum: 1000 },
  ),
  reportImageUploadDirectory: path.resolve(process.env.REPORT_IMAGE_UPLOAD_DIR ?? 'uploads/reports'),
  reportDueHours: parseReportDueHours(),
  aiRequestTimeoutMs: parsePositiveInteger('AI_REQUEST_TIMEOUT_MS', process.env.AI_REQUEST_TIMEOUT_MS ?? '10000', {
    minimum: 100,
    maximum: 60000,
  }),
})

function parseAiServiceUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('AI_SERVICE_URL must be a valid HTTP or HTTPS URL.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('AI_SERVICE_URL must be an HTTP or HTTPS URL without credentials, a query, or a fragment.')
  }
  return url.toString().replace(/\/$/, '')
}
