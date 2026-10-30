import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminApi } from '../lib/api.js'

export default function AdminDashboard() {
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    adminApi.overview()
      .then((response) => {
        if (active) setOverview(response.data)
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
      <div className="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4">
        <div>
          <p className="eyebrow mb-2">Administration</p>
          <h1 className="h2 fw-bold mb-1">WasteWise overview</h1>
          <p className="text-secondary mb-0">Live counts and trends from application records.</p>
        </div>
        <AdminNavigation />
      </div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {loading ? <LoadingMessage /> : overview ? (
        <>
          <section className="row g-3 mb-4" aria-label="Overview metrics">
            <MetricCard label="Registered users" value={overview.users.total} detail={`${overview.users.citizens} citizens · ${overview.users.collectors} collectors`} />
            <MetricCard label="Waste reports" value={overview.reports.total} detail={`${overview.reports.unassignedEligible} reported and unassigned`} />
            <MetricCard label="Active assignments" value={overview.collectionRequests.active} detail={`${overview.collectionRequests.cancelled} cancelled requests`} />
            <MetricCard label="Tracked collectors" value={overview.collectorWorkload.length} detail="Collectors with active assignments" />
            <MetricCard label="Pending review" value={overview.reports.pendingReview} detail="Awaiting an administrator decision" />
            <MetricCard label="Active reports" value={overview.reports.active} detail="Assigned or in progress" />
            <MetricCard label="Overdue reports" value={overview.reports.overdue} detail="Open reports past their service target" />
            <MetricCard label="High / urgent" value={overview.reports.urgentOrHigh} detail="Open reports with elevated priority" />
          </section>
          <div className="row g-4">
            <div className="col-lg-6">
              <DataBars title="Reports by waste category" rows={overview.reports.byCategory} labelKey="category" />
            </div>
            <div className="col-lg-6">
              <DataBars title="Reports by current status" rows={overview.reports.byStatus} labelKey="status" />
            </div>
            <div className="col-lg-6">
              <DataBars title="Reports by review decision" rows={overview.reports.byReviewStatus} labelKey="status" />
            </div>
            <div className="col-lg-6">
              <section className="admin-panel p-4 h-100">
                <h2 className="h5 fw-bold">Active collector workload</h2>
                {overview.collectorWorkload.length ? (
                  <ul className="list-group list-group-flush">
                    {overview.collectorWorkload.map((collector) => (
                      <li className="list-group-item d-flex justify-content-between gap-3 px-0" key={collector.collectorId}>
                        <span>{collector.name ?? 'Unavailable account'} <span className="d-block small text-secondary">{collector.email ?? ''}</span></span>
                        <strong>{collector.activeAssignments}</strong>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-secondary mb-0">No active collector assignments.</p>}
                <p className="form-text mt-3 mb-0">Workload counts non-cancelled CollectionRequest records with a collector.</p>
              </section>
            </div>
            <div className="col-lg-6">
              <section className="admin-panel p-4 h-100">
                <h2 className="h5 fw-bold">Reports created · last 30 days</h2>
                <DailyActivity rows={overview.reports.createdPerDayLast30Days} />
                <p className="form-text mb-0">Counts use each report's createdAt date in UTC.</p>
              </section>
            </div>
          </div>
        </>
      ) : null}
    </main>
  )
}

export function AdminNavigation() {
  return (
    <nav className="admin-navigation d-flex flex-wrap gap-2" aria-label="Admin sections">
      <Link className="btn btn-outline-success btn-sm" to="/admin">Overview</Link>
      <Link className="btn btn-outline-success btn-sm" to="/admin/reports">Reports</Link>
      <Link className="btn btn-outline-success btn-sm" to="/admin/users">Users</Link>
      <Link className="btn btn-outline-success btn-sm" to="/admin/assignments">Assignments</Link>
    </nav>
  )
}

function MetricCard({ label, value, detail }) {
  return (
    <div className="col-sm-6 col-xl-3">
      <article className="admin-metric p-3 h-100">
        <p className="small text-secondary mb-1">{label}</p>
        <p className="display-6 fw-semibold mb-1">{value.toLocaleString()}</p>
        <p className="small text-secondary mb-0">{detail}</p>
      </article>
    </div>
  )
}

function DataBars({ title, rows, labelKey }) {
  const maximum = Math.max(...rows.map((row) => row.count), 0)
  return (
    <section className="admin-panel p-4 h-100">
      <h2 className="h5 fw-bold">{title}</h2>
      {rows.length ? (
        <ul className="admin-bars">
          {rows.map((row) => (
            <li key={row[labelKey]}>
              <div className="d-flex justify-content-between gap-2">
                <span className="text-capitalize">{row[labelKey]?.replaceAll('_', ' ') ?? 'Unspecified'}</span>
                <strong>{row.count}</strong>
              </div>
              <div className="progress" role="progressbar" aria-label={`${row[labelKey] ?? 'Unspecified'} count`} aria-valuenow={row.count} aria-valuemin="0" aria-valuemax={maximum || 1}>
                <div className="progress-bar bg-success" style={{ width: `${maximum ? (row.count / maximum) * 100 : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="text-secondary mb-0">No report data available.</p>}
    </section>
  )
}

function DailyActivity({ rows }) {
  const maximum = Math.max(...rows.map((row) => row.count), 0)
  return rows.length ? (
    <>
      <div className="admin-activity" aria-hidden="true">
        {rows.map((row) => (
          <div className="admin-activity-day" key={row.date} title={`${row.date}: ${row.count} reports`}>
            <span className="admin-activity-bar" style={{ height: `${maximum ? Math.max(2, (row.count / maximum) * 100) : 2}%` }} />
          </div>
        ))}
      </div>
      <ul className="visually-hidden" aria-label="Daily report totals">
        {rows.map((row) => <li key={row.date}>{row.date}: {row.count} reports</li>)}
      </ul>
      <div className="d-flex justify-content-between small text-secondary">
        <span>{rows[0].date}</span>
        <span>{rows[rows.length - 1].date} (UTC)</span>
      </div>
    </>
  ) : <p className="text-secondary">No recent reports.</p>
}

export function LoadingMessage() {
  return (
    <div className="py-5 text-center" aria-live="polite">
      <span className="spinner-border text-success" role="status">
        <span className="visually-hidden">Loading admin data...</span>
      </span>
      <p className="mt-3 text-secondary">Loading admin data...</p>
    </div>
  )
}
