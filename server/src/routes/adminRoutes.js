import { Router } from 'express'
import {
  assignReport,
  exportReports,
  getOverview,
  getReportById,
  listAssignments,
  listCollectors,
  listReports,
  listUsers,
  reviewReport,
  updateReportPriority,
} from '../controllers/adminController.js'
import { requireAuth, requireRole } from '../middleware/authentication.js'

const router = Router()

router.use(requireAuth, requireRole('admin'))
router.get('/overview', getOverview)
router.get('/reports/export.csv', exportReports)
router.get('/reports', listReports)
router.get('/reports/:id', getReportById)
router.patch('/reports/:id/review', reviewReport)
router.patch('/reports/:id/priority', updateReportPriority)
router.post('/reports/:id/assign', assignReport)
router.get('/users', listUsers)
router.get('/collectors', listCollectors)
router.get('/assignments', listAssignments)

export default router
