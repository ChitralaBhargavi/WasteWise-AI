import { env } from '../config/env.js'
import { isValidCsrfToken, tokensMatch } from '../utils/csrfTokens.js'

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

export function csrfProtection(req, _res, next) {
  if (safeMethods.has(req.method)) {
    next()
    return
  }

  if (!hasAllowedRequestOrigin(req)) {
    next(createCsrfError('Request origin is not allowed.'))
    return
  }

  const cookieToken = req.cookies?.[env.csrfCookieName]
  const headerToken = req.get('x-csrf-token')

  if (!tokensMatch(cookieToken, headerToken) || !isValidCsrfToken(headerToken)) {
    next(createCsrfError('A valid CSRF token is required.'))
    return
  }

  next()
}

function hasAllowedRequestOrigin(req) {
  const origin = req.get('origin')
  const referer = req.get('referer')

  if (origin && !env.frontendOrigins.includes(origin)) {
    return false
  }

  if (referer) {
    try {
      if (!env.frontendOrigins.includes(new URL(referer).origin)) {
        return false
      }
    } catch {
      return false
    }
  }

  return Boolean(origin || referer)
}

function createCsrfError(message) {
  const error = new Error(message)
  error.status = 403
  return error
}
