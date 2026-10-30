import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminApi } from '../lib/api.js'
import { AdminNavigation, LoadingMessage } from './AdminDashboard.jsx'
import { EmptyMessage, Pagination } from './AdminReportsPage.jsx'
import { StatusBadge } from './CitizenDashboard.jsx'

const pageSize = 20

function fetchAdminAssignmentPage(requestedPage, stateFilter, requestedEligiblePage) {
  return Promise.all([
    adminApi.assignments({ page: requestedPage, limit: pageSize, status: stateFilter }),
    adminApi.overview(),
    adminApi.collectors(),
    adminApi.reports({ page: requestedEligiblePage, limit: 100, status: 'reported', reviewStatus: 'accepted' }),
  ])
}

export default function AdminAssignmentsPage() {
  const [assignments, setAssignments] = useState(null)
  const [overview, setOverview] = useState(null)
  const [collectors, setCollectors] = useState([])
  const [eligibleReports, setEligibleReports] = useState([])
  const [eligiblePage, setEligiblePage] = useState(1)
  const [eligiblePagination, setEligiblePagination] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [reportId, setReportId] = useState('')
  const [collectorId, setCollectorId] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const assignmentLock = useRef(false)

  const loadData = useCallback(async (requestedPage = 1, stateFilter = '', requestedEligiblePage = 1) => {
    setLoading(true)
    setError('')
    try {
      const [assignmentResult, overviewResult, collectorResult, reportResult] =
        await fetchAdminAssignmentPage(requestedPage, stateFilter, requestedEligiblePage)
      setAssignments(assignmentResult)
      setOverview(overviewResult.data)
      setCollectors(collectorResult.data)
      setEligibleReports(reportResult.data.filter((report) => !report.assignment))
      setEligiblePagination(reportResult.pagination)
      setEligiblePage(requestedEligiblePage)
      setPage(requestedPage)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    fetchAdminAssignmentPage(1, '', 1)
      .then(([assignmentResult, overviewResult, collectorResult, reportResult]) => {
        if (!active) return
        setAssignments(assignmentResult)
        setOverview(overviewResult.data)
        setCollectors(collectorResult.data)
        setEligibleReports(reportResult.data.filter((report) => !report.assignment))
        setEligiblePagination(reportResult.pagination)
      })
      .catch((requestError) => {
        if (active) setError(requestError.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  async function handleAssign(event) {
    event.preventDefault()
    if (assignmentLock.current) return
    if (!reportId || !collectorId) {
      setError('Select an eligible report and collector.')
      return
    }
    const chosenReport = eligibleReports.find((report) => report.id === reportId)
    const chosenCollector = collectors.find((collector) => collector.id === collectorId)
    if (!window.confirm(`Assign the ${chosenReport?.category ?? ''} report to ${chosenCollector?.name ?? 'this collector'}?`)) {
      return
    }

    assignmentLock.current = true
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      const response = await adminApi.assignReport(reportId, collectorId)
      setSuccess(`Report assigned to ${response.data.assignment.collector.name}.`)
      setReportId('')
      setCollectorId('')
      await loadData(1, statusFilter, eligiblePage)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      assignmentLock.current = false
      setSubmitting(false)
    }
  }

  return (
    <main className="container py-5" id="main-content" tabIndex={-1}>
      <header className="d-flex flex-wrap justify-content-between gap-3 mb-4">
        <div><p className="eyebrow mb-2">Administration</p><h1 className="h2 fw-bold">Collection assignments</h1></div>
        <AdminNavigation />
      </header>
      {error && <div className="alert alert-danger" id="assignment-form-error" role="alert">{error}</div>}
      {success && <div className="alert alert-success" role="status">{success}</div>}
      {loading ? <LoadingMessage /> : (
        <>
          <section className="admin-panel p-4 mb-4">
            <h2 className="h5 fw-bold">Assign an unassigned report</h2>
            <p className="text-secondary">Only accepted reports in the reported state without an active assignment can be assigned.</p>
            {!collectors.length && <div className="alert alert-info">No collector accounts are available. Provision a collector before assigning reports.</div>}
            {!eligibleReports.length && <div className="alert alert-info">There are no currently eligible unassigned reports.</div>}
            <form aria-describedby={error ? 'assignment-form-error' : undefined} className="row g-3 align-items-end" onSubmit={handleAssign}>
              <div className="col-md-5">
                <label className="form-label" htmlFor="assign-report">Eligible report</label>
                <select className="form-select" id="assign-report" onChange={(event) => setReportId(event.target.value)} required value={reportId}>
                  <option value="">Select a report</option>
                  {eligibleReports.map((report) => <option key={report.id} value={report.id}>{report.category} · {report.citizen?.name ?? 'Citizen unavailable'} · {new Date(report.createdAt).toLocaleDateString()}</option>)}
                </select>
                {eligiblePagination?.totalPages > 1 && (
                  <div className="d-flex align-items-center gap-2 mt-2">
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      disabled={eligiblePage <= 1}
                      onClick={() => { setReportId(''); loadData(page, statusFilter, eligiblePage - 1) }}
                      type="button"
                    >Previous eligible page</button>
                    <span className="small text-secondary">Page {eligiblePage} of {eligiblePagination.totalPages}</span>
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      disabled={eligiblePage >= eligiblePagination.totalPages}
                      onClick={() => { setReportId(''); loadData(page, statusFilter, eligiblePage + 1) }}
                      type="button"
                    >Next eligible page</button>
                  </div>
                )}
              </div>
              <div className="col-md-5">
                <label className="form-label" htmlFor="assign-collector">Collector</label>
                <select className="form-select" id="assign-collector" onChange={(event) => setCollectorId(event.target.value)} required value={collectorId}>
                  <option value="">Select a collector</option>
                  {collectors.map((collector) => <option key={collector.id} value={collector.id}>{collector.name} · {collector.email}</option>)}
                </select>
              </div>
              <div className="col-md-2">
                <button className="btn btn-success w-100" disabled={submitting || !collectors.length || !eligibleReports.length} type="submit">
                  {submitting ? 'Assigning...' : 'Assign'}
                </button>
              </div>
            </form>
          </section>
          <section className="row g-3 mb-4" aria-label="Assignment metrics">
            <div className="col-sm-6"><div className="admin-metric p-3"><span className="small text-secondary">Active assignments</span><strong className="d-block fs-3">{overview.collectionRequests.active}</strong></div></div>
            <div className="col-sm-6"><div className="admin-metric p-3"><span className="small text-secondary">Unassigned eligible reports</span><strong className="d-block fs-3">{overview.reports.unassignedEligible}</strong></div></div>
          </section>
          <div className="admin-panel p-3 mb-3 col-sm-6 col-lg-4">
            <label className="form-label" htmlFor="assignment-status">Assignment status</label>
            <select className="form-select" id="assignment-status" onChange={(event) => { setStatusFilter(event.target.value); loadData(1, event.target.value, eligiblePage) }} value={statusFilter}>
              <option value="">All statuses</option>
              {['pending', 'assigned', 'in_progress', 'collected', 'cancelled'].map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
            </select>
          </div>
          {assignments?.data.length ? (
            <>
              <div className="table-responsive report-table-wrap">
                <table className="table admin-data-table align-middle mb-0">
                  <caption className="visually-hidden">Collection assignment records</caption>
                  <thead><tr><th scope="col">Report</th><th scope="col">Collector</th><th scope="col">Assignment state</th><th scope="col">Report status</th><th scope="col">Assigned</th></tr></thead>
                  <tbody>
                    {assignments.data.map((assignment) => (
                      <tr key={assignment.id}>
                        <td>{assignment.report?.id
                          ? <Link to={`/admin/reports/${assignment.report.id}`}>{assignment.report.category ?? 'Report details'}</Link>
                          : 'Report unavailable'}</td>
                        <td>{assignment.collector?.name ?? 'Unassigned / unavailable'}</td>
                        <td className="text-capitalize">{assignment.status.replaceAll('_', ' ')}</td>
                        <td>{assignment.report?.status ? <StatusBadge status={assignment.report.status} /> : '—'}</td>
                        <td>{new Date(assignment.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                result={assignments}
                page={page}
                onChange={(requestedPage, stateFilter) => loadData(requestedPage, stateFilter, eligiblePage)}
                filters={statusFilter}
              />
            </>
          ) : <EmptyMessage>No collection requests match this filter.</EmptyMessage>}
          <p className="form-text mt-3">Dashboard statistics are refreshed after assignment. The assignment operation never silently replaces an existing active assignment.</p>
        </>
      )}
    </main>
  )
}
