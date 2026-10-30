import { env } from '../config/env.js'

const cookieBaseOptions = Object.freeze({
  path: '/api',
  sameSite: env.cookieSameSite,
  secure: env.cookieSecure,
})

export const authCookieOptions = Object.freeze({
  ...cookieBaseOptions,
  httpOnly: true,
  maxAge: env.jwtExpiresInSeconds * 1000,
})

export const csrfCookieOptions = Object.freeze({
  ...cookieBaseOptions,
  httpOnly: true,
  maxAge: 60 * 60 * 1000,
})

export function clearAuthCookie(res) {
  res.clearCookie(env.authCookieName, {
    ...cookieBaseOptions,
    httpOnly: true,
  })
}
