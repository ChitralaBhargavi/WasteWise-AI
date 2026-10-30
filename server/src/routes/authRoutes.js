import { Router } from 'express'
import {
  getCsrfToken,
  getCurrentUser,
  login,
  logout,
  register,
} from '../controllers/authController.js'
import { requireAuth } from '../middleware/authentication.js'

const router = Router()

router.get('/csrf', getCsrfToken)
router.post('/register', register)
router.post('/login', login)
router.post('/logout', logout)
router.get('/me', requireAuth, getCurrentUser)

export default router
