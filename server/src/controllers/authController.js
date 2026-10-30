import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { env } from '../config/env.js'
import { authCookieOptions, clearAuthCookie, csrfCookieOptions } from '../utils/authCookies.js'
import { createCsrfToken } from '../utils/csrfTokens.js'
import { toSafeUser } from '../middleware/authentication.js'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const allowedCredentialFields = new Set(['name', 'email', 'password'])
const dummyPasswordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12)

export function getCsrfToken(_req, res) {
  const csrfToken = createCsrfToken()

  res.cookie(env.csrfCookieName, csrfToken, csrfCookieOptions)
  res.set('Cache-Control', 'no-store')
  res.status(200).json({ data: { csrfToken } })
}

export async function register(req, res) {
  rejectUnknownFields(req.body, true)
  const { name, email, password } = validateCredentials(req.body, { requireName: true })

  const user = await User.create({
    name,
    email,
    passwordHash: password,
    role: 'citizen',
  })

  setAuthCookie(res, user)
  res.status(201).json({ data: { user: toSafeUser(user) } })
}

export async function login(req, res) {
  rejectUnknownFields(req.body, false)
  const { email, password } = validateCredentials(req.body)
  const user = await User.findOne({ email }).select('+passwordHash').exec()
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? dummyPasswordHash)

  if (!user || !user.passwordHash || !passwordMatches) {
    res.status(401).json({ error: { message: 'Invalid email or password.' } })
    return
  }

  setAuthCookie(res, user)
  res.status(200).json({ data: { user: toSafeUser(user) } })
}

export function logout(_req, res) {
  clearAuthCookie(res)
  res.status(200).json({ data: { message: 'Logged out.' } })
}

export function getCurrentUser(req, res) {
  res.status(200).json({ data: { user: req.user } })
}

function setAuthCookie(res, user) {
  const token = jwt.sign(
    { sub: user._id.toString() },
    env.jwtSecret,
    {
      algorithm: 'HS256',
      expiresIn: env.jwtExpiresInSeconds,
      issuer: env.jwtIssuer,
      audience: env.jwtAudience,
    },
  )

  res.cookie(env.authCookieName, token, authCookieOptions)
}

function validateCredentials(body, { requireName = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createValidationError('Request body must be a JSON object.')
  }

  if (requireName) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      throw createValidationError('name is required.')
    }

    if (body.name.trim().length > 80) {
      throw createValidationError('name cannot exceed 80 characters.')
    }
  }

  if (typeof body.email !== 'string') {
    throw createValidationError('email is required.')
  }

  const email = body.email.trim().toLowerCase()
  if (email.length > 254 || !emailPattern.test(email)) {
    throw createValidationError('Enter a valid email address.')
  }

  if (typeof body.password !== 'string') {
    throw createValidationError('password is required.')
  }

  const passwordLength = Array.from(body.password).length
  if (passwordLength < 12) {
    throw createValidationError('Password must be at least 12 characters long.')
  }

  if (Buffer.byteLength(body.password, 'utf8') > 72) {
    throw createValidationError('Password cannot exceed 72 UTF-8 bytes.')
  }

  return {
    ...(requireName ? { name: body.name.trim() } : {}),
    email,
    password: body.password,
  }
}

function rejectUnknownFields(body, allowName) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return
  }

  const allowedFields = allowName ? allowedCredentialFields : new Set(['email', 'password'])
  const unsupportedField = Object.keys(body).find((field) => !allowedFields.has(field))
  if (unsupportedField) {
    throw createValidationError(`Unsupported request field: ${unsupportedField}.`)
  }
}

function createValidationError(message) {
  const error = new Error(message)
  error.status = 400
  return error
}
