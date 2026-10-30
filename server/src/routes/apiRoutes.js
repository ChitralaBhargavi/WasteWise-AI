import { Router } from 'express'
import authRoutes from './authRoutes.js'
import adminRoutes from './adminRoutes.js'
import collectorRoutes from './collectorRoutes.js'
import healthRoutes from './healthRoutes.js'
import reportRoutes from './reportRoutes.js'
import aiRoutes from './aiRoutes.js'
import notificationRoutes from './notificationRoutes.js'
import { getAuthorizedReportImage } from '../controllers/reportImageController.js'
import { requireAuth } from '../middleware/authentication.js'

const router = Router()

router.use('/health', healthRoutes)
router.use('/auth', authRoutes)
router.use('/notifications', notificationRoutes)
router.get('/reports/:id/image', requireAuth, getAuthorizedReportImage)
router.use('/admin', adminRoutes)
router.use('/reports', reportRoutes)
router.use('/ai', aiRoutes)
router.use('/collector', collectorRoutes)

export default router
