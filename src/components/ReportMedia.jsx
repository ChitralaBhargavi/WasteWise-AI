import { lazy, Suspense, useEffect, useState } from 'react'
import { apiRequestBlob } from '../lib/api.js'

const InteractiveLocationMap = lazy(() => import('./InteractiveLocationMap.jsx'))

export function ReviewBadge({ status }) {
  const labels = {
    pending_review: 'Pending review',
    accepted: 'Accepted',
    rejected: 'Rejected',
  }
  const styles = {
    pending_review: 'text-bg-warning',
    accepted: 'text-bg-success',
    rejected: 'text-bg-danger',
  }
  return <span className={`badge ${styles[status] ?? 'text-bg-secondary'}`}>{labels[status] ?? 'Review unavailable'}</span>
}

export function PriorityBadge({ priority = 'medium' }) {
  const labels = {
    low: 'Priority: Low',
    medium: 'Priority: Medium',
    high: 'Priority: High',
    urgent: 'Priority: Urgent',
  }
  const styles = {
    low: 'text-bg-secondary',
    medium: 'text-bg-info',
    high: 'text-bg-warning',
    urgent: 'text-bg-danger',
  }
  const safePriority = Object.hasOwn(labels, priority) ? priority : 'medium'
  return <span className={`badge ${styles[safePriority]}`}>{labels[safePriority]}</span>
}

export function ReportTiming({ dueAt, isOverdue }) {
  return (
    <div className="small">
      <p className="mb-1">Service target: {dueAt ? new Date(dueAt).toLocaleString() : 'Unavailable'}</p>
      <p className="mb-0" role="status">{isOverdue ? 'Overdue — attention needed' : 'Not overdue'}</p>
    </div>
  )
}

export function CitizenServiceBadge({ serviceStatus }) {
  const display = {
    attention_needed: ['Attention needed', 'text-bg-warning'],
    being_handled: ['Being handled', 'text-bg-info'],
    collection_complete: ['Collection complete', 'text-bg-success'],
    report_rejected: ['Not accepted', 'text-bg-danger'],
    under_review: ['Awaiting review', 'text-bg-secondary'],
    report_received: ['Report received', 'text-bg-secondary'],
  }
  const [label, style] = display[serviceStatus] ?? display.report_received
  return <span className={`badge ${style}`}>{label}</span>
}

export function ReportHistory({ statusHistory = [], reviewHistory = [], collectionProofHistory = [] }) {
  const events = [
    ...statusHistory.map((entry) => ({
      kind: 'collection',
      at: new Date(entry.changedAt),
      label: entry.previousStatus
        ? `${entry.previousStatus.replaceAll('_', ' ')} → ${entry.status.replaceAll('_', ' ')}`
        : entry.status.replaceAll('_', ' '),
    })),
    ...reviewHistory.map((entry) => ({
      kind: 'review',
      at: new Date(entry.reviewedAt),
      label: `Report ${entry.decision}`,
      reason: entry.reason,
      reviewer: entry.reviewedBy?.name,
    })),
    ...collectionProofHistory.map((entry) => ({
      kind: 'proof',
      at: new Date(entry.submittedAt),
      label: 'Collection AFTER photo submitted',
    })),
  ].sort((first, second) => first.at - second.at)

  if (!events.length) return <p className="text-secondary">No report history is available.</p>
  return (
    <ol className="status-history">
      {events.map((event, index) => (
        <li key={`${event.kind}-${event.at.toISOString()}-${index}`}>
          <span className="text-capitalize">{event.label}</span>
          {event.reason && <p className="small mb-0">Reason: {event.reason}</p>}
          {event.reviewer && <p className="small mb-0">Reviewed by: {event.reviewer}</p>}
          <time className="small text-secondary" dateTime={event.at.toISOString()}>
            {event.at.toLocaleString()}
          </time>
        </li>
      ))}
    </ol>
  )
}

export function ReportPhoto({ imageUrl, label = 'Before photo', variant = 'before' }) {
  const [source, setSource] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!imageUrl) return undefined
    let active = true
    let objectUrl
    apiRequestBlob(imageUrl)
      .then((blob) => {
        if (active) {
          objectUrl = URL.createObjectURL(blob)
          setSource(objectUrl)
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError.message)
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [imageUrl])

  if (!imageUrl) return null
  return (
    <section className="mt-4" aria-labelledby={`report-photo-${variant}-heading`}>
      <h2 className="h6 fw-bold" id={`report-photo-${variant}-heading`}>{label}</h2>
      {error ? <p className="alert alert-warning" role="status">{error}</p> : source
        ? <img className="report-photo" src={source} alt={`${label} for this waste report`} />
        : <p className="text-secondary" role="status">Loading report photo...</p>}
    </section>
  )
}

export function ReportLocationMap(props) {
  if (!props.location || (props.location.latitude === undefined && !props.picker)) return null
  return (
    <Suspense fallback={<p className="text-secondary" role="status">Loading map controls...</p>}>
      <InteractiveLocationMap {...props} />
    </Suspense>
  )
}
