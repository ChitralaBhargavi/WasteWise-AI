import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { adminApi } from '../lib/api.js'
import { StatusBadge } from './CitizenDashboard.jsx'
import { AdminNavigation, LoadingMessage } from './AdminDashboard.jsx'
import { PriorityBadge, ReportTiming, ReviewBadge } from '../components/ReportMedia.jsx'

const statuses = ['reported', 'assigned', 'in_progress', 'collected', 'verified']
const reviewStatuses = ['pending_review', 'accepted', 'rejected']
const categories = ['plastic', 'paper', 'metal', 'glass', 'organic', 'other']
const priorities = ['low', 'medium', 'high', 'urgent']
const pageSize = 20

export default function AdminReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [status, setStatus] = useState(searchParams.get('status') ?? '')
  const [category, setCategory] = useState(searchParams.get('category') ?? '')
  const [reviewStatus, setReviewStatus] = useState(searchParams.get('reviewStatus') ?? '')
  const [priority, setPriority] = useState(searchParams.get('priority') ?? '')
  const [overdue, setOverdue] = useState(searchParams.get('overdue') ?? '')
  const [result, setResult] = useState(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportMessage, setExportMessage] = useState('')

  const loadReports = useCallback(async (requestedPage, filters = { status, category, reviewStatus, priority, overdue }) => {
    setLoading(true)
    setError('')
    try {
      const response = await adminApi.reports({ page: requestedPage, limit: pageSize, ...filters })
      setResult(response)
      setPage(requestedPage)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [status, category, reviewStatus, priority, overdue])

  useEffect(() => {
    let active = true
    adminApi.reports({ page: 1, limit: pageSize, status, category, reviewStatus, priority, overdue })
      .then((response) => {
        if (active) {
          setResult(response)
          setPage(1)
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [status, category, reviewStatus, priority, overdue])

  function applyFilters(event) {
    event.preventDefault()
    const next = {}
    if (status) next.status = status
    if (category) next.category = category
    if (reviewStatus) next.reviewStatus = reviewStatus
    if (priority) next.priority = priority
    if (overdue) next.overdue = overdue
    setSearchParams(next)
  }

  async function exportReports() {
    setExporting(true)
    setExportError('')
    setExportMessage('')
    try {
      const blob = await adminApi.exportReports({ status, category, reviewStatus, priority, overdue })
      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = 'wastewise-reports.csv'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      setExportMessage('CSV download started for all reports matching the selected filters.')
    } catch (requestError) {
      setExportError(requestError.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <main className="container py-5" id="main-content" tabIndex={-1}>
      <header className="d-flex flex-wrap justify-content-between gap-3 mb-4">
        <div><p className="eyebrow mb-2">Administration</p><h1 className="h2 fw-bold">Waste reports</h1></div>
        <AdminNavigation />
      </header>
      <form className="admin-panel p-3 mb-4 d-flex flex-wrap align-items-end gap-3" onSubmit={applyFilters}>
        <div>
          <label className="form-label" htmlFor="admin-report-status">Status</label>
          <select className="form-select" id="admin-report-status" onChange={(event) => { setLoading(true); setStatus(event.target.value) }} value={status}>
            <option value="">All statuses</option>
            {statuses.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label" htmlFor="admin-report-category">Category</label>
          <select className="form-select" id="admin-report-category" onChange={(event) => { setLoading(true); setCategory(event.target.value) }} value={category}>
            <option value="">All categories</option>
            {categories.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label" htmlFor="admin-report-review-status">Review</label>
          <select className="form-select" id="admin-report-review-status" onChange={(event) => { setLoading(true); setReviewStatus(event.target.value) }} value={reviewStatus}>
            <option value="">All review states</option>
            {reviewStatuses.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label" htmlFor="admin-report-priority">Priority</label>
          <select className="form-select" id="admin-report-priority" onChange={(event) => { setLoading(true); setPriority(event.target.value) }} value={priority}>
            <option value="">All priorities</option>
            {priorities.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label" htmlFor="admin-report-overdue">Due status</label>
          <select className="form-select" id="admin-report-overdue" onChange={(event) => { setLoading(true); setOverdue(event.target.value) }} value={overdue}>
            <option value="">All due states</option>
            <option value="true">Overdue</option>
            <option value="false">Not overdue</option>
          </select>
        </div>
        <button className="btn btn-success" type="submit">Apply filters</button>
        <button className="btn btn-outline-secondary" onClick={() => { setLoading(true); setStatus(''); setCategory(''); setReviewStatus(''); setPriority(''); setOverdue(''); setSearchParams({}) }} type="button">Clear</button>
        <button className="btn btn-outline-success ms-sm-auto" disabled={exporting} onClick={exportReports} type="button">
          {exporting ? 'Exporting...' : 'Export filtered CSV'}
        </button>
      </form>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {exportError && <div className="alert alert-danger" role="alert">{exportError}</div>}
      {exportMessage && <div className="alert alert-success" role="status">{exportMessage}</div>}
      <p className="form-text mb-3">Export includes every matching report, not only the current page.</p>
      <p className="form-text mb-3">Due times are service targets, not guarantees.</p>
      {loading ? <LoadingMessage /> : result?.data.length ? (
        <>
          <div className="table-responsive report-table-wrap">
            <table className="table admin-data-table align-middle mb-0">
              <caption className="visually-hidden">Waste report search results</caption>
              <thead><tr><th scope="col">Category</th><th scope="col">Collection status</th><th scope="col">Review</th><th scope="col">Priority / due</th><th scope="col">Citizen</th><th scope="col">Assigned collector</th><th scope="col">Created</th><th scope="col"><span className="visually-hidden">Details</span></th></tr></thead>
              <tbody>
                {result.data.map((report) => (
                  <tr key={report.id}>
                    <td className="text-capitalize">{report.category}</td>
                    <td><StatusBadge status={report.status} /></td>
                    <td><ReviewBadge status={report.reviewStatus} /></td>
                    <td><PriorityBadge priority={report.priority} /><ReportTiming dueAt={report.dueAt} isOverdue={report.isOverdue} /></td>
                    <td>{report.citizen?.name ?? 'Legacy / unavailable'}<small className="d-block text-secondary">{report.citizen?.email}</small></td>
                    <td>{report.assignment?.collector?.name ?? 'Unassigned'}</td>
                    <td>{new Date(report.createdAt).toLocaleString()}</td>
                    <td><Link className="btn btn-sm btn-outline-success" to={`/admin/reports/${report.id}`}>Details</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination result={result} page={page} onChange={loadReports} filters={{ status, category, reviewStatus, priority, overdue }} />
        </>
      ) : !error ? <EmptyMessage>No reports match these filters.</EmptyMessage> : null}
    </main>
  )
}

export function Pagination({ result, page, onChange, filters = {} }) {
  return (
    <div className="report-pagination d-flex justify-content-between align-items-center gap-2 mt-3">
      <span className="small text-secondary">Page {result.pagination.page} of {Math.max(result.pagination.totalPages, 1)} · {result.pagination.totalItems} record(s)</span>
      <div className="report-pagination-controls">
        <button aria-label="Previous page" className="btn btn-outline-secondary btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1, filters)} type="button">Previous</button>
        <button aria-label="Next page" className="btn btn-outline-secondary btn-sm" disabled={page >= result.pagination.totalPages} onClick={() => onChange(page + 1, filters)} type="button">Next</button>
      </div>
    </div>
  )
}

export function EmptyMessage({ children }) {
  return <div className="report-empty text-center p-5"><p className="text-secondary mb-0">{children}</p></div>
}
