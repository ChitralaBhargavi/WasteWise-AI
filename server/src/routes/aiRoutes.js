import { Router } from 'express'
import { classifyImage } from '../controllers/aiController.js'
import { requireAuth, requireRole } from '../middleware/authentication.js'
import { receiveImage } from '../middleware/imageUpload.js'

const router = Router()

router.post('/classify', requireAuth, requireRole('citizen'), receiveImage, classifyImage)

export default router
