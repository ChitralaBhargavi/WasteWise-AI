import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { env } from '../config/env.js'
import User from '../models/User.js'

export async function requireAuth(req, res, next) {
  const token = req.cookies?.[env.authCookieName]

  if (!token) {
    res.status(401).json({ error: { message: 'Authentication is required.' } })
    return
  }

  let claims
  try {
    claims = jwt.verify(token, env.jwtSecret, {
      algorithms: ['HS256'],
      issuer: env.jwtIssuer,
      audience: env.jwtAudience,
    })
  } catch {
    res.status(401).json({ error: { message: 'Authentication is required.' } })
    return
  }

  if (typeof claims === 'string' || !mongoose.isObjectIdOrHexString(claims.sub)) {
    res.status(401).json({ error: { message: 'Authentication is required.' } })
    return
  }

  try {
    const user = await User.findById(claims.sub)
      .select('_id name email role createdAt')
      .exec()

    if (!user) {
      res.status(401).json({ error: { message: 'Authentication is required.' } })
      return
    }

    req.user = toSafeUser(user)
    next()
  } catch (error) {
    next(error)
  }
}

export function requireRole(...roles) {
  return function authorizeRole(req, res, next) {
    if (!req.user) {
      res.status(401).json({ error: { message: 'Authentication is required.' } })
      return
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: { message: 'You are not authorized to access this resource.' } })
      return
    }

    next()
  }
}

export function toSafeUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  }
}
