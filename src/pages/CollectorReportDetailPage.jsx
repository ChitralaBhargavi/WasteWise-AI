import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { collectorApi } from '../lib/api.js'
import { StatusBadge } from './CitizenDashboard.jsx'
import { PriorityBadge, ReportHistory, ReportLocationMap, ReportPhoto, ReportTiming, ReviewBadge } from '../components/ReportMedia.jsx'

const nextStatusByCurrentStatus = {
  reported: 'assigned',
  assigned: 'in_progress',
  in_progress: 'collected',
}
const maximumImageBytes = 5 * 1024 * 1024
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

export default function CollectorReportDetailPage() {
  const { id } = useParams()
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [selectedProof, setSelectedProof] = useState(null)
  const [proofPreview, setProofPreview] = useState('')
  const [proofError, setProofError] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const updateLock = useRef(false)
  const proofInput = useRef(null)
  const proofPreviewUrl = useRef('')

  useEffect(() => {
    let active = true
    collectorApi.get(id)
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

  useEffect(() => () => {
    if (proofPreviewUrl.current) URL.revokeObjectURL(proofPreviewUrl.current)
  }, [])

  function updateSelectedProof(file) {
    if (proofPreviewUrl.current) URL.revokeObjectURL(proofPreviewUrl.current)
    proofPreviewUrl.current = file ? URL.createObjectURL(file) : ''
    setProofPreview(proofPreviewUrl.current)
    setSelectedProof(file)
  }

  function handleProofChange(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!allowedImageTypes.has(file.type)) {
      setProofError('Choose a JPEG, PNG, or WebP cleanup photo.')
      updateSelectedProof(null)
      event.target.value = ''
      return
    }
    if (file.size > maximumImageBytes) {
      setProofError('The cleanup photo must be 5 MB or smaller.')
      updateSelectedProof(null)
      event.target.value = ''
      return
    }
    setProofError('')
    updateSelectedProof(file)
  }

  function removeProof() {
    updateSelectedProof(null)
    setProofError('')
    if (proofInput.current) proofInput.current.value = ''
  }

  async function handleStatusUpdate() {
    if (updateLock.current) return
    const nextStatus = nextStatusByCurrentStatus[report.status]
    if (!nextStatus) return
    if (nextStatus === 'collected' && !selectedProof) {
      setProofError('Choose an AFTER cleanup photo before marking this report collected.')
      return
    }

    updateLock.current = true
    setUpdating(true)
    setError('')
    setSuccess('')
    try {
      const response = await collectorApi.updateStatus(report.id, nextStatus, selectedProof)
      setReport(response.data.report)
      updateSelectedProof(null)
      if (proofInput.current) proofInput.current.value = ''
      setProofError('')
      setSuccess(nextStatus === 'collected'
        ? 'Collection marked complete and AFTER photo saved.'
        : `Report status updated to ${nextStatus.replaceAll('_', ' ')}.`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      updateLock.current = false
      setUpdating(false)
    }
  }

  return (
    <main className="container py-5" id="main-content" tabIndex={-1}>
      <Link className="small text-success text-decoration-none" to="/collector/dashboard">← Back to assigned reports</Link>
      {loading ? (
        <div className="py-5 text-center" aria-live="polite">
          <span className="spinner-border text-success" role="status">
            <span className="visually-hidden">Loading report...</span>
          </span>
          <p className="mt-3 text-secondary">Loading report...</p>
        </div>
      ) : error && !report ? (
        <div className="alert alert-danger mt-4" role="alert">
          <h1 className="h5">Unable to load this report</h1>
          <p className="mb-0">{error}</p>
        </div>
      ) : report ? (
        <article className="report-detail-card mt-4 p-4 p-lg-5">
          {success && <div className="alert alert-success" role="status" aria-live="polite">{success}</div>}
          {error && <div className="alert alert-danger" role="alert">{error}</div>}
          <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
            <div>
              <p className="eyebrow mb-2">Assigned waste report</p>
              <h1 className="h2 fw-bold text-capitalize">{report.category}</h1>
            </div>
            <StatusBadge status={report.status} />
            <ReviewBadge status={report.reviewStatus} />
            <PriorityBadge priority={report.priority} />
          </div>
          <ReportTiming dueAt={report.dueAt} isOverdue={report.isOverdue} />
          <p className="text-secondary">Submitted {new Date(report.createdAt).toLocaleString()}</p>
          {report.description && <p className="report-description">{report.description}</p>}
          <ReportPhoto imageUrl={report.imageUrl} label="Before cleanup photo" variant="before" />
          <ReportPhoto imageUrl={report.afterImageUrl} label="After cleanup photo" variant="after" />
          {report.location && (
            <section className="mt-4" aria-labelledby="collector-report-location-heading">
              <h2 className="h6 fw-bold" id="collector-report-location-heading">Location</h2>
              {report.location.address && <p className="mb-1">{report.location.address}</p>}
              <ReportLocationMap location={report.location} />
            </section>
          )}
          {nextStatusByCurrentStatus[report.status] ? (
            <section className="mt-4" aria-labelledby="collector-status-update-heading">
              <h2 className="h6 fw-bold" id="collector-status-update-heading">Update collection status</h2>
              <p className="text-secondary">Next status: <StatusBadge status={nextStatusByCurrentStatus[report.status]} /></p>
              {nextStatusByCurrentStatus[report.status] === 'collected' && (
                <div className="mb-3">
                  <label className="form-label" htmlFor="collection-proof-image">AFTER cleanup photo (required)</label>
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    aria-describedby={proofError ? 'collection-proof-error' : 'collection-proof-help'}
                    aria-invalid={proofError ? 'true' : undefined}
                    className="form-control"
                    id="collection-proof-image"
                    onChange={handleProofChange}
                    ref={proofInput}
                    type="file"
                  />
                  <div className="form-text" id="collection-proof-help">JPEG, PNG, or WebP · maximum 5 MB.</div>
                  {proofError && <p className="text-danger small mt-1 mb-0" id="collection-proof-error" role="alert">{proofError}</p>}
                  {proofPreview && (
                    <div className="mt-3">
                      <img className="report-photo report-photo-preview" src={proofPreview} alt="Preview of the selected AFTER cleanup photo" />
                      <div className="d-flex flex-wrap gap-2 mt-2">
                        <button className="btn btn-sm btn-outline-secondary" onClick={removeProof} type="button">Remove photo</button>
                        <label className="btn btn-sm btn-outline-success mb-0" htmlFor="collection-proof-image">Replace photo</label>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <button className="btn btn-success" disabled={updating} onClick={handleStatusUpdate} type="button">
                {updating
                  ? nextStatusByCurrentStatus[report.status] === 'collected' ? 'Saving proof and updating...' : 'Updating status...'
                  : nextStatusByCurrentStatus[report.status] === 'collected' ? 'Submit proof and mark collected' : 'Confirm status update'}
              </button>
            </section>
          ) : (
            <p className="text-secondary mt-4 mb-0">No further collector status updates are available.</p>
          )}
          <section className="mt-5" aria-labelledby="collector-status-history-heading">
            <h2 className="h5 fw-bold mb-3" id="collector-status-history-heading">Report history</h2>
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
