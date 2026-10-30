import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import sharp from 'sharp'
import request from 'supertest'

const frontendOrigin = 'http://localhost:5173'
const testDatabaseName = 'wastewise_ai_auth_test'
const testJwtSecret = randomBytes(48).toString('base64url')
const cookieHeaderName = 'ww_access'
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const validPng = await sharp({
  create: { width: 1, height: 1, channels: 3, background: '#00ff00' },
}).png().toBuffer()
const validAiResponse = {
  inference_success: true,
  predicted_category: 'plastic',
  confidence: 0.9,
  probabilities: {
    plastic: 0.9,
    paper: 0.02,
    metal: 0.02,
    glass: 0.02,
    organic: 0.02,
    other: 0.02,
  },
  model_name: 'test-model',
  model_version: 'test-version',
}

let app
let connectToDatabase
let mongoose
let User
let WasteReport
let CollectionRequest
let Notification
let env
let getReportTiming
let requireRole
let requireAuth
let aiMock
let aiMockMode = 'response'
let aiMockResponse = { status: 200, body: validAiResponse }
let aiMockModelReady = false
let lastAiRequestContentType
let lastAiRequestBody
let testImageDirectory
let duplicateReportCitizen
let duplicateReportOtherCitizen

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wastewise_ai_auth_test'
process.env.MONGODB_DB_NAME = testDatabaseName
process.env.FRONTEND_ORIGIN = frontendOrigin
process.env.JWT_SECRET = testJwtSecret
process.env.AI_UPLOAD_MAX_BYTES = '1024'
process.env.AI_REQUEST_TIMEOUT_MS = '300'
process.env.REPORT_IMAGE_MAX_BYTES = '1024'
process.env.DUPLICATE_REPORT_RADIUS_METERS = '50'
process.env.REPORT_DUE_HOURS_LOW = '72'
process.env.REPORT_DUE_HOURS_MEDIUM = '48'
process.env.REPORT_DUE_HOURS_HIGH = '24'
process.env.REPORT_DUE_HOURS_URGENT = '4'
testImageDirectory = await mkdtemp(path.join(tmpdir(), 'wastewise-report-images-'))
process.env.REPORT_IMAGE_UPLOAD_DIR = testImageDirectory

before(async () => {
  aiMock = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', model: { ready: aiMockModelReady } }))
      return
    }

    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      lastAiRequestContentType = req.headers['content-type']
      lastAiRequestBody = Buffer.concat(chunks)

      if (aiMockMode === 'close') {
        req.socket.destroy()
        return
      }
      if (aiMockMode === 'delay') {
        setTimeout(() => {
          if (!res.destroyed) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(aiMockResponse.body))
          }
        }, 800)
        return
      }
      res.writeHead(aiMockResponse.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(aiMockResponse.body))
    })
  })
  await new Promise((resolve) => aiMock.listen(0, '127.0.0.1', resolve))
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${aiMock.address().port}`

  ;({ default: mongoose } = await import('mongoose'))
  ;({ connectToDatabase } = await import('../config/db.js'))
  ;({ default: User } = await import('../models/User.js'))
  ;({ default: WasteReport } = await import('../models/WasteReport.js'))
  ;({ default: CollectionRequest } = await import('../models/CollectionRequest.js'))
  ;({ default: Notification } = await import('../models/Notification.js'))
  ;({ env } = await import('../config/env.js'))
  ;({ getReportTiming } = await import('../utils/reportPriority.js'))
  ;({ requireAuth, requireRole } = await import('../middleware/authentication.js'))
  ;({ default: app } = await import('../app.js'))

  await connectToDatabase()
  assert.equal(mongoose.connection.name, testDatabaseName, 'tests must use their isolated database')
  await User.init()
  await WasteReport.init()
  await CollectionRequest.init()
  await Notification.init()
  await CollectionRequest.deleteMany({})
  await Notification.deleteMany({})
  await User.deleteMany({})
})

test('API setup honors the configured CORS and CSRF frontend origin lists', () => {
  const serverRoot = fileURLToPath(new URL('../../', import.meta.url))
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import { env } from './src/config/env.js'; process.stdout.write(JSON.stringify({ corsOrigins: env.corsOrigins, frontendOrigins: env.frontendOrigins }))",
    ],
    {
      cwd: serverRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        JWT_SECRET: testJwtSecret,
        CORS_ORIGINS: 'https://frontend.example.test,http://localhost:5173',
        FRONTEND_ORIGIN: 'https://frontend.example.test,http://localhost:5173',
      },
    },
  )

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    corsOrigins: ['https://frontend.example.test', 'http://localhost:5173'],
    frontendOrigins: ['https://frontend.example.test', 'http://localhost:5173'],
  })
})

after(async () => {
  if (mongoose?.connection.readyState === 1) {
    await CollectionRequest.deleteMany({})
    await Notification.deleteMany({})
    await WasteReport.deleteMany({ reportedBy: { $exists: true } })
    await User.deleteMany({})
    const { disconnectFromDatabase } = await import('../config/db.js')
    await disconnectFromDatabase()
  }
  if (aiMock?.listening) {
    await new Promise((resolve) => aiMock.close(resolve))
  }
  if (testImageDirectory) {
    await rm(testImageDirectory, { recursive: true, force: true })
  }
})

async function csrfAgent() {
  const agent = request.agent(app)
  const response = await agent
    .get('/api/auth/csrf')
    .set('Origin', frontendOrigin)
    .expect(200)

  assert.ok(response.body.data.csrfToken)
  assert.ok(response.headers['set-cookie'].some((cookie) => cookie.includes('ww_csrf=') && /httponly/i.test(cookie)))

  return { agent, token: response.body.data.csrfToken }
}

function postWithCsrf(agent, token, path, body) {
  return agent
    .post(path)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', token)
    .send(body)
}

async function registerUser({ email = 'citizen@example.test', password = 'correct-horse-battery-staple', name = 'WasteWise Citizen' } = {}) {
  const { agent, token } = await csrfAgent()
  const response = await postWithCsrf(agent, token, '/api/auth/register', { name, email, password })
  assert.equal(response.status, 201, response.text)
  return { agent, response, user: response.body.data.user }
}

async function createRoleSession({ role, email }) {
  const password = 'collector-test-password'
  await User.create({
    name: `Test ${role}`,
    email,
    passwordHash: password,
    role,
  })
  const { agent, token } = await csrfAgent()
  const response = await postWithCsrf(agent, token, '/api/auth/login', { email, password })
    .expect(200)
  assert.equal(response.body.data.user.role, role)
  return { agent, user: response.body.data.user }
}

async function createAssignedReport({ collectorId, reportedBy, category = 'plastic' }) {
  const report = await WasteReport.create({
    reportedBy,
    category,
    reviewStatus: 'accepted',
    status: 'reported',
    statusHistory: [{
      status: 'reported',
      changedAt: new Date(),
      changedBy: reportedBy,
    }],
  })
  await CollectionRequest.create({
    wasteReport: report._id,
    assignedCollector: collectorId,
    status: 'assigned',
  })
  return report
}

async function duplicateReportFixture() {
  if (!duplicateReportCitizen) {
    duplicateReportCitizen = await registerUser({ email: 'duplicate-report-citizen@example.test' })
    duplicateReportOtherCitizen = await registerUser({ email: 'duplicate-report-other@example.test' })
  }
  await WasteReport.deleteMany({
    reportedBy: { $in: [duplicateReportCitizen.user.id, duplicateReportOtherCitizen.user.id] },
  })
  return { citizen: duplicateReportCitizen, otherCitizen: duplicateReportOtherCitizen }
}

async function createDuplicateCandidate({ reportedBy, category = 'plastic', status = 'reported', reviewStatus = 'pending_review', latitude = 37.1234, longitude = -122.1234 }) {
  return WasteReport.create({
    reportedBy,
    category,
    status,
    reviewStatus,
    location: { latitude, longitude },
  })
}

async function submitReport(agent, body) {
  const csrf = await agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  return postWithCsrf(agent, csrf.body.data.csrfToken, '/api/reports', body)
}

test('registration creates a citizen, stores a hash, and never returns credentials', async () => {
  const password = '  correct-horse-battery-staple  '
  const { agent, response, user } = await registerUser({ password })
  assert.equal(user.role, 'citizen')
  assert.equal(user.email, 'citizen@example.test')
  assert.equal('passwordHash' in user, false)
  const authCookie = response.headers['set-cookie'].find((cookie) => cookie.startsWith(`${cookieHeaderName}=`))
  assert.ok(authCookie)
  assert.match(authCookie, /httponly/i)
  assert.equal(response.text.includes(authCookie.split(';')[0].split('=').slice(1).join('=')), false)

  const storedUser = await User.findById(user.id).select('+passwordHash').exec()
  assert.ok(storedUser.passwordHash)
  assert.notEqual(storedUser.passwordHash, password)
  assert.equal(await bcrypt.compare(password, storedUser.passwordHash), true)

  const authenticatedResponse = await agent
    .get('/api/auth/me')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.equal('passwordHash' in authenticatedResponse.body.data.user, false)
  assert.equal(authenticatedResponse.text.includes(storedUser.passwordHash), false)
})

test('registration rejects invalid email, weak passwords, and privileged role assignment', async () => {
  for (const [body, expectedMessage] of [
    [{ name: 'Invalid email', email: 'not-an-email', password: 'correct-horse-battery-staple' }, /valid email/i],
    [{ name: 'Weak password', email: 'weak@example.test', password: 'short' }, /at least 12/i],
    [{ name: 'Admin role injection', email: 'admin-role@example.test', password: 'correct-horse-battery-staple', role: 'admin' }, /unsupported request field/i],
    [{ name: 'Collector role injection', email: 'collector-role@example.test', password: 'correct-horse-battery-staple', role: 'collector' }, /unsupported request field/i],
    [{ name: 'Hash injection', email: 'hash@example.test', password: 'correct-horse-battery-staple', passwordHash: 'injected' }, /unsupported request field/i],
  ]) {
    const { agent, token } = await csrfAgent()
    const response = await postWithCsrf(agent, token, '/api/auth/register', body)
    assert.equal(response.status, 400)
    assert.match(response.body.error.message, expectedMessage)
  }

  assert.equal(await User.countDocuments({ role: { $in: ['collector', 'admin'] } }), 0)
})

test('duplicate email registration returns a safe conflict response', async () => {
  await registerUser({ email: 'duplicate@example.test' })
  const { agent, token } = await csrfAgent()
  const response = await postWithCsrf(agent, token, '/api/auth/register', {
    name: 'Duplicate',
    email: 'DUPLICATE@example.test',
    password: 'correct-horse-battery-staple',
  })

  assert.equal(response.status, 409)
  assert.equal(response.body.error.message, 'An account with this email already exists.')
  assert.equal(response.text.includes('E11000'), false)
})

test('login sets an HttpOnly access cookie and returns no JWT or hash', async () => {
  const password = 'another-correct-password'
  const { user } = await registerUser({ email: 'login@example.test', password })
  const { agent, token } = await csrfAgent()
  const response = await postWithCsrf(agent, token, '/api/auth/login', {
    email: ' LOGIN@example.test ',
    password,
  }).expect(200)

  const authCookie = response.headers['set-cookie'].find((cookie) => cookie.startsWith(`${cookieHeaderName}=`))
  assert.ok(authCookie)
  assert.match(authCookie, /httponly/i)
  assert.match(authCookie, /path=\/api/i)
  assert.match(authCookie, /samesite=lax/i)
  assert.match(authCookie, /max-age=900/i)
  assert.equal(/;\s*secure/i.test(authCookie), false)
  assert.equal(response.body.data.user.id, user.id)
  assert.equal(response.text.includes('passwordHash'), false)
  assert.equal(response.text.includes(authCookie.split(';')[0].split('=').slice(1).join('=')), false)
})

test('invalid email and password use the same generic login error', async () => {
  await registerUser({ email: 'known@example.test', password: 'a-known-correct-password' })
  const knownAgent = await csrfAgent()
  const wrongPassword = await postWithCsrf(knownAgent.agent, knownAgent.token, '/api/auth/login', {
    email: 'known@example.test',
    password: 'a-different-correct-password',
  })
  assert.equal(wrongPassword.status, 401)

  const unknownAgent = await csrfAgent()
  const unknownEmail = await postWithCsrf(unknownAgent.agent, unknownAgent.token, '/api/auth/login', {
    email: 'unknown@example.test',
    password: 'a-different-correct-password',
  })
  assert.equal(unknownEmail.status, 401)
  assert.equal(unknownEmail.body.error.message, 'Invalid email or password.')
  assert.equal(unknownEmail.body.error.message, wrongPassword.body.error.message)
})

test('/api/auth/me rejects unauthenticated requests and returns a safe user for a session', async () => {
  await request(app).get('/api/auth/me').set('Origin', frontendOrigin).expect(401)
  const { agent, user } = await registerUser({ email: 'me@example.test' })
  const response = await agent.get('/api/auth/me').set('Origin', frontendOrigin).expect(200)

  assert.equal(response.body.data.user.id, user.id)
  assert.equal(response.body.data.user.role, 'citizen')
  assert.equal('passwordHash' in response.body.data.user, false)
})

test('malformed, expired, and invalid-signature JWT cookies are rejected', async () => {
  const user = await User.findOne({ email: 'me@example.test' }).exec()
  const claims = { sub: user._id.toString() }
  const commonOptions = { issuer: env.jwtIssuer, audience: env.jwtAudience, algorithm: 'HS256' }
  const expiredToken = jwt.sign(claims, env.jwtSecret, { ...commonOptions, expiresIn: -1 })
  const invalidSignature = jwt.sign(claims, randomBytes(48).toString('base64url'), { ...commonOptions, expiresIn: 900 })

  for (const token of ['not.a.jwt', expiredToken, invalidSignature]) {
    await request(app)
      .get('/api/auth/me')
      .set('Origin', frontendOrigin)
      .set('Cookie', `${env.authCookieName}=${token}`)
      .expect(401)
  }
})

test('logout requires CSRF and clears the access cookie with matching scope', async () => {
  const { agent } = await registerUser({ email: 'logout@example.test' })
  const csrfResponse = await agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const token = csrfResponse.body.data.csrfToken
  const response = await postWithCsrf(agent, token, '/api/auth/logout', {}).expect(200)
  const clearCookie = response.headers['set-cookie'].find((cookie) => cookie.startsWith(`${cookieHeaderName}=`))

  assert.ok(clearCookie)
  assert.match(clearCookie, /httponly/i)
  assert.match(clearCookie, /path=\/api/i)
  assert.match(clearCookie, /samesite=lax/i)
  assert.match(clearCookie, /expires=thu, 01 jan 1970/i)
  await agent.get('/api/auth/me').set('Origin', frontendOrigin).expect(401)
})

test('state-changing requests reject missing or invalid CSRF tokens', async () => {
  await request(app)
    .post('/api/auth/login')
    .set('Origin', frontendOrigin)
    .send({ email: 'nobody@example.test', password: 'a-correct-length-password' })
    .expect(403)

  const { agent } = await csrfAgent()
  const invalid = await agent
    .post('/api/auth/login')
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', 'invalid-token')
    .send({ email: 'nobody@example.test', password: 'a-correct-length-password' })
    .expect(403)
  assert.equal(invalid.body.error.message, 'A valid CSRF token is required.')

  const noOrigin = await csrfAgent()
  await noOrigin.agent
    .post('/api/auth/login')
    .set('X-CSRF-Token', noOrigin.token)
    .send({ email: 'nobody@example.test', password: 'a-correct-length-password' })
    .expect(403)
})

test('valid CSRF tokens permit state changes and tokens are not cached', async () => {
  const { agent, token } = await csrfAgent()
  const response = await postWithCsrf(agent, token, '/api/auth/register', {
    name: 'CSRF Test',
    email: 'csrf@example.test',
    password: 'a-correct-length-password',
  }).expect(201)

  assert.equal(response.body.data.user.role, 'citizen')
  assert.equal((await request(app).get('/api/auth/csrf').set('Origin', frontendOrigin)).headers['cache-control'], 'no-store')
})

test('disallowed origins are rejected and allowed CORS is credentialed', async () => {
  const denied = await request(app)
    .post('/api/auth/login')
    .set('Origin', 'https://attacker.example')
    .send({ email: 'nobody@example.test', password: 'a-correct-length-password' })
    .expect(403)
  assert.match(denied.body.error.message, /origin is not allowed/i)

  const allowed = await request(app)
    .options('/api/auth/login')
    .set('Origin', frontendOrigin)
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type,x-csrf-token')
    .expect(204)
  assert.equal(allowed.headers['access-control-allow-origin'], frontendOrigin)
  assert.equal(allowed.headers['access-control-allow-credentials'], 'true')
})

test('role middleware uses the database role rather than a JWT role claim', async () => {
  function invokeRole(token, allowedRoles) {
    const response = {
      statusCode: 200,
      body: undefined,
      status(code) {
        this.statusCode = code
        return this
      },
      json(body) {
        this.body = body
        return this
      },
    }
    let nextCalled = false
    const req = { cookies: { [env.authCookieName]: token } }

    return new Promise((resolve, reject) => {
      requireAuth(req, response, (error) => {
        if (error) {
          reject(error)
          return
        }

        requireRole(...allowedRoles)(req, response, () => {
          nextCalled = true
          resolve({ response, nextCalled, user: req.user })
        })

        if (!nextCalled) {
          resolve({ response, nextCalled, user: req.user })
        }
      })
    })
  }

  const citizen = await User.findOne({ email: 'me@example.test' }).exec()
  const forgedAdminToken = jwt.sign(
    { sub: citizen._id.toString(), role: 'admin' },
    env.jwtSecret,
    { issuer: env.jwtIssuer, audience: env.jwtAudience, expiresIn: 900 },
  )
  const denied = await invokeRole(forgedAdminToken, ['admin'])
  assert.equal(denied.response.statusCode, 403)
  assert.equal(denied.nextCalled, false)
  assert.equal(denied.user.role, 'citizen')

  const admin = await User.create({
    name: 'Test Admin',
    email: 'test-admin@example.test',
    passwordHash: 'a-test-only-hash-password',
    role: 'admin',
  })
  const adminToken = jwt.sign(
    { sub: admin._id.toString() },
    env.jwtSecret,
    { issuer: env.jwtIssuer, audience: env.jwtAudience, expiresIn: 900 },
  )
  const allowed = await invokeRole(adminToken, ['admin'])
  assert.equal(allowed.response.statusCode, 200)
  assert.equal(allowed.nextCalled, true)
  assert.equal(allowed.user.role, 'admin')
})

test('health reports the connected database and Phase 3 test routes are no longer exposed', async () => {
  const health = await request(app).get('/api/health').expect(200)
  assert.equal(health.body.status, 'ok')
  assert.equal(health.body.message, 'WasteWise API is running.')
  assert.equal(health.body.database.status, 'connected')

  await request(app).get('/api/db-test/reports').expect(404)
  const { agent, token } = await csrfAgent()
  await postWithCsrf(agent, token, '/api/db-test/reports', { category: 'plastic' }).expect(404)
})

test('report creation requires authentication and valid CSRF protection', async () => {
  const { agent, token } = await csrfAgent()
  await postWithCsrf(agent, token, '/api/reports', { category: 'plastic' }).expect(401)
  await request(app)
    .post('/api/reports')
    .set('Origin', frontendOrigin)
    .send({ category: 'plastic' })
    .expect(403)

  const invalidToken = await agent
    .post('/api/reports')
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', 'invalid-token')
    .send({ category: 'plastic' })
    .expect(403)
  assert.equal(invalidToken.body.error.message, 'A valid CSRF token is required.')
})

test('citizen report creation persists server-owned identity, status, and initial history', async () => {
  const { agent, user } = await registerUser({ email: 'report-create@example.test' })
  const csrf = await agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const response = await postWithCsrf(agent, csrf.body.data.csrfToken, '/api/reports', {
    category: 'paper',
    description: '  Cardboard boxes near the entrance  ',
    location: { address: '  Main entrance  ', latitude: 12.5, longitude: 77.5 },
  }).expect(201)

  const report = response.body.data.report
  assert.equal(report.category, 'paper')
  assert.equal(report.description, 'Cardboard boxes near the entrance')
  assert.deepEqual(report.location, { address: 'Main entrance', latitude: 12.5, longitude: 77.5 })
  assert.equal('reportedBy' in report, false)
  assert.equal(report.status, 'reported')
  assert.equal(report.reviewStatus, 'pending_review')
  assert.equal(report.statusHistory.length, 1)
  assert.equal(report.statusHistory[0].status, 'reported')
  assert.equal('changedBy' in report.statusHistory[0], false)
  assert.ok(report.statusHistory[0].changedAt)

  const persisted = await WasteReport.findById(report.id).exec()
  assert.ok(persisted)
  assert.equal(persisted.reportedBy.toString(), user.id)
  assert.equal(persisted.status, 'reported')
  assert.equal(persisted.reviewStatus, 'pending_review')
  assert.equal(persisted.priority, 'medium')
  assert.equal(persisted.statusHistory[0].changedBy.toString(), user.id)
})

test('duplicate report detection blocks the same category and location when an existing report is assigned', async () => {
  const { citizen } = await duplicateReportFixture()
  const existing = await createDuplicateCandidate({
    reportedBy: citizen.user.id,
    status: 'assigned',
    reviewStatus: 'accepted',
  })

  const response = await submitReport(citizen.agent, {
    category: 'plastic',
    location: { latitude: 37.1234, longitude: -122.1234 },
  })

  assert.equal(response.status, 409)
  assert.match(response.body.error.message, /already been assigned for collection/i)
  assert.deepEqual(response.body.error.duplicate.existingReport, {
    id: existing._id.toString(),
    status: 'assigned',
    reviewStatus: 'accepted',
  })
})

test('duplicate report detection blocks the same category and location when an existing report is in progress', async () => {
  const { citizen } = await duplicateReportFixture()
  await createDuplicateCandidate({
    reportedBy: citizen.user.id,
    status: 'in_progress',
    reviewStatus: 'accepted',
  })

  const response = await submitReport(citizen.agent, {
    category: 'plastic',
    location: { latitude: 37.1234, longitude: -122.1234 },
  })

  assert.equal(response.status, 409)
  assert.match(response.body.error.message, /already been assigned for collection/i)
})

test('duplicate report detection allows a different category at the same location', async () => {
  const { citizen } = await duplicateReportFixture()
  await createDuplicateCandidate({ reportedBy: citizen.user.id })

  const response = await submitReport(citizen.agent, {
    category: 'paper',
    location: { latitude: 37.1234, longitude: -122.1234 },
  })

  assert.equal(response.status, 201, response.text)
})

test('duplicate report detection allows the same category at a different location', async () => {
  const { citizen } = await duplicateReportFixture()
  await createDuplicateCandidate({ reportedBy: citizen.user.id })

  const response = await submitReport(citizen.agent, {
    category: 'plastic',
    location: { latitude: 37.1334, longitude: -122.1234 },
  })

  assert.equal(response.status, 201, response.text)
})

test('collected reports do not block a new report at the same location', async () => {
  const { citizen } = await duplicateReportFixture()
  await createDuplicateCandidate({
    reportedBy: citizen.user.id,
    status: 'collected',
    reviewStatus: 'accepted',
  })

  const response = await submitReport(citizen.agent, {
    category: 'plastic',
    location: { latitude: 37.1234, longitude: -122.1234 },
  })

  assert.equal(response.status, 201, response.text)
})

test('rejected reports do not block a new report at the same location', async () => {
  const { citizen } = await duplicateReportFixture()
  await createDuplicateCandidate({
    reportedBy: citizen.user.id,
    reviewStatus: 'rejected',
  })

  const response = await submitReport(citizen.agent, {
    category: 'plastic',
    location: { latitude: 37.1234, longitude: -122.1234 },
  })

  assert.equal(response.status, 201, response.text)
})

test('duplicate report detection finds similar coordinates within the configured radius', async () => {
  const { citizen } = await duplicateReportFixture()
  await createDuplicateCandidate({ reportedBy: citizen.user.id })

  const response = await submitReport(citizen.agent, {
    category: 'plastic',
    location: { latitude: 37.1237, longitude: -122.1234 },
  })

  assert.equal(response.status, 409)
  assert.match(response.body.error.message, /awaiting review/i)
})

test('duplicate report detection allows coordinates outside the configured radius', async () => {
  const { citizen } = await duplicateReportFixture()
  await createDuplicateCandidate({ reportedBy: citizen.user.id })

  const response = await submitReport(citizen.agent, {
    category: 'plastic',
    location: { latitude: 37.1244, longitude: -122.1234 },
  })

  assert.equal(response.status, 201, response.text)
})

test('missing coordinates safely skip duplicate detection', async () => {
  const { citizen } = await duplicateReportFixture()
  await createDuplicateCandidate({ reportedBy: citizen.user.id })

  const response = await submitReport(citizen.agent, { category: 'plastic' })

  assert.equal(response.status, 201, response.text)
})

test('duplicate responses do not reveal another citizen report reference or private details', async () => {
  const { citizen, otherCitizen } = await duplicateReportFixture()
  const existing = await createDuplicateCandidate({
    reportedBy: otherCitizen.user.id,
    status: 'assigned',
    reviewStatus: 'accepted',
  })

  const response = await submitReport(citizen.agent, {
    category: 'plastic',
    location: { latitude: 37.1234, longitude: -122.1234 },
  })

  assert.equal(response.status, 409)
  assert.deepEqual(response.body.error.duplicate.existingReport, {
    status: 'assigned',
    reviewStatus: 'accepted',
  })
  assert.equal(JSON.stringify(response.body).includes(existing._id.toString()), false)
  assert.equal('location' in response.body.error.duplicate.existingReport, false)
  assert.equal('address' in response.body.error.duplicate.existingReport, false)
  assert.equal('description' in response.body.error.duplicate.existingReport, false)
  await citizen.agent.get(`/api/reports/${existing._id}`)
    .set('Origin', frontendOrigin)
    .expect(404)
})

test('concurrent duplicate submissions create at most one matching active report', async () => {
  const { citizen } = await duplicateReportFixture()
  const csrf = await citizen.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const body = {
    category: 'plastic',
    location: { latitude: 37.1234, longitude: -122.1234 },
  }
  const responses = await Promise.all([
    postWithCsrf(citizen.agent, csrf.body.data.csrfToken, '/api/reports', body),
    postWithCsrf(citizen.agent, csrf.body.data.csrfToken, '/api/reports', body),
  ])

  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409])
  assert.equal(await WasteReport.countDocuments({
    reportedBy: citizen.user.id,
    category: 'plastic',
    'location.latitude': 37.1234,
    'location.longitude': -122.1234,
    reviewStatus: 'pending_review',
  }), 1)
})

test('citizen report images validate file content, persist outside MongoDB, and remain role-protected', async () => {
  const owner = await registerUser({ email: 'report-image-owner@example.test' })
  const csrf = await owner.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const created = await owner.agent.post('/api/reports')
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', csrf.body.data.csrfToken)
    .field('category', 'plastic')
    .field('description', 'A valid uploaded photo')
    .field('location', JSON.stringify({ latitude: 12.5, longitude: 77.5 }))
    .attach('image', validPng, { filename: 'waste.png', contentType: 'image/png' })
    .expect(201)
  const report = created.body.data.report
  const persisted = await WasteReport.findById(report.id).exec()
  assert.equal(report.reviewStatus, 'pending_review')
  assert.match(report.imageUrl, new RegExp(`/reports/${report.id}/image$`))
  assert.ok(persisted.imagePath)
  assert.equal(path.basename(persisted.imagePath), persisted.imagePath)
  assert.equal(persisted.imageMimeType, 'image/png')
  assert.equal(persisted.imagePath.includes('waste.png'), false)
  const storedImage = await readFile(path.join(testImageDirectory, persisted.imagePath))
  assert.deepEqual(await sharp(storedImage).raw().toBuffer(), await sharp(validPng).raw().toBuffer())

  const stranger = await registerUser({ email: 'report-image-stranger@example.test' })
  const imageEndpoint = `/api${report.imageUrl}`
  await stranger.agent.get(imageEndpoint).set('Origin', frontendOrigin).expect(404)
  const ownerImage = await owner.agent.get(imageEndpoint)
    .set('Origin', frontendOrigin)
    .buffer()
    .parse((response, callback) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => callback(null, Buffer.concat(chunks)))
    })
    .expect(200)
  assert.deepEqual(await sharp(ownerImage.body).raw().toBuffer(), await sharp(validPng).raw().toBuffer())
  assert.match(ownerImage.headers['content-type'], /image\/png/)
  assert.equal(ownerImage.headers['cache-control'], 'private, no-store')
  assert.equal(ownerImage.headers['x-content-type-options'], 'nosniff')

  const admin = await createRoleSession({ role: 'admin', email: 'report-image-admin@example.test' })
  const adminImage = await admin.agent.get(imageEndpoint).set('Origin', frontendOrigin).expect(200)
  assert.match(adminImage.headers['content-type'], /image\/png/)

  const collector = await createRoleSession({ role: 'collector', email: 'report-image-collector@example.test' })
  await collector.agent.get(imageEndpoint).set('Origin', frontendOrigin).expect(404)
  await WasteReport.updateOne({ _id: report.id }, { $set: { reviewStatus: 'accepted' } }).exec()
  await CollectionRequest.create({
    wasteReport: report.id,
    assignedCollector: collector.user.id,
    status: 'assigned',
  })
  await collector.agent.get(imageEndpoint).set('Origin', frontendOrigin).expect(200)
})

test('report image upload rejects spoofed, mismatched, and oversized image content', async () => {
  const { agent } = await registerUser({ email: 'report-image-invalid@example.test' })

  async function upload(image, contentType) {
    const csrf = await agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
    return agent.post('/api/reports')
      .set('Origin', frontendOrigin)
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
      .field('category', 'glass')
      .attach('image', image, { filename: 'photo.png', contentType })
  }

  const spoofed = await upload(pngSignature, 'image/png')
  assert.equal(spoofed.status, 415)
  assert.match(spoofed.body.error.message, /valid JPEG, PNG, or WebP/i)
  const mismatched = await upload(validPng, 'image/jpeg')
  assert.equal(mismatched.status, 415)
  assert.match(mismatched.body.error.message, /valid JPEG, PNG, or WebP/i)
  const oversized = await upload(Buffer.alloc(1025, 1), 'image/png')
  assert.equal(oversized.status, 413)
  assert.match(oversized.body.error.message, /size limit/i)
  assert.equal(await WasteReport.countDocuments({ reportedBy: (await User.findOne({ email: 'report-image-invalid@example.test' }))._id }), 0)
})

test('report creation rejects owner, status, role, and unsupported-field injection', async () => {
  const { agent, user } = await registerUser({ email: 'report-injection@example.test' })
  const { user: otherUser } = await registerUser({ email: 'report-other-owner@example.test' })
  const payloads = [
    { category: 'plastic', reportedBy: otherUser.id },
    { category: 'plastic', status: 'verified' },
    { category: 'plastic', priority: 'urgent' },
    { category: 'plastic', dueAt: new Date().toISOString(), overdue: true },
    { category: 'plastic', role: 'admin' },
    { category: 'plastic', '$set': { status: 'verified' } },
  ]

  for (const payload of payloads) {
    const csrf = await agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
    const response = await postWithCsrf(agent, csrf.body.data.csrfToken, '/api/reports', payload)
      .expect(400)
    assert.match(response.body.error.message, /unsupported field/i)
  }

  assert.equal(await WasteReport.countDocuments({ reportedBy: user.id }), 0)
})

test('report validation rejects invalid category, description, location, and coordinates', async () => {
  const { agent } = await registerUser({ email: 'report-validation@example.test' })
  const invalidReports = [
    [{ category: 'hazardous' }, /category must be one of/i],
    [{ category: 'plastic', description: 'x'.repeat(501) }, /500 characters/i],
    [{ category: 'glass', location: { latitude: 91 } }, /latitude must be/i],
    [{ category: 'glass', location: { longitude: -181 } }, /longitude must be/i],
    [{ category: 'glass', location: { latitude: 12 } }, /must be provided together/i],
    [{ category: 'glass', location: { address: 'x'.repeat(301) } }, /address must be/i],
    [{ category: 'glass', location: { $where: 'true' } }, /unsupported field/i],
  ]

  for (const [payload, message] of invalidReports) {
    const csrf = await agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
    const response = await postWithCsrf(agent, csrf.body.data.csrfToken, '/api/reports', payload)
      .expect(400)
    assert.match(response.body.error.message, message)
  }
})

test('citizens list only their own reports and pagination is newest-first', async () => {
  const firstCitizen = await registerUser({ email: 'report-list-a@example.test' })
  const secondCitizen = await registerUser({ email: 'report-list-b@example.test' })

  async function createFor(agent, category) {
    const csrf = await agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
    const response = await postWithCsrf(agent, csrf.body.data.csrfToken, '/api/reports', { category })
      .expect(201)
    return response.body.data.report
  }

  const oldest = await createFor(firstCitizen.agent, 'paper')
  await new Promise((resolve) => setTimeout(resolve, 20))
  const newest = await createFor(firstCitizen.agent, 'glass')
  await createFor(secondCitizen.agent, 'metal')

  const pageOne = await firstCitizen.agent
    .get('/api/reports?page=1&limit=1')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.equal(pageOne.body.pagination.totalItems, 2)
  assert.equal(pageOne.body.pagination.totalPages, 2)
  assert.equal(pageOne.body.data[0].id, newest.id)

  const pageTwo = await firstCitizen.agent
    .get('/api/reports?page=2&limit=1')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.equal(pageTwo.body.data[0].id, oldest.id)

  const secondList = await secondCitizen.agent
    .get('/api/reports')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.equal(secondList.body.pagination.totalItems, 1)
  assert.notEqual(secondList.body.data[0].id, newest.id)

  const injectedOwnerFilter = await firstCitizen.agent
    .get(`/api/reports?reportedBy=${secondCitizen.user.id}`)
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.equal(injectedOwnerFilter.body.pagination.totalItems, 2)
  assert.ok(injectedOwnerFilter.body.data.every((report) => [oldest.id, newest.id].includes(report.id)))
})

test('report detail enforces ownership and validates IDs', async () => {
  const owner = await registerUser({ email: 'report-detail-owner@example.test' })
  const stranger = await registerUser({ email: 'report-detail-stranger@example.test' })
  const csrf = await owner.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const created = await postWithCsrf(owner.agent, csrf.body.data.csrfToken, '/api/reports', { category: 'organic' })
    .expect(201)
  const id = created.body.data.report.id

  const ownReport = await owner.agent.get(`/api/reports/${id}`).set('Origin', frontendOrigin).expect(200)
  assert.equal(ownReport.body.data.report.id, id)
  assert.equal(ownReport.body.data.report.statusHistory[0].status, 'reported')

  await stranger.agent.get(`/api/reports/${id}`).set('Origin', frontendOrigin).expect(404)
  await owner.agent.get('/api/reports/not-an-object-id').set('Origin', frontendOrigin).expect(400)
  await owner.agent.get('/api/reports/000000000000000000000000').set('Origin', frontendOrigin).expect(404)
})

test('report endpoints cannot change status and pagination errors are safe', async () => {
  const { agent, user } = await registerUser({ email: 'report-no-status@example.test' })
  const csrf = await agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await postWithCsrf(agent, csrf.body.data.csrfToken, '/api/reports', {
    category: 'plastic',
    status: 'collected',
  }).expect(400)
  await agent.get('/api/reports?page=0').set('Origin', frontendOrigin).expect(400)
  await agent.get('/api/reports?limit=101').set('Origin', frontendOrigin).expect(400)
  assert.equal(await WasteReport.countDocuments({ reportedBy: user.id }), 0)
})

test('collector endpoints require authentication and the database-backed collector role', async () => {
  await request(app).get('/api/collector/reports').set('Origin', frontendOrigin).expect(401)

  const citizen = await registerUser({ email: 'collector-api-citizen@example.test' })
  await citizen.agent.get('/api/collector/reports').set('Origin', frontendOrigin).expect(403)

  const collector = await createRoleSession({ role: 'collector', email: 'collector-api-user@example.test' })
  const listed = await collector.agent.get('/api/collector/reports').set('Origin', frontendOrigin).expect(200)
  assert.deepEqual(listed.body.data, [])
})

test('collectors list only assigned reports and detail access is assignment-scoped', async () => {
  const collector = await createRoleSession({ role: 'collector', email: 'collector-list@example.test' })
  const otherCollector = await createRoleSession({ role: 'collector', email: 'collector-other@example.test' })
  const citizen = await registerUser({ email: 'collector-list-owner@example.test' })
  const oldest = await createAssignedReport({ collectorId: collector.user.id, reportedBy: citizen.user.id, category: 'paper' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const newest = await createAssignedReport({ collectorId: collector.user.id, reportedBy: citizen.user.id, category: 'glass' })
  const unrelated = await createAssignedReport({ collectorId: otherCollector.user.id, reportedBy: citizen.user.id, category: 'metal' })

  const firstPage = await collector.agent
    .get('/api/collector/reports?page=1&limit=1')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.equal(firstPage.body.pagination.totalItems, 2)
  assert.equal(firstPage.body.pagination.totalPages, 2)
  assert.equal(firstPage.body.data[0].id, newest.id)

  const secondPage = await collector.agent
    .get('/api/collector/reports?page=2&limit=1')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.equal(secondPage.body.data[0].id, oldest.id)
  assert.ok(firstPage.body.data.every((report) => !('reportedBy' in report)))

  await collector.agent.get(`/api/collector/reports/${newest.id}`).set('Origin', frontendOrigin).expect(200)
  await collector.agent.get(`/api/collector/reports/${unrelated.id}`).set('Origin', frontendOrigin).expect(404)
  await collector.agent.get('/api/collector/reports/not-an-object-id').set('Origin', frontendOrigin).expect(400)
  await collector.agent.get('/api/collector/reports/000000000000000000000000').set('Origin', frontendOrigin).expect(404)
})

test('collector status updates enforce CSRF and persist atomic status history transitions', async () => {
  const collector = await createRoleSession({ role: 'collector', email: 'collector-status@example.test' })
  const citizen = await registerUser({ email: 'collector-status-owner@example.test' })
  const report = await createAssignedReport({ collectorId: collector.user.id, reportedBy: citizen.user.id })
  const endpoint = `/api/collector/reports/${report.id}/status`

  await collector.agent.patch(endpoint)
    .set('Origin', frontendOrigin)
    .send({ status: 'assigned' })
    .expect(403)

  await collector.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await collector.agent.patch(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', 'invalid-token')
    .send({ status: 'assigned' })
    .expect(403)

  const firstCsrf = await collector.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const assignedResponse = await collector.agent.patch(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', firstCsrf.body.data.csrfToken)
    .send({ status: 'assigned' })
    .expect(200)
  assert.equal(assignedResponse.body.data.report.status, 'assigned')
  assert.equal(assignedResponse.body.data.report.statusHistory[1].previousStatus, 'reported')
  assert.equal(assignedResponse.body.report, undefined)
  assert.equal('changedBy' in assignedResponse.body.data.report.statusHistory[1], false)

  const secondCsrf = await collector.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const inProgressResponse = await collector.agent.patch(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', secondCsrf.body.data.csrfToken)
    .send({ status: 'in_progress' })
    .expect(200)
  assert.equal(inProgressResponse.body.data.report.status, 'in_progress')

  const thirdCsrf = await collector.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const legacyReport = await collector.agent.get(`/api/collector/reports/${report.id}`)
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.equal(legacyReport.body.data.report.afterImageUrl, undefined)
  assert.deepEqual(legacyReport.body.data.report.collectionProofHistory, [])
  await collector.agent.patch(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', thirdCsrf.body.data.csrfToken)
    .send({ status: 'collected' })
    .expect(400)
  assert.match((await WasteReport.findById(report.id).exec()).status, /in_progress/)

  const invalidImageCsrf = await collector.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await collector.agent.patch(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', invalidImageCsrf.body.data.csrfToken)
    .field('status', 'collected')
    .attach('image', pngSignature, { filename: 'proof.png', contentType: 'image/png' })
    .expect(415)
  assert.equal((await WasteReport.findById(report.id).exec()).status, 'in_progress')

  const originalImagePath = `${randomBytes(16).toString('hex')}.png`
  await writeFile(path.join(testImageDirectory, originalImagePath), validPng)
  await WasteReport.updateOne(
    { _id: report.id },
    { $set: { imagePath: originalImagePath, imageMimeType: 'image/png' } },
  ).exec()
  const collectCsrf = await collector.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const collectedResponse = await collector.agent.patch(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', collectCsrf.body.data.csrfToken)
    .field('status', 'collected')
    .attach('image', validPng, { filename: 'proof.png', contentType: 'image/png' })
    .expect(200)
  assert.equal(collectedResponse.body.data.report.status, 'collected')
  assert.match(collectedResponse.body.data.report.afterImageUrl, /variant=after$/)

  const persisted = await WasteReport.findById(report.id).exec()
  assert.equal(persisted.status, 'collected')
  assert.equal(persisted.imagePath, originalImagePath)
  assert.ok(persisted.afterImagePath)
  assert.notEqual(persisted.afterImagePath, persisted.imagePath)
  assert.equal(persisted.afterImageMimeType, 'image/png')
  assert.equal(persisted.collectionProofHistory.length, 1)
  assert.equal(persisted.collectionProofHistory[0].submittedBy.toString(), collector.user.id)
  assert.ok(persisted.collectionProofHistory[0].submittedAt instanceof Date)
  assert.equal(
    persisted.collectionProofHistory[0].submittedAt.getTime(),
    persisted.statusHistory.at(-1).changedAt.getTime(),
  )
  assert.deepEqual(await sharp(await readFile(path.join(testImageDirectory, persisted.imagePath))).raw().toBuffer(),
    await sharp(validPng).raw().toBuffer())
  assert.deepEqual(
    persisted.statusHistory.slice(1).map((entry) => [entry.previousStatus, entry.status]),
    [['reported', 'assigned'], ['assigned', 'in_progress'], ['in_progress', 'collected']],
  )
  assert.ok(persisted.statusHistory.slice(1).every((entry) => entry.changedBy.toString() === collector.user.id))
  assert.ok(persisted.statusHistory.slice(1).every((entry) => entry.changedAt instanceof Date))
  const citizenHistory = await citizen.agent
    .get(`/api/reports/${report.id}`)
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.equal(citizenHistory.body.data.report.status, 'collected')
  assert.match(citizenHistory.body.data.report.imageUrl, /\/image$/)
  assert.match(citizenHistory.body.data.report.afterImageUrl, /variant=after$/)
  assert.equal(citizenHistory.body.data.report.collectionProofHistory.length, 1)
  assert.equal(citizenHistory.body.data.report.statusHistory[1].previousStatus, 'reported')
  assert.equal('changedBy' in citizenHistory.body.data.report.statusHistory[1], false)
  const afterImageEndpoint = `/api${citizenHistory.body.data.report.afterImageUrl}`
  await citizen.agent.get(`/api${citizenHistory.body.data.report.imageUrl}`)
    .set('Origin', frontendOrigin)
    .expect(200)
  await citizen.agent.get(afterImageEndpoint).set('Origin', frontendOrigin).expect(200)
  await collector.agent.get(afterImageEndpoint).set('Origin', frontendOrigin).expect(200)
  const admin = await createRoleSession({ role: 'admin', email: 'collector-proof-admin@example.test' })
  await admin.agent.get(afterImageEndpoint).set('Origin', frontendOrigin).expect(200)
  const stranger = await createRoleSession({ role: 'collector', email: 'collector-proof-stranger@example.test' })
  await stranger.agent.get(afterImageEndpoint).set('Origin', frontendOrigin).expect(404)
  const adminDetails = await admin.agent.get(`/api/admin/reports/${report.id}`)
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.equal(adminDetails.body.data.report.collectionProofHistory.length, 1)
  assert.match(adminDetails.body.data.report.afterImageUrl, /variant=after$/)
})

test('collector status updates reject invalid transitions, unsupported fields, and other assignments', async () => {
  const collector = await createRoleSession({ role: 'collector', email: 'collector-invalid@example.test' })
  const otherCollector = await createRoleSession({ role: 'collector', email: 'collector-invalid-other@example.test' })
  const citizen = await registerUser({ email: 'collector-invalid-owner@example.test' })
  const report = await createAssignedReport({ collectorId: collector.user.id, reportedBy: citizen.user.id })
  const otherReport = await createAssignedReport({ collectorId: otherCollector.user.id, reportedBy: citizen.user.id })

  for (const body of [
    { status: 'in_progress' },
    { status: 'verified' },
    { status: 'collected' },
    { status: 'assigned', reportedBy: citizen.user.id },
  ]) {
    const token = await collector.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
    await collector.agent.patch(`/api/collector/reports/${report.id}/status`)
      .set('Origin', frontendOrigin)
      .set('X-CSRF-Token', token.body.data.csrfToken)
      .send(body)
      .expect(400)
  }

  const latestCsrf = await collector.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await collector.agent.patch(`/api/collector/reports/${otherReport.id}/status`)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', latestCsrf.body.data.csrfToken)
    .send({ status: 'assigned' })
    .expect(404)

  await WasteReport.updateOne({ _id: otherReport.id }, { $set: { status: 'in_progress' } }).exec()
  const proofCsrf = await collector.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await collector.agent.patch(`/api/collector/reports/${otherReport.id}/status`)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', proofCsrf.body.data.csrfToken)
    .field('status', 'collected')
    .attach('image', validPng, { filename: 'unauthorized-proof.png', contentType: 'image/png' })
    .expect(404)
  const unauthorizedTarget = await WasteReport.findById(otherReport.id).exec()
  assert.equal(unauthorizedTarget.status, 'in_progress')
  assert.equal(unauthorizedTarget.afterImagePath, undefined)

  const unchanged = await WasteReport.findById(report.id).exec()
  assert.equal(unchanged.status, 'reported')
  assert.equal(unchanged.statusHistory.length, 1)
})

test('citizens cannot update collector status and collector pagination is validated', async () => {
  const collector = await createRoleSession({ role: 'collector', email: 'collector-pagination@example.test' })
  const citizen = await registerUser({ email: 'collector-pagination-owner@example.test' })
  const report = await createAssignedReport({ collectorId: collector.user.id, reportedBy: citizen.user.id })
  const csrf = await citizen.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)

  await citizen.agent.patch(`/api/collector/reports/${report.id}/status`)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', csrf.body.data.csrfToken)
    .send({ status: 'assigned' })
    .expect(403)
  await collector.agent.get('/api/collector/reports?page=0').set('Origin', frontendOrigin).expect(400)
  await collector.agent.get('/api/collector/reports?limit=101').set('Origin', frontendOrigin).expect(400)
  assert.equal((await WasteReport.findById(report.id).exec()).status, 'reported')
})

test('admin endpoints require a database-authorized admin role', async () => {
  await request(app).get('/api/admin/overview').set('Origin', frontendOrigin).expect(401)
  const citizen = await registerUser({ email: 'admin-access-citizen@example.test' })
  await citizen.agent.get('/api/admin/overview').set('Origin', frontendOrigin).expect(403)
  const collector = await createRoleSession({ role: 'collector', email: 'admin-access-collector@example.test' })
  await collector.agent.get('/api/admin/reports').set('Origin', frontendOrigin).expect(403)
  const admin = await createRoleSession({ role: 'admin', email: 'admin-access-user@example.test' })
  await admin.agent.get('/api/admin/overview').set('Origin', frontendOrigin).expect(200)
  await admin.agent.get('/api/admin/users').set('Origin', frontendOrigin).expect(200)

  const forgedAdminToken = jwt.sign(
    { sub: citizen.user.id, role: 'admin' },
    env.jwtSecret,
    { issuer: env.jwtIssuer, audience: env.jwtAudience, expiresIn: 900 },
  )
  await request(app)
    .get('/api/admin/overview')
    .set('Origin', frontendOrigin)
    .set('Cookie', `${cookieHeaderName}=${forgedAdminToken}`)
    .expect(403)
})

test('admin review decisions require admin authorization, rejection reasons, and one valid transition', async () => {
  const admin = await createRoleSession({ role: 'admin', email: 'review-admin@example.test' })
  const collector = await createRoleSession({ role: 'collector', email: 'review-collector@example.test' })
  const owner = await registerUser({ email: 'review-owner@example.test' })
  const csrf = await owner.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const created = await postWithCsrf(owner.agent, csrf.body.data.csrfToken, '/api/reports', {
    category: 'glass',
  }).expect(201)
  const reportId = created.body.data.report.id
  const endpoint = `/api/admin/reports/${reportId}/review`

  assert.equal(created.body.data.report.reviewStatus, 'pending_review')
  const ownerCsrf = await owner.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await owner.agent.patch(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', ownerCsrf.body.data.csrfToken)
    .send({ decision: 'accepted' })
    .expect(403)
  const collectorCsrf = await collector.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await collector.agent.patch(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', collectorCsrf.body.data.csrfToken)
    .send({ decision: 'accepted' })
    .expect(403)

  const noReasonCsrf = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await admin.agent.patch(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', noReasonCsrf.body.data.csrfToken)
    .send({ decision: 'rejected', reason: '   ' })
    .expect(400)
  const acceptanceWithReason = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await admin.agent.patch(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', acceptanceWithReason.body.data.csrfToken)
    .send({ decision: 'accepted', reason: 'unexpected' })
    .expect(400)
  const invalidDecision = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await admin.agent.patch(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', invalidDecision.body.data.csrfToken)
    .send({ decision: 'pending_review' })
    .expect(400)

  const rejectCsrf = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const rejected = await admin.agent.patch(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', rejectCsrf.body.data.csrfToken)
    .send({ decision: 'rejected', reason: 'Not a valid waste accumulation report.' })
    .expect(200)
  assert.equal(rejected.body.data.report.reviewStatus, 'rejected')

  const persisted = await WasteReport.findById(reportId).exec()
  assert.equal(persisted.reviewHistory.length, 1)
  assert.equal(persisted.reviewHistory[0].decision, 'rejected')
  assert.equal(persisted.reviewHistory[0].reason, 'Not a valid waste accumulation report.')
  assert.equal(persisted.reviewHistory[0].reviewedBy.toString(), admin.user.id)
  assert.ok(persisted.reviewHistory[0].reviewedAt instanceof Date)

  await CollectionRequest.create({
    wasteReport: reportId,
    assignedCollector: collector.user.id,
    status: 'assigned',
  })
  const rejectedStatusCsrf = await collector.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await collector.agent.patch(`/api/collector/reports/${reportId}/status`)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', rejectedStatusCsrf.body.data.csrfToken)
    .send({ status: 'in_progress' })
    .expect(404)
  assert.equal((await WasteReport.findById(reportId).exec()).status, 'reported')
  await CollectionRequest.deleteMany({ wasteReport: reportId }).exec()

  const repeatDecision = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await admin.agent.patch(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', repeatDecision.body.data.csrfToken)
    .send({ decision: 'accepted' })
    .expect(409)
  const assignRejected = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await admin.agent.post(`/api/admin/reports/${reportId}/assign`)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', assignRejected.body.data.csrfToken)
    .send({ collectorId: collector.user.id })
    .expect(409)
  await collector.agent.get(`/api/collector/reports/${reportId}`).set('Origin', frontendOrigin).expect(404)

  const filtered = await admin.agent.get('/api/admin/reports?reviewStatus=rejected').set('Origin', frontendOrigin).expect(200)
  assert.ok(filtered.body.data.some((entry) => entry.id === reportId && entry.reviewStatus === 'rejected'))
  const exported = await admin.agent.get('/api/admin/reports/export.csv?reviewStatus=rejected')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.ok(exported.text.includes(reportId))
  assert.ok(exported.text.includes('Not a valid waste accumulation report.'))
  assert.ok(exported.text.includes('rejection_reason'))
  await admin.agent.get('/api/admin/reports?reviewStatus=unknown').set('Origin', frontendOrigin).expect(400)
})

test('accepted reports can be assigned and collected with chronological citizen-visible history', async () => {
  const admin = await createRoleSession({ role: 'admin', email: 'lifecycle-admin@example.test' })
  const collector = await createRoleSession({ role: 'collector', email: 'lifecycle-collector@example.test' })
  const citizen = await registerUser({ email: 'lifecycle-citizen@example.test' })
  const csrf = await citizen.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const created = await postWithCsrf(citizen.agent, csrf.body.data.csrfToken, '/api/reports', {
    category: 'paper',
    location: { address: 'Library entrance', latitude: 12.7, longitude: 77.7 },
  }).expect(201)
  const reportId = created.body.data.report.id
  const reviewCsrf = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await admin.agent.patch(`/api/admin/reports/${reportId}/review`)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', reviewCsrf.body.data.csrfToken)
    .send({ decision: 'accepted' })
    .expect(200)

  const assignCsrf = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await admin.agent.post(`/api/admin/reports/${reportId}/assign`)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', assignCsrf.body.data.csrfToken)
    .send({ collectorId: collector.user.id })
    .expect(201)

  for (const status of ['in_progress', 'collected']) {
    const statusCsrf = await collector.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
    const update = collector.agent.patch(`/api/collector/reports/${reportId}/status`)
      .set('Origin', frontendOrigin)
      .set('X-CSRF-Token', statusCsrf.body.data.csrfToken)
    if (status === 'collected') {
      update
        .field('status', status)
        .attach('image', validPng, { filename: 'collection-proof.png', contentType: 'image/png' })
    } else {
      update.send({ status })
    }
    await update.expect(200)
  }
  const invalidTransitionCsrf = await collector.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await collector.agent.patch(`/api/collector/reports/${reportId}/status`)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', invalidTransitionCsrf.body.data.csrfToken)
    .send({ status: 'in_progress' })
    .expect(400)

  const citizenReport = await citizen.agent.get(`/api/reports/${reportId}`).set('Origin', frontendOrigin).expect(200)
  const report = citizenReport.body.data.report
  assert.equal(report.reviewStatus, 'accepted')
  assert.equal(report.status, 'collected')
  assert.deepEqual(report.statusHistory.map((entry) => entry.status), ['reported', 'assigned', 'in_progress', 'collected'])
  assert.equal(report.reviewHistory[0].decision, 'accepted')
  assert.match(report.afterImageUrl, /variant=after$/)
  assert.equal(report.collectionProofHistory.length, 1)
  assert.ok(new Date(report.reviewHistory[0].reviewedAt) >= new Date(report.statusHistory[0].changedAt))
  assert.ok(new Date(report.reviewHistory[0].reviewedAt) <= new Date(report.statusHistory[1].changedAt))
  const adminDetails = await admin.agent.get(`/api/admin/reports/${reportId}`).set('Origin', frontendOrigin).expect(200)
  assert.equal(adminDetails.body.data.report.reviewHistory[0].reviewedBy.name, admin.user.name)
})

test('admin promotion utility requires one valid existing-account email', () => {
  const scriptPath = fileURLToPath(new URL('../scripts/promoteAdmin.js', import.meta.url))
  const serverRoot = fileURLToPath(new URL('../../', import.meta.url))
  for (const args of [[], ['not-an-email'], ['first@example.test', 'second@example.test']]) {
    const result = spawnSync(process.execPath, [scriptPath, ...args], {
      cwd: serverRoot,
      encoding: 'utf8',
      env: process.env,
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /exactly one valid existing account email/i)
    assert.equal(result.stdout.includes('MongoDB connected'), false)
  }
})

test('collector promotion utility validates arguments and changes only the matching user role', async () => {
  const scriptPath = fileURLToPath(new URL('../scripts/promoteCollector.js', import.meta.url))
  const serverRoot = fileURLToPath(new URL('../../', import.meta.url))
  for (const args of [[], ['not-an-email'], ['first@example.test', 'second@example.test']]) {
    const result = spawnSync(process.execPath, [scriptPath, ...args], {
      cwd: serverRoot,
      encoding: 'utf8',
      env: process.env,
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /exactly one valid existing account email/i)
    assert.equal(result.stdout.includes('MongoDB connected'), false)
  }

  const userCountBeforeMissingLookup = await User.countDocuments()
  const missingUserResult = spawnSync(
    process.execPath,
    [scriptPath, 'missing-collector@example.test'],
    {
      cwd: serverRoot,
      encoding: 'utf8',
      env: process.env,
    },
  )
  assert.equal(missingUserResult.status, 1)
  assert.match(missingUserResult.stderr, /no existing account matches/i)
  assert.equal(await User.countDocuments(), userCountBeforeMissingLookup)

  const target = await User.create({
    name: 'Collector Promotion Target',
    email: 'collector-promotion-target@example.test',
    passwordHash: 'preserved-password',
  })
  const unrelated = await User.create({
    name: 'Unrelated User',
    email: 'collector-promotion-unrelated@example.test',
    passwordHash: 'unrelated-password',
    role: 'admin',
  })
  const targetBefore = await User.findById(target._id).select('+passwordHash').lean().exec()
  const userCountBefore = await User.countDocuments()

  const result = spawnSync(
    process.execPath,
    [scriptPath, '  COLLECTOR-PROMOTION-TARGET@EXAMPLE.TEST  '],
    {
      cwd: serverRoot,
      encoding: 'utf8',
      env: process.env,
    },
  )

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Promoted existing account collector-promotion-target@example\.test to collector/i)
  const targetAfter = await User.findById(target._id).select('+passwordHash').lean().exec()
  const unrelatedAfter = await User.findById(unrelated._id).lean().exec()
  assert.equal(targetAfter.role, 'collector')
  assert.equal(targetAfter.passwordHash, targetBefore.passwordHash)
  assert.equal(targetAfter.updatedAt.getTime(), targetBefore.updatedAt.getTime())
  assert.equal(unrelatedAfter.role, 'admin')
  assert.equal(await User.countDocuments(), userCountBefore)
})

test('admin overview metrics use database records and exclude cancelled assignments', async () => {
  const admin = await createRoleSession({ role: 'admin', email: 'admin-overview@example.test' })
  const collectorOne = await createRoleSession({ role: 'collector', email: 'admin-overview-one@example.test' })
  const collectorTwo = await createRoleSession({ role: 'collector', email: 'admin-overview-two@example.test' })
  const citizen = await registerUser({ email: 'admin-overview-citizen@example.test' })
  const beforeResponse = await admin.agent.get('/api/admin/overview').set('Origin', frontendOrigin).expect(200)
  const before = beforeResponse.body.data
  const otherCountBefore = await WasteReport.countDocuments({ category: 'other' })

  await WasteReport.create({
    reportedBy: citizen.user.id,
    category: 'other',
    reviewStatus: 'accepted',
    status: 'reported',
  })
  const cancelledOnly = await WasteReport.create({
    reportedBy: citizen.user.id,
    category: 'other',
    reviewStatus: 'accepted',
    status: 'reported',
  })
  const activeReport = await WasteReport.create({
    reportedBy: citizen.user.id,
    category: 'other',
    reviewStatus: 'accepted',
    status: 'reported',
  })
  await CollectionRequest.create({
    wasteReport: cancelledOnly._id,
    assignedCollector: collectorOne.user.id,
    status: 'cancelled',
  })
  await CollectionRequest.create({
    wasteReport: activeReport._id,
    assignedCollector: collectorOne.user.id,
    status: 'assigned',
  })
  await CollectionRequest.create({
    wasteReport: activeReport._id,
    assignedCollector: collectorTwo.user.id,
    status: 'in_progress',
  })

  const result = await admin.agent.get('/api/admin/overview').set('Origin', frontendOrigin).expect(200)
  const data = result.body.data
  assert.equal(data.users.total, before.users.total)
  assert.equal(data.users.citizens, before.users.citizens)
  assert.equal(data.users.collectors, before.users.collectors)
  assert.equal(data.reports.total, before.reports.total + 3)
  assert.equal(data.reports.byStatus.find((entry) => entry.status === 'reported').count,
    (before.reports.byStatus.find((entry) => entry.status === 'reported')?.count ?? 0) + 3)
  assert.equal(data.reports.byCategory.find((entry) => entry.category === 'other').count,
    otherCountBefore + 3)
  assert.equal(await WasteReport.countDocuments({ category: 'other' }), otherCountBefore + 3)
  assert.equal(data.collectionRequests.active, before.collectionRequests.active + 2)
  assert.equal(data.collectionRequests.cancelled, before.collectionRequests.cancelled + 1)
  assert.equal(data.reports.unassignedEligible, before.reports.unassignedEligible + 2)
  assert.equal(data.collectorWorkload.find((entry) => entry.collectorId === collectorOne.user.id).activeAssignments,
    (before.collectorWorkload.find((entry) => entry.collectorId === collectorOne.user.id)?.activeAssignments ?? 0) + 1)
  assert.equal(data.collectorWorkload.find((entry) => entry.collectorId === collectorTwo.user.id).activeAssignments,
    (before.collectorWorkload.find((entry) => entry.collectorId === collectorTwo.user.id)?.activeAssignments ?? 0) + 1)
  assert.equal(data.reports.createdPerDayLast30Days.length, 30)
  assert.ok(data.reports.createdPerDayLast30Days.some((entry) => entry.count > 0))
})

test('admin report and user lists validate filters, paginate, and omit authentication secrets', async () => {
  const admin = await createRoleSession({ role: 'admin', email: 'admin-list@example.test' })
  const citizen = await registerUser({ email: 'admin-list-citizen@example.test' })
  const report = await WasteReport.create({
    reportedBy: citizen.user.id,
    category: 'metal',
    status: 'reported',
  })

  const filteredReports = await admin.agent
    .get('/api/admin/reports?status=reported&category=metal&page=1&limit=1')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.equal(filteredReports.body.pagination.limit, 1)
  assert.ok(filteredReports.body.data.some((entry) => entry.id === report.id))
  assert.equal('reportedBy' in filteredReports.body.data.find((entry) => entry.id === report.id), false)
  await admin.agent.get('/api/admin/reports?status=invalid').set('Origin', frontendOrigin).expect(400)
  await admin.agent.get('/api/admin/reports?category=invalid').set('Origin', frontendOrigin).expect(400)
  await admin.agent.get('/api/admin/reports?limit=101').set('Origin', frontendOrigin).expect(400)
  await admin.agent.get('/api/admin/reports/not-an-object-id').set('Origin', frontendOrigin).expect(400)
  await admin.agent.get('/api/admin/reports/000000000000000000000000').set('Origin', frontendOrigin).expect(404)

  const users = await admin.agent.get('/api/admin/users?role=citizen&limit=1')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.equal(users.body.pagination.limit, 1)
  assert.ok(users.body.data.every((user) => user.role === 'citizen'))
  assert.ok(users.body.data.every((user) => !('passwordHash' in user)))
  assert.ok(users.body.data.every((user) => !('token' in user)))
  await admin.agent.get('/api/admin/users?role=superadmin').set('Origin', frontendOrigin).expect(400)

  const detail = await admin.agent.get(`/api/admin/reports/${report.id}`).set('Origin', frontendOrigin).expect(200)
  assert.equal(detail.body.data.report.citizen.email, citizen.user.email)
  assert.ok(Array.isArray(detail.body.data.report.assignments))
  assert.equal(detail.body.data.report.priority, 'medium')
})

test('priority timing defaults safely and calculates the overdue boundary using priority policy', () => {
  assert.deepEqual(env.reportDueHours, { low: 72, medium: 48, high: 24, urgent: 4 })
  const createdAt = new Date('2026-10-20T00:00:00.000Z')
  const deadline = new Date(createdAt.getTime() + 48 * 60 * 60 * 1000)
  assert.equal(getReportTiming({ priority: 'medium', createdAt, status: 'in_progress' }, new Date(deadline.getTime() - 1)).isOverdue, false)
  assert.equal(getReportTiming({ priority: 'medium', createdAt, status: 'in_progress' }, deadline).isOverdue, true)
  assert.equal(getReportTiming({ priority: 'legacy-value', createdAt, status: 'reported' }, deadline).priority, 'medium')
  assert.equal(getReportTiming({ priority: 'urgent', createdAt, status: 'collected' }, new Date('2026-10-30T00:00:00.000Z')).isOverdue, false)
  assert.equal(getReportTiming({ priority: 'urgent', createdAt, status: 'verified' }, new Date('2026-10-30T00:00:00.000Z')).isOverdue, false)
  assert.equal(getReportTiming({ priority: 'urgent', createdAt, reviewStatus: 'rejected' }, new Date('2026-10-30T00:00:00.000Z')).isOverdue, false)
  assert.equal(getReportTiming({ priority: 'urgent', status: 'in_progress' }, new Date()).dueAt, null)
  assert.equal(getReportTiming({ priority: 'urgent', createdAt: new Date(Number.NaN), status: 'in_progress' }, new Date()).isOverdue, false)
  assert.equal(getReportTiming({ priority: 'urgent', createdAt: 'invalid-date', status: 'in_progress' }, new Date()).dueAt, null)
})

test('admin priority updates are validated, role-protected, and refresh due times', async () => {
  const admin = await createRoleSession({ role: 'admin', email: 'priority-admin@example.test' })
  const collector = await createRoleSession({ role: 'collector', email: 'priority-collector@example.test' })
  const citizen = await registerUser({ email: 'priority-citizen@example.test' })
  const report = await WasteReport.create({
    reportedBy: citizen.user.id,
    category: 'plastic',
    status: 'in_progress',
    createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
  })
  assert.equal(report.priority, 'medium')
  const endpoint = `/api/admin/reports/${report.id}/priority`
  const citizenCsrf = await citizen.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await citizen.agent.patch(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', citizenCsrf.body.data.csrfToken)
    .send({ priority: 'urgent' })
    .expect(403)
  const collectorCsrf = await collector.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await collector.agent.patch(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', collectorCsrf.body.data.csrfToken)
    .send({ priority: 'urgent' })
    .expect(403)

  for (const body of [
    { priority: 'critical' },
    { priority: 'urgent', status: 'collected' },
    { priority: 2 },
  ]) {
    const csrf = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
    await admin.agent.patch(endpoint)
      .set('Origin', frontendOrigin)
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
      .send(body)
      .expect(400)
  }

  const updateCsrf = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const updated = await admin.agent.patch(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', updateCsrf.body.data.csrfToken)
    .send({ priority: 'urgent' })
    .expect(200)
  assert.equal(updated.body.data.report.priority, 'urgent')
  assert.equal(updated.body.data.report.dueAt, new Date(report.createdAt.getTime() + 4 * 60 * 60 * 1000).toISOString())
  const persisted = await WasteReport.findById(report.id).exec()
  assert.equal(persisted.priority, 'urgent')
  assert.equal(persisted.status, 'in_progress')
  assert.equal(persisted.statusHistory.length, 0)
})

test('priority and overdue filters, dashboard totals, and CSV export use the same live criteria', async () => {
  const admin = await createRoleSession({ role: 'admin', email: 'priority-filters-admin@example.test' })
  const citizen = await registerUser({ email: 'priority-filters-citizen@example.test' })
  const dashboardBefore = (await admin.agent.get('/api/admin/overview')
    .set('Origin', frontendOrigin)
    .expect(200)).body.data.reports
  const now = Date.now()
  const overdueMedium = await WasteReport.create({
    reportedBy: citizen.user.id,
    category: 'other',
    priority: 'medium',
    status: 'in_progress',
    reviewStatus: 'accepted',
    createdAt: new Date(now - 50 * 60 * 60 * 1000),
  })
  const overdueUrgent = await WasteReport.create({
    reportedBy: citizen.user.id,
    category: 'other',
    priority: 'urgent',
    status: 'assigned',
    reviewStatus: 'accepted',
    createdAt: new Date(now - 5 * 60 * 60 * 1000),
  })
  const collectedOld = await WasteReport.create({
    reportedBy: citizen.user.id,
    category: 'other',
    priority: 'high',
    status: 'collected',
    reviewStatus: 'accepted',
    createdAt: new Date(now - 72 * 60 * 60 * 1000),
  })
  const rejectedOld = await WasteReport.create({
    reportedBy: citizen.user.id,
    category: 'other',
    priority: 'urgent',
    status: 'reported',
    reviewStatus: 'rejected',
    createdAt: new Date(now - 72 * 60 * 60 * 1000),
  })
  const legacyId = new mongoose.Types.ObjectId()
  await WasteReport.collection.insertOne({
    _id: legacyId,
    reportedBy: new mongoose.Types.ObjectId(citizen.user.id),
    category: 'other',
    status: 'reported',
    createdAt: new Date(now - 50 * 60 * 60 * 1000),
    updatedAt: new Date(now - 50 * 60 * 60 * 1000),
  })

  const overdueList = await admin.agent.get('/api/admin/reports?overdue=true&priority=medium')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.deepEqual(overdueList.body.data.map((entry) => entry.id).sort(), [overdueMedium.id, legacyId].map(String).sort())
  assert.ok(overdueList.body.data.every((entry) => entry.isOverdue))
  assert.ok(overdueList.body.data.every((entry) => entry.priority === 'medium'))
  const notOverdueList = await admin.agent.get('/api/admin/reports?overdue=false&status=collected')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.ok(notOverdueList.body.data.some((entry) => entry.id === collectedOld.id))
  const rejectedList = await admin.agent.get('/api/admin/reports?overdue=false&reviewStatus=rejected')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.ok(rejectedList.body.data.some((entry) => entry.id === rejectedOld.id))
  assert.ok(!notOverdueList.body.data.some((entry) => entry.id === overdueMedium.id))
  await admin.agent.get('/api/admin/reports?priority=critical').set('Origin', frontendOrigin).expect(400)
  await admin.agent.get('/api/admin/reports?overdue=maybe').set('Origin', frontendOrigin).expect(400)

  const dashboard = await admin.agent.get('/api/admin/overview').set('Origin', frontendOrigin).expect(200)
  assert.equal(dashboard.body.data.reports.pendingReview, dashboardBefore.pendingReview + 1)
  assert.equal(dashboard.body.data.reports.active, dashboardBefore.active + 2)
  assert.equal(dashboard.body.data.reports.overdue, dashboardBefore.overdue + 3)
  assert.equal(dashboard.body.data.reports.urgentOrHigh, dashboardBefore.urgentOrHigh + 1)

  const csv = await admin.agent.get('/api/admin/reports/export.csv?overdue=true&priority=medium')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.match(csv.text, /"priority","due_at","overdue"/)
  assert.ok(csv.text.includes(overdueMedium.id))
  assert.ok(csv.text.includes(legacyId.toString()))
  assert.equal(csv.text.includes(overdueUrgent.id), false)
  assert.equal(csv.text.includes(collectedOld.id), false)
  assert.equal(csv.text.includes(rejectedOld.id), false)
  assert.ok(csv.text.includes('"true"'))
})

test('admin CSV export enforces authorization, validates filters, and exports matching real report data safely', async () => {
  await request(app)
    .get('/api/admin/reports/export.csv')
    .set('Origin', frontendOrigin)
    .expect(401)
  const citizen = await registerUser({ email: 'admin-export-citizen@example.test' })
  await citizen.agent.get('/api/admin/reports/export.csv').set('Origin', frontendOrigin).expect(403)
  const admin = await createRoleSession({ role: 'admin', email: 'admin-export@example.test' })
  const collector = await createRoleSession({ role: 'collector', email: 'admin-export-collector@example.test' })
  const matchingReport = await WasteReport.create({
    reportedBy: citizen.user.id,
    category: 'metal',
    description: '=HYPERLINK("https://example.test","open")',
    location: { address: 'Warehouse, north entrance', latitude: -12.5, longitude: 45.25 },
    status: 'assigned',
  })
  await CollectionRequest.create({
    wasteReport: matchingReport._id,
    assignedCollector: collector.user.id,
    status: 'assigned',
  })
  const excludedReport = await WasteReport.create({
    reportedBy: citizen.user.id,
    category: 'plastic',
    status: 'reported',
  })

  const response = await admin.agent
    .get('/api/admin/reports/export.csv?status=assigned&category=metal')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.match(response.headers['content-type'], /text\/csv;\s*charset=utf-8/i)
  assert.match(response.headers['content-disposition'], /attachment;\s*filename="wastewise-reports\.csv"/i)
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.match(response.text, /^"report_id","category","status"/)
  assert.ok(response.text.includes(matchingReport.id))
  assert.ok(response.text.includes(citizen.user.email))
  assert.ok(response.text.includes(collector.user.name))
  assert.ok(response.text.includes('"Warehouse, north entrance"'))
  assert.ok(response.text.includes('\'=HYPERLINK('))
  assert.ok(response.text.includes('""https://example.test""'))
  assert.equal(response.text.includes(excludedReport.id), false)
  await admin.agent.get('/api/admin/reports/export.csv?status=unknown')
    .set('Origin', frontendOrigin)
    .expect(400)
  await admin.agent.get('/api/admin/reports/export.csv?category=unknown')
    .set('Origin', frontendOrigin)
    .expect(400)
})

test('admin assignment enforces CSRF, validates collector eligibility, and records report history', async () => {
  const admin = await createRoleSession({ role: 'admin', email: 'admin-assign@example.test' })
  const collector = await createRoleSession({ role: 'collector', email: 'admin-assign-collector@example.test' })
  const citizen = await registerUser({ email: 'admin-assign-citizen@example.test' })
  const report = await WasteReport.create({
    reportedBy: citizen.user.id,
    category: 'glass',
    reviewStatus: 'accepted',
    status: 'reported',
    statusHistory: [{ status: 'reported', changedBy: citizen.user.id, changedAt: new Date() }],
  })
  const endpoint = `/api/admin/reports/${report.id}/assign`

  await admin.agent.post(endpoint).set('Origin', frontendOrigin).send({ collectorId: collector.user.id }).expect(403)
  const csrf = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await admin.agent.post(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', csrf.body.data.csrfToken)
    .send({ collectorId: collector.user.id, status: 'assigned' })
    .expect(400)

  const invalidCollector = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await admin.agent.post(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', invalidCollector.body.data.csrfToken)
    .send({ collectorId: citizen.user.id })
    .expect(400)

  const missingCollector = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await admin.agent.post(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', missingCollector.body.data.csrfToken)
    .send({ collectorId: '000000000000000000000000' })
    .expect(400)

  const adminAsCollectorCsrf = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await admin.agent.post(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', adminAsCollectorCsrf.body.data.csrfToken)
    .send({ collectorId: admin.user.id })
    .expect(400)

  const missingReportCsrf = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await admin.agent.post('/api/admin/reports/000000000000000000000000/assign')
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', missingReportCsrf.body.data.csrfToken)
    .send({ collectorId: collector.user.id })
    .expect(404)

  const successCsrf = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const response = await admin.agent.post(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', successCsrf.body.data.csrfToken)
    .send({ collectorId: collector.user.id })
    .expect(201)
  assert.equal(response.body.data.assignment.collector.id, collector.user.id)
  assert.equal(response.body.data.assignment.report.id, report.id)
  assert.equal(response.body.data.report.status, 'assigned')

  const persisted = await WasteReport.findById(report.id).exec()
  assert.equal(persisted.status, 'assigned')
  assert.equal(persisted.statusHistory.at(-1).previousStatus, 'reported')
  assert.equal(persisted.statusHistory.at(-1).status, 'assigned')
  assert.equal(persisted.statusHistory.at(-1).changedBy.toString(), admin.user.id)

  const collectorReports = await collector.agent.get('/api/collector/reports').set('Origin', frontendOrigin).expect(200)
  assert.ok(collectorReports.body.data.some((entry) => entry.id === report.id))
  const duplicateCsrf = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await admin.agent.post(endpoint)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', duplicateCsrf.body.data.csrfToken)
    .send({ collectorId: collector.user.id })
    .expect(409)
})

test('concurrent admin assignment attempts produce at most one active assignment', async () => {
  const admin = await createRoleSession({ role: 'admin', email: 'admin-concurrent@example.test' })
  const collectorOne = await createRoleSession({ role: 'collector', email: 'admin-concurrent-one@example.test' })
  const collectorTwo = await createRoleSession({ role: 'collector', email: 'admin-concurrent-two@example.test' })
  const citizen = await registerUser({ email: 'admin-concurrent-citizen@example.test' })
  const report = await WasteReport.create({
    reportedBy: citizen.user.id,
    category: 'paper',
    reviewStatus: 'accepted',
    status: 'reported',
    statusHistory: [{ status: 'reported', changedBy: citizen.user.id, changedAt: new Date() }],
  })
  const endpoint = `/api/admin/reports/${report.id}/assign`

  async function assign(collectorId) {
    const csrf = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
    return admin.agent.post(endpoint)
      .set('Origin', frontendOrigin)
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
      .send({ collectorId })
  }

  const responses = await Promise.all([
    assign(collectorOne.user.id),
    assign(collectorTwo.user.id),
  ])
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409])
  assert.equal(await CollectionRequest.countDocuments({
    wasteReport: report._id,
    status: { $ne: 'cancelled' },
  }), 1)
  assert.equal((await WasteReport.findById(report.id).exec()).status, 'assigned')
})

test('admin assignment lists validate state filters and protect admin endpoints from non-admin writes', async () => {
  const citizen = await registerUser({ email: 'admin-assignment-citizen@example.test' })
  await citizen.agent.get('/api/admin/assignments').set('Origin', frontendOrigin).expect(403)
  const admin = await createRoleSession({ role: 'admin', email: 'admin-assignment-list@example.test' })
  await admin.agent.get('/api/admin/assignments?status=unknown').set('Origin', frontendOrigin).expect(400)
  const assignments = await admin.agent.get('/api/admin/assignments?status=cancelled')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.ok(Array.isArray(assignments.body.data))
})

test('AI classification requires an authenticated citizen and valid CSRF protection', async () => {
  aiMockMode = 'response'
  aiMockResponse = { status: 200, body: validAiResponse }
  const anonymous = request.agent(app)
  const anonymousCsrf = await anonymous.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await anonymous.post('/api/ai/classify')
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', anonymousCsrf.body.data.csrfToken)
    .attach('image', Buffer.concat([pngSignature, Buffer.from('data')]), 'waste.png')
    .expect(401)

  const citizen = await registerUser({ email: 'ai-csrf-citizen@example.test' })
  await citizen.agent.post('/api/ai/classify')
    .set('Origin', frontendOrigin)
    .attach('image', Buffer.concat([pngSignature, Buffer.from('data')]), 'waste.png')
    .expect(403)

  const originCsrf = await citizen.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await citizen.agent.post('/api/ai/classify')
    .set('Origin', 'https://untrusted.example')
    .set('X-CSRF-Token', originCsrf.body.data.csrfToken)
    .attach('image', Buffer.concat([pngSignature, Buffer.from('data')]), 'waste.png')
    .expect(403)

  const collector = await createRoleSession({ role: 'collector', email: 'ai-role-collector@example.test' })
  const csrf = await collector.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await collector.agent.post('/api/ai/classify')
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', csrf.body.data.csrfToken)
    .attach('image', Buffer.concat([pngSignature, Buffer.from('data')]), 'waste.png')
    .expect(403)
})

test('AI classification rejects invalid and oversized image uploads including MIME spoofing', async () => {
  const citizen = await registerUser({ email: 'ai-validation-citizen@example.test' })
  const csrf = await citizen.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)

  await citizen.agent.post('/api/ai/classify')
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', csrf.body.data.csrfToken)
    .send({})
    .expect(400)

  await citizen.agent.post('/api/ai/classify')
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', csrf.body.data.csrfToken)
    .attach('image', Buffer.from('not an image'), { filename: 'picture.png', contentType: 'image/png' })
    .expect(415)

  const largeCsrf = await citizen.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await citizen.agent.post('/api/ai/classify')
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', largeCsrf.body.data.csrfToken)
    .attach('image', Buffer.concat([pngSignature, Buffer.alloc(1024)]), 'large.png')
    .expect(413)
})

test('AI classification validates upstream data and returns actual validated model output', async () => {
  const citizen = await registerUser({ email: 'ai-classify-citizen@example.test' })
  aiMockMode = 'response'
  aiMockResponse = { status: 200, body: validAiResponse }
  const csrf = await citizen.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const response = await citizen.agent.post('/api/ai/classify')
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', csrf.body.data.csrfToken)
    .attach('image', Buffer.concat([pngSignature, Buffer.from('actual-image-content')]), {
      filename: 'extension-does-not-matter.jpg',
      contentType: 'application/octet-stream',
    })
    .expect(200)

  assert.equal(response.body.data.inference_success, true)
  assert.equal(response.body.data.predicted_category, 'plastic')
  assert.equal(response.body.data.confidence, 0.9)
  assert.equal(response.body.data.model_name, 'test-model')
  assert.equal(response.body.data.disposal_guidance, null)
  assert.match(response.body.data.confidence_note, /not calibrated/i)
  assert.match(lastAiRequestContentType, /^multipart\/form-data; boundary=/i)
  assert.ok(lastAiRequestBody.includes(pngSignature))
  assert.ok(lastAiRequestBody.includes(Buffer.from('Content-Type: image/png')))

  const invalidCsrf = await citizen.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  aiMockResponse = {
    status: 200,
    body: { ...validAiResponse, predicted_category: 'not-a-category' },
  }
  const invalid = await citizen.agent.post('/api/ai/classify')
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', invalidCsrf.body.data.csrfToken)
    .attach('image', Buffer.concat([pngSignature, Buffer.from('image')]), 'waste.png')
    .expect(502)
  assert.equal(invalid.body.error.code, 'ai_upstream_error')

  const inconsistentCsrf = await citizen.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  aiMockResponse = {
    status: 200,
    body: { ...validAiResponse, confidence: 0.4 },
  }
  await citizen.agent.post('/api/ai/classify')
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', inconsistentCsrf.body.data.csrfToken)
    .attach('image', Buffer.concat([pngSignature, Buffer.from('image')]), 'waste.png')
    .expect(502)

  const unavailableCsrf = await citizen.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  aiMockResponse = {
    status: 503,
    body: { error: { code: 'model_not_ready', message: 'private detail' } },
  }
  const unavailable = await citizen.agent.post('/api/ai/classify')
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', unavailableCsrf.body.data.csrfToken)
    .attach('image', Buffer.concat([pngSignature, Buffer.from('image')]), 'waste.png')
    .expect(503)
  assert.equal(unavailable.body.error.code, 'model_not_ready')
  assert.doesNotMatch(unavailable.text, /private detail/)
})

test('AI service connection failures and timeouts return safe errors', async () => {
  const citizen = await registerUser({ email: 'ai-unavailable-citizen@example.test' })

  async function classifyWithMockMode(mode, expectedStatus) {
    aiMockMode = mode
    const csrf = await citizen.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
    return citizen.agent.post('/api/ai/classify')
      .set('Origin', frontendOrigin)
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
      .attach('image', Buffer.concat([pngSignature, Buffer.from('image')]), 'waste.png')
      .expect(expectedStatus)
  }

  try {
    const unavailable = await classifyWithMockMode('close', 503)
    assert.equal(unavailable.body.error.code, 'ai_service_unavailable')
    const timedOut = await classifyWithMockMode('delay', 504)
    assert.equal(timedOut.body.error.code, 'ai_service_timeout')
  } finally {
    aiMockMode = 'response'
    aiMockResponse = { status: 200, body: validAiResponse }
  }
})

test('health reports AI service and model readiness separately', async () => {
  aiMockModelReady = false
  const unavailableModel = await request(app).get('/api/health').expect(200)
  assert.equal(unavailableModel.body.ai.service, 'available')
  assert.equal(unavailableModel.body.ai.model, 'not_ready')

  aiMockModelReady = true
  const readyModel = await request(app).get('/api/health').expect(200)
  assert.equal(readyModel.body.ai.model, 'ready')
  aiMockModelReady = false
})

test('notification APIs paginate, count unread items, and isolate recipients', async () => {
  const citizen = await registerUser({ email: 'notifications-owner@example.test' })
  const otherCitizen = await registerUser({ email: 'notifications-other@example.test' })
  const admin = await createRoleSession({ role: 'admin', email: 'notifications-admin@example.test' })

  const csrf = await citizen.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const report = await postWithCsrf(citizen.agent, csrf.body.data.csrfToken, '/api/reports', {
    category: 'plastic',
  }).expect(201)
  const reportId = report.body.data.report.id
  const secondReportCsrf = await citizen.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const secondReport = await postWithCsrf(citizen.agent, secondReportCsrf.body.data.csrfToken, '/api/reports', {
    category: 'paper',
  }).expect(201)

  const firstPage = await admin.agent.get('/api/notifications?page=1&limit=1')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.equal(firstPage.body.unreadCount, 2)
  assert.equal(firstPage.body.data.length, 1)
  assert.equal(firstPage.body.pagination.totalItems, 2)
  assert.equal(firstPage.body.data[0].type, 'new_report')
  assert.ok([reportId, secondReport.body.data.report.id].includes(firstPage.body.data[0].reportId))
  assert.equal(firstPage.body.data[0].isRead, false)
  assert.equal('recipient' in firstPage.body.data[0], false)
  assert.equal('deduplicationKey' in firstPage.body.data[0], false)
  const secondPage = await admin.agent.get('/api/notifications?page=2&limit=1')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.equal(secondPage.body.data.length, 1)
  assert.notEqual(secondPage.body.data[0].reportId, firstPage.body.data[0].reportId)
  assert.deepEqual(
    [firstPage.body.data[0].reportId, secondPage.body.data[0].reportId].sort(),
    [reportId, secondReport.body.data.report.id].sort(),
  )

  await otherCitizen.agent.get('/api/notifications').set('Origin', frontendOrigin).expect(200)
  const otherCsrf = await otherCitizen.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await otherCitizen.agent.patch(`/api/notifications/${firstPage.body.data[0].id}/read`)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', otherCsrf.body.data.csrfToken)
    .send({})
    .expect(404)

  const ownerCsrf = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const marked = await admin.agent.patch(`/api/notifications/${firstPage.body.data[0].id}/read`)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', ownerCsrf.body.data.csrfToken)
    .send({})
    .expect(200)
  assert.equal(marked.body.data.notification.isRead, true)
  const repeat = await admin.agent.patch(`/api/notifications/${firstPage.body.data[0].id}/read`)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', ownerCsrf.body.data.csrfToken)
    .send({})
    .expect(200)
  assert.equal(repeat.body.data.notification.isRead, true)
  assert.equal((await admin.agent.get('/api/notifications').set('Origin', frontendOrigin).expect(200))
    .body.unreadCount, 1)

  await request(app).get('/api/notifications').set('Origin', frontendOrigin).expect(401)
  await admin.agent.get('/api/notifications?page=0').set('Origin', frontendOrigin).expect(400)
  await admin.agent.get('/api/notifications?recipient=anyone').set('Origin', frontendOrigin).expect(400)
  await admin.agent.patch('/api/notifications/not-an-id/read')
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', ownerCsrf.body.data.csrfToken)
    .send({})
    .expect(400)
  await admin.agent.patch('/api/notifications/read-all')
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', ownerCsrf.body.data.csrfToken)
    .send({ recipientId: otherCitizen.user.id })
    .expect(400)

  const ownerNotifications = await citizen.agent.get('/api/notifications')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.equal(ownerNotifications.body.data.length, 0)
  assert.equal(otherCitizen.user.role, 'citizen')

  await assert.rejects(Notification.create({
    recipient: admin.user.id,
    type: 'unsupported_event',
    title: 'Invalid',
    message: 'Invalid',
    deduplicationKey: `invalid-notification:${randomBytes(8).toString('hex')}`,
  }), { name: 'ValidationError' })
})

test('report lifecycle creates recipient-specific review, assignment, priority, and collection notifications', async () => {
  const citizen = await registerUser({ email: 'notifications-lifecycle-citizen@example.test' })
  const collector = await createRoleSession({ role: 'collector', email: 'notifications-lifecycle-collector@example.test' })
  const admin = await createRoleSession({ role: 'admin', email: 'notifications-lifecycle-admin@example.test' })
  const reportCsrf = await citizen.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const created = await postWithCsrf(citizen.agent, reportCsrf.body.data.csrfToken, '/api/reports', {
    category: 'glass',
  }).expect(201)
  const reportId = created.body.data.report.id

  async function adminPatch(url, body) {
    const csrf = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
    return await admin.agent.patch(url)
      .set('Origin', frontendOrigin)
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
      .send(body)
  }

  assert.equal((await adminPatch(`/api/admin/reports/${reportId}/review`, { decision: 'accepted' })).status, 200)
  const reviewNotice = await citizen.agent.get('/api/notifications').set('Origin', frontendOrigin).expect(200)
  assert.ok(reviewNotice.body.data.some((entry) => entry.type === 'report_accepted'))

  const assignCsrf = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await admin.agent.post(`/api/admin/reports/${reportId}/assign`)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', assignCsrf.body.data.csrfToken)
    .send({ collectorId: collector.user.id })
    .expect(201)
  assert.ok((await citizen.agent.get('/api/notifications').set('Origin', frontendOrigin).expect(200))
    .body.data.some((entry) => entry.type === 'collector_assigned'))
  assert.ok((await collector.agent.get('/api/notifications').set('Origin', frontendOrigin).expect(200))
    .body.data.some((entry) => entry.type === 'collector_assigned'))

  assert.equal((await adminPatch(`/api/admin/reports/${reportId}/priority`, { priority: 'high' })).status, 200)
  assert.equal((await adminPatch(`/api/admin/reports/${reportId}/priority`, { priority: 'high' })).status, 200)
  const collectorNotifications = await collector.agent.get('/api/notifications')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.equal(collectorNotifications.body.data.filter((entry) => entry.type === 'priority_raised').length, 1)

  async function collectorPatch(status, image) {
    const csrf = await collector.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
    const endpoint = collector.agent.patch(`/api/collector/reports/${reportId}/status`)
      .set('Origin', frontendOrigin)
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
    if (image) {
      return await endpoint.field('status', status)
        .attach('image', validPng, { filename: 'proof.png', contentType: 'image/png' })
    }
    return await endpoint.send({ status })
  }
  assert.equal((await collectorPatch('in_progress')).status, 200)
  assert.equal((await collectorPatch('collected', true)).status, 200)

  const citizenNotifications = await citizen.agent.get('/api/notifications')
    .set('Origin', frontendOrigin)
    .expect(200)
  const citizenTypes = citizenNotifications.body.data.map((entry) => entry.type)
  assert.ok(citizenTypes.includes('report_work_started'))
  assert.ok(citizenTypes.includes('report_collected'))
  const adminNotifications = await admin.agent.get('/api/notifications')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.ok(adminNotifications.body.data.some((entry) => entry.type === 'priority_raised'))
  assert.equal(citizenTypes.includes('priority_raised'), false)
})

test('review rejection notifies the citizen and high-priority reports notify administrators', async () => {
  const citizen = await registerUser({ email: 'notifications-reject-citizen@example.test' })
  const admin = await createRoleSession({ role: 'admin', email: 'notifications-reject-admin@example.test' })
  const report = await WasteReport.create({
    reportedBy: citizen.user.id,
    category: 'organic',
    priority: 'high',
    reviewStatus: 'pending_review',
  })
  await Notification.create({
    recipient: admin.user.id,
    type: 'high_priority_report',
    title: 'High-priority report created',
    message: 'A high-priority waste report needs attention.',
    report: report._id,
    deduplicationKey: `test-report:${report.id}:high-priority-created:recipient:${admin.user.id}`,
  })
  const reviewCsrf = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  await admin.agent.patch(`/api/admin/reports/${report.id}/review`)
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', reviewCsrf.body.data.csrfToken)
    .send({ decision: 'rejected', reason: 'Outside the supported service area.' })
    .expect(200)

  const citizenNotifications = await citizen.agent.get('/api/notifications')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.ok(citizenNotifications.body.data.some((entry) => entry.type === 'report_rejected'))
  const adminNotifications = await admin.agent.get('/api/notifications')
    .set('Origin', frontendOrigin)
    .expect(200)
  assert.ok(adminNotifications.body.data.some((entry) => entry.type === 'high_priority_report'))

  const csrf = await admin.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
  const allRead = await admin.agent.patch('/api/notifications/read-all')
    .set('Origin', frontendOrigin)
    .set('X-CSRF-Token', csrf.body.data.csrfToken)
    .send({})
    .expect(200)
  assert.equal(allRead.body.data.updatedCount, 1)
})

test('overdue notifications are created once for the report owner and assigned collector', async () => {
  const citizen = await registerUser({ email: 'notifications-overdue-citizen@example.test' })
  const collector = await createRoleSession({ role: 'collector', email: 'notifications-overdue-collector@example.test' })
  const report = await createAssignedReport({ collectorId: collector.user.id, reportedBy: citizen.user.id })
  await WasteReport.collection.updateOne(
    { _id: report._id },
    { $set: { createdAt: new Date(Date.now() - 60 * 60 * 60 * 1000) } },
  )

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await citizen.agent.get('/api/notifications').set('Origin', frontendOrigin).expect(200)
    await collector.agent.get('/api/notifications').set('Origin', frontendOrigin).expect(200)
  }
  assert.equal(await Notification.countDocuments({
    report: report._id,
    type: 'report_overdue',
  }), 2)
  assert.equal(await Notification.countDocuments({
    recipient: citizen.user.id,
    report: report._id,
    type: 'report_overdue',
  }), 1)
  assert.equal(await Notification.countDocuments({
    recipient: collector.user.id,
    report: report._id,
    type: 'report_overdue',
  }), 1)
})

test('notification persistence failures do not fail successful report creation', async () => {
  const citizen = await registerUser({ email: 'notifications-failure-citizen@example.test' })
  const originalUpdateOne = Notification.updateOne
  Notification.updateOne = () => ({
    exec: async () => { throw new Error('notification database unavailable') },
  })
  try {
    const csrf = await citizen.agent.get('/api/auth/csrf').set('Origin', frontendOrigin).expect(200)
    const response = await postWithCsrf(citizen.agent, csrf.body.data.csrfToken, '/api/reports', {
      category: 'paper',
    }).expect(201)
    assert.ok(await WasteReport.exists({ _id: response.body.data.report.id }))
  } finally {
    Notification.updateOne = originalUpdateOne
  }
})
