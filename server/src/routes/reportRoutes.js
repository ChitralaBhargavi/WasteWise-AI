import { Router } from 'express'
import { createReport, getMyReportById, listMyReports } from '../controllers/reportController.js'
import { requireAuth, requireRole } from '../middleware/authentication.js'
import { receiveReportImage } from '../middleware/reportImageUpload.js'

const router = Router()

router.use(requireAuth, requireRole('citizen'))
router.route('/')
  .post(receiveReportImage, createReport)
  .get(listMyReports)
router.get('/:id', getMyReportById)

export default router
