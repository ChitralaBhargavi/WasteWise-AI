import { Router } from 'express'
import {
  getAssignedReportById,
  listAssignedReports,
  updateAssignedReportStatus,
} from '../controllers/collectorController.js'
import { requireAuth, requireRole } from '../middleware/authentication.js'
import { receiveReportImage } from '../middleware/reportImageUpload.js'

const router = Router()

router.use(requireAuth, requireRole('collector'))
router.get('/reports', listAssignedReports)
router.get('/reports/:id', getAssignedReportById)
router.patch('/reports/:id/status', receiveReportImage, updateAssignedReportStatus)

export default router
