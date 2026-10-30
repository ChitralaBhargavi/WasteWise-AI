import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { reportsApi } from '../lib/api.js'
import { StatusBadge } from './CitizenDashboard.jsx'
import { CitizenServiceBadge, ReportHistory, ReportLocationMap, ReportPhoto, ReviewBadge } from '../components/ReportMedia.jsx'

export default function ReportDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    reportsApi.get(id)
      .then((response) => {
        if (active) setReport(response.data.report)
      })
      .catch((requestError) => {
        if (active) setError(requestError.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => { active = false }
  }, [id])

  return (
    <main className="container py-5" id="main-content" tabIndex={-1}>
      <Link className="small text-success text-decoration-none" to="/dashboard">← Back to my reports</Link>
      {loading ? (
        <div className="py-5 text-center" aria-live="polite">
          <span className="spinner-border text-success" role="status">
            <span className="visually-hidden">Loading report...</span>
          </span>
          <p className="mt-3 text-secondary">Loading report...</p>
        </div>
      ) : error ? (
        <div className="alert alert-danger mt-4" role="alert">
          <h1 className="h5">Unable to load this report</h1>
          <p className="mb-0">{error}</p>
        </div>
      ) : report ? (
        <article className="report-detail-card mt-4 p-4 p-lg-5">
          {location.state?.created && <div className="alert alert-success" role="status">Your report was saved successfully.</div>}
          <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
            <div>
              <p className="eyebrow mb-2">Waste report</p>
              <h1 className="h2 fw-bold text-capitalize">{report.category}</h1>
            </div>
            <StatusBadge status={report.status} />
            <ReviewBadge status={report.reviewStatus} />
          </div>
          <p className="text-secondary">Submitted {new Date(report.createdAt).toLocaleString()}</p>
          {report.description && <p className="report-description">{report.description}</p>}
          <CitizenServiceBadge serviceStatus={report.serviceStatus} />
          {report.serviceStatus === 'attention_needed' ? (
            <p className="alert alert-warning" role="status">
              Attention needed: this report is past its service target. Service targets are not guarantees.
            </p>
          ) : null}
          <ReportPhoto imageUrl={report.imageUrl} label="Before cleanup photo" variant="before" />
          <ReportPhoto imageUrl={report.afterImageUrl} label="After cleanup photo" variant="after" />
          {report.location && (
            <section className="mt-4" aria-labelledby="report-location-heading">
              <h2 className="h6 fw-bold" id="report-location-heading">Location</h2>
              {report.location.address && <p className="mb-1">{report.location.address}</p>}
              <ReportLocationMap location={report.location} />
            </section>
          )}

          <section className="mt-5" aria-labelledby="status-history-heading">
            <h2 className="h5 fw-bold mb-3" id="status-history-heading">Report history</h2>
            <ReportHistory
              collectionProofHistory={report.collectionProofHistory}
              statusHistory={report.statusHistory}
              reviewHistory={report.reviewHistory}
            />
          </section>
        </article>
      ) : null}
    </main>
  )
}
