import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'

const csrfSigningKey = createHmac('sha256', env.jwtSecret)
  .update('wastewise-ai:csrf-token:v1')
  .digest()

export function createCsrfToken() {
  const nonce = randomBytes(32).toString('base64url')
  return `${nonce}.${signNonce(nonce)}`
}

export function isValidCsrfToken(token) {
  if (typeof token !== 'string') {
    return false
  }

  const [nonce, signature, ...extraParts] = token.split('.')
  if (!nonce || !signature || extraParts.length > 0) {
    return false
  }

  const expectedSignature = Buffer.from(signNonce(nonce))
  const actualSignature = Buffer.from(signature)

  return expectedSignature.length === actualSignature.length
    && timingSafeEqual(expectedSignature, actualSignature)
}

export function tokensMatch(cookieToken, headerToken) {
  if (typeof cookieToken !== 'string' || typeof headerToken !== 'string') {
    return false
  }

  const cookieBytes = Buffer.from(cookieToken)
  const headerBytes = Buffer.from(headerToken)

  return cookieBytes.length === headerBytes.length
    && timingSafeEqual(cookieBytes, headerBytes)
}

function signNonce(nonce) {
  return createHmac('sha256', csrfSigningKey).update(nonce).digest('base64url')
}
