import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collectorApi } from '../lib/api.js'
import { StatusBadge } from './CitizenDashboard.jsx'
import { PriorityBadge, ReportTiming, ReviewBadge } from '../components/ReportMedia.jsx'

const pageSize = 10

export default function CollectorDashboard() {
  const [result, setResult] = useState(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadReports = useCallback(async (requestedPage) => {
    setLoading(true)
    setError('')
    try {
      const response = await collectorApi.list({ page: requestedPage, limit: pageSize })
      setResult(response)
      setPage(requestedPage)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    collectorApi.list({ page: 1, limit: pageSize })
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
  }, [])

  return (
    <main className="container py-5" id="main-content" tabIndex={-1}>
      <div className="mb-4">
        <p className="eyebrow mb-2">Collector dashboard</p>
        <h1 className="h2 fw-bold mb-1">Assigned waste reports</h1>
        <p className="text-secondary mb-0">Review assigned reports and update their collection progress.</p>
        <p className="form-text mb-0">Due times are service targets, not guarantees.</p>
      </div>

      {error && (
        <div className="alert alert-danger d-flex justify-content-between align-items-center gap-3" role="alert">
          <span>{error}</span>
          <button className="btn btn-sm btn-outline-danger" onClick={() => loadReports(page)} type="button">
            Try again
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-5 text-center" aria-live="polite">
          <span className="spinner-border text-success" role="status">
            <span className="visually-hidden">Loading assigned reports...</span>
          </span>
          <p className="mt-3 text-secondary">Loading assigned reports...</p>
        </div>
      ) : result?.data.length ? (
        <>
          <div className="table-responsive report-table-wrap">
            <table className="table align-middle mb-0">
              <caption className="visually-hidden">Waste reports assigned to you</caption>
              <thead>
                <tr><th scope="col">Category</th><th scope="col">Reported</th><th scope="col">Collection status</th><th scope="col">Review</th><th scope="col">Priority / due</th><th scope="col"><span className="visually-hidden">Details</span></th></tr>
              </thead>
              <tbody>
                {result.data.map((report) => (
                  <tr key={report.id}>
                    <td className="fw-semibold text-capitalize">{report.category}</td>
                    <td>{new Date(report.createdAt).toLocaleString()}</td>
                    <td><StatusBadge status={report.status} /></td>
                    <td><ReviewBadge status={report.reviewStatus} /></td>
                    <td><PriorityBadge priority={report.priority} /><ReportTiming dueAt={report.dueAt} isOverdue={report.isOverdue} /></td>
                    <td className="text-end">
                      <Link className="btn btn-sm btn-outline-success" to={`/collector/reports/${report.id}`}>View details</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="report-pagination d-flex justify-content-between align-items-center gap-2 mt-3">
            <span className="small text-secondary">
              Page {result.pagination.page} of {Math.max(result.pagination.totalPages, 1)} · {result.pagination.totalItems} report(s)
            </span>
            <div className="report-pagination-controls">
              <button aria-label="Previous reports page" className="btn btn-outline-secondary btn-sm" disabled={page <= 1} onClick={() => loadReports(page - 1)} type="button">Previous</button>
              <button aria-label="Next reports page" className="btn btn-outline-secondary btn-sm" disabled={page >= result.pagination.totalPages} onClick={() => loadReports(page + 1)} type="button">Next</button>
            </div>
          </div>
        </>
      ) : !error ? (
        <div className="report-empty text-center p-5">
          <h2 className="h5 fw-bold">No reports assigned</h2>
          <p className="text-secondary mb-0">Reports assigned to your account will appear here.</p>
        </div>
      ) : null}
    </main>
  )
}
