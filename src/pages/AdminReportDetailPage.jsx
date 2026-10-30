import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { adminApi } from '../lib/api.js'
import { StatusBadge } from './CitizenDashboard.jsx'
import { AdminNavigation, LoadingMessage } from './AdminDashboard.jsx'
import { PriorityBadge, ReportHistory, ReportLocationMap, ReportPhoto, ReportTiming, ReviewBadge } from '../components/ReportMedia.jsx'

export default function AdminReportDetailPage() {
  const { id } = useParams()
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reviewReason, setReviewReason] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [priority, setPriority] = useState('medium')
  const [savingPriority, setSavingPriority] = useState(false)
  const [priorityError, setPriorityError] = useState('')
  const [priorityMessage, setPriorityMessage] = useState('')
  const reviewLock = useRef(false)
  const priorityLock = useRef(false)

  useEffect(() => {
    let active = true
    adminApi.report(id)
      .then((response) => {
        if (active) {
          setReport(response.data.report)
          setPriority(response.data.report.priority ?? 'medium')
        }
      })
      .catch((requestError) => { if (active) setError(requestError.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])

  async function handleReview(decision) {
    if (reviewLock.current) return
    if (decision === 'rejected' && !reviewReason.trim()) {
      setReviewError('Enter a reason before rejecting this report.')
      return
    }
    reviewLock.current = true
    setReviewing(true)
    setReviewError('')
    try {
      const response = await adminApi.reviewReport(id, decision, reviewReason.trim())
      setReport((current) => ({ ...current, ...response.data.report }))
      setReviewReason('')
    } catch (requestError) {
      setReviewError(requestError.message)
    } finally {
      reviewLock.current = false
      setReviewing(false)
    }
  }

  async function handlePriorityUpdate(event) {
    event.preventDefault()
    if (priorityLock.current || !report || priority === (report.priority ?? 'medium')) return
    priorityLock.current = true
    setSavingPriority(true)
    setPriorityError('')
    setPriorityMessage('')
    try {
      const response = await adminApi.updatePriority(id, priority)
      setReport((current) => ({ ...current, ...response.data.report }))
      setPriorityMessage('Report priority and service target updated.')
    } catch (requestError) {
      setPriorityError(requestError.message)
    } finally {
      priorityLock.current = false
      setSavingPriority(false)
    }
  }

  return (
    <main className="container py-5" id="main-content" tabIndex={-1}>
      <header className="d-flex flex-wrap justify-content-between gap-3 mb-4">
        <div><p className="eyebrow mb-2">Administration</p><h1 className="h2 fw-bold">Report details</h1></div>
        <AdminNavigation />
      </header>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {loading ? <LoadingMessage /> : report ? (
        <article className="report-detail-card p-4 p-lg-5">
          <div className="d-flex flex-wrap justify-content-between gap-3">
            <div><p className="eyebrow mb-2">Waste report</p><h2 className="h3 text-capitalize">{report.category}</h2></div>
            <div className="d-flex align-items-start flex-wrap gap-2"><StatusBadge status={report.status} /><ReviewBadge status={report.reviewStatus} /><PriorityBadge priority={report.priority} /></div>
          </div>
          <ReportTiming dueAt={report.dueAt} isOverdue={report.isOverdue} />
          <p>{report.description || 'No description supplied.'}</p>
          <p className="text-secondary">Citizen: {report.citizen?.name ?? 'Legacy / unavailable'} {report.citizen?.email ? `(${report.citizen.email})` : ''}</p>
          <form className="admin-panel p-3 mt-4" onSubmit={handlePriorityUpdate}>
            <label className="form-label" htmlFor="report-priority">Set report priority</label>
            <div className="d-flex flex-wrap gap-2">
              <select className="form-select w-auto" id="report-priority" onChange={(event) => setPriority(event.target.value)} value={priority}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
              <button className="btn btn-outline-success" disabled={savingPriority || priority === (report.priority ?? 'medium')} type="submit">
                {savingPriority ? 'Saving priority...' : 'Update priority'}
              </button>
            </div>
            {priorityError && <p className="text-danger mt-2 mb-0" role="alert">{priorityError}</p>}
            {priorityMessage && <p className="text-success mt-2 mb-0" role="status">{priorityMessage}</p>}
          </form>
          <ReportPhoto imageUrl={report.imageUrl} label="Before cleanup photo" variant="before" />
          <ReportPhoto imageUrl={report.afterImageUrl} label="After cleanup photo" variant="after" />
          {report.location && (
            <section className="mt-4" aria-labelledby="admin-report-location-heading">
              <h3 className="h5" id="admin-report-location-heading">Location</h3>
              {report.location.address && <p>{report.location.address}</p>}
              <ReportLocationMap location={report.location} />
            </section>
          )}
          {report.reviewStatus === 'pending_review' && (
            <section className="admin-panel p-3 mt-4" aria-labelledby="report-review-heading">
              <h3 className="h5" id="report-review-heading">Review this report</h3>
              {reviewError && <p className="alert alert-danger py-2" role="alert">{reviewError}</p>}
              <label className="form-label" htmlFor="report-rejection-reason">Rejection reason (required only when rejecting)</label>
              <textarea className="form-control mb-3" id="report-rejection-reason" maxLength={500} onChange={(event) => setReviewReason(event.target.value)} rows="3" value={reviewReason} />
              <div className="d-flex flex-wrap gap-2">
                <button className="btn btn-success" disabled={reviewing} onClick={() => handleReview('accepted')} type="button">
                  {reviewing ? 'Saving review...' : 'Accept report'}
                </button>
                <button className="btn btn-outline-danger" disabled={reviewing} onClick={() => handleReview('rejected')} type="button">
                  {reviewing ? 'Saving review...' : 'Reject report'}
                </button>
              </div>
            </section>
          )}
          <section className="mt-4">
            <h3 className="h5">Assignments</h3>
            {report.assignments.length ? (
              <ul className="list-group">
                {report.assignments.map((assignment) => (
                  <li className="list-group-item d-flex justify-content-between gap-3" key={assignment.id}>
                    <span>{assignment.collector?.name ?? 'Collector unavailable'} · {assignment.collector?.email ?? 'No account details'}</span>
                    <span className="text-capitalize">{assignment.status}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-secondary">No assignment records.</p>}
          </section>
          <section className="mt-4">
            <h3 className="h5">Report history</h3>
            <ReportHistory
              collectionProofHistory={report.collectionProofHistory}
              statusHistory={report.statusHistory}
              reviewHistory={report.reviewHistory}
            />
          </section>
          <Link className="btn btn-outline-success mt-4" to="/admin/reports">Back to reports</Link>
        </article>
      ) : null}
    </main>
  )
}
