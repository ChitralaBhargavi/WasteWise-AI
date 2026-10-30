import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { reportsApi } from '../lib/api.js'
import { CitizenServiceBadge, ReviewBadge } from '../components/ReportMedia.jsx'

const pageSize = 10

export default function CitizenDashboard() {
  const [result, setResult] = useState(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadReports = useCallback(async (requestedPage) => {
    setLoading(true)
    setError('')
    try {
      const response = await reportsApi.list({ page: requestedPage, limit: pageSize })
      setResult(response)
      setPage(requestedPage)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let ignore = false

    reportsApi.list({ page: 1, limit: pageSize })
      .then((response) => {
        if (!ignore) {
          setResult(response)
          setPage(1)
        }
      })
      .catch((requestError) => {
        if (!ignore) {
          setError(requestError.message)
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false)
        }
      })

    return () => {
      ignore = true
    }
  }, [])

  return (
    <main className="container py-5" id="main-content" tabIndex={-1}>
      <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-3 mb-4">
        <div>
          <p className="eyebrow mb-2">Citizen dashboard</p>
          <h1 className="h2 fw-bold mb-1">My waste reports</h1>
          <p className="text-secondary mb-0">Review the reports you have submitted and their status history.</p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <Link className="btn btn-outline-success rounded-pill px-4" to="/classify">Classify an image</Link>
          <Link className="btn btn-success rounded-pill px-4" to="/reports/new">Create a report</Link>
        </div>
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
            <span className="visually-hidden">Loading your reports...</span>
          </span>
          <p className="mt-3 text-secondary">Loading your reports...</p>
        </div>
      ) : result?.data.length ? (
        <>
          <div className="table-responsive report-table-wrap">
            <table className="table align-middle mb-0">
              <caption className="visually-hidden">Your submitted waste reports</caption>
              <thead>
                <tr><th scope="col">Category</th><th scope="col">Reported</th><th scope="col">Collection status</th><th scope="col">Review</th><th scope="col">Update</th><th scope="col"><span className="visually-hidden">Details</span></th></tr>
              </thead>
              <tbody>
                {result.data.map((report) => (
                  <tr key={report.id}>
                    <td className="fw-semibold text-capitalize">{report.category}</td>
                    <td>{new Date(report.createdAt).toLocaleString()}</td>
                    <td><StatusBadge status={report.status} /></td>
                    <td><ReviewBadge status={report.reviewStatus} /></td>
                    <td><CitizenServiceBadge serviceStatus={report.serviceStatus} /></td>
                    <td className="text-end"><Link className="btn btn-sm btn-outline-success" to={`/reports/${report.id}`}>View details</Link></td>
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
              <button
                className="btn btn-outline-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => loadReports(page - 1)}
                type="button"
                aria-label="Previous reports page"
              >Previous</button>
              <button
                className="btn btn-outline-secondary btn-sm"
                disabled={page >= result.pagination.totalPages}
                onClick={() => loadReports(page + 1)}
                type="button"
                aria-label="Next reports page"
              >Next</button>
            </div>
          </div>
        </>
      ) : !error ? (
        <div className="report-empty text-center p-5">
          <span className="guide-icon" aria-hidden="true">＋</span>
          <h2 className="h5 fw-bold mt-3">No reports yet</h2>
          <p className="text-secondary">Your reports will appear here after you submit one.</p>
          <Link className="btn btn-success rounded-pill px-4" to="/reports/new">Create your first report</Link>
        </div>
      ) : null}
    </main>
  )
}

export function StatusBadge({ status }) {
  const styles = {
    reported: 'text-bg-primary',
    assigned: 'text-bg-info',
    in_progress: 'text-bg-warning',
    collected: 'text-bg-success',
    verified: 'text-bg-dark',
  }

  return (
    <span className={`badge ${styles[status] ?? 'text-bg-secondary'} text-capitalize`}>
      {status.replaceAll('_', ' ')}
    </span>
  )
}
