import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/useAuth.js'
import { notificationsApi } from '../lib/api.js'

const pageSize = 20

export default function NotificationsPage() {
  const { user } = useAuth()
  const [result, setResult] = useState(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busyNotificationId, setBusyNotificationId] = useState('')
  const [markingAll, setMarkingAll] = useState(false)

  const loadNotifications = useCallback(async (requestedPage) => {
    setLoading(true)
    setError('')
    try {
      const response = await notificationsApi.list({ page: requestedPage, limit: pageSize })
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
    notificationsApi.list({ page: 1, limit: pageSize })
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

  async function markRead(notificationId) {
    setBusyNotificationId(notificationId)
    setError('')
    setSuccess('')
    try {
      await notificationsApi.markRead(notificationId)
      setSuccess('Notification marked as read.')
      window.dispatchEvent(new Event('wastewise:notifications-updated'))
      await loadNotifications(page)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusyNotificationId('')
    }
  }

  async function markAllRead() {
    setMarkingAll(true)
    setError('')
    setSuccess('')
    try {
      await notificationsApi.markAllRead()
      setSuccess('All notifications marked as read.')
      window.dispatchEvent(new Event('wastewise:notifications-updated'))
      await loadNotifications(page)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setMarkingAll(false)
    }
  }

  function reportPath(reportId) {
    if (user.role === 'admin') return `/admin/reports/${reportId}`
    if (user.role === 'collector') return `/collector/reports/${reportId}`
    return `/reports/${reportId}`
  }

  return (
    <main className="container py-5" id="main-content" tabIndex={-1}>
      <div className="d-flex flex-column flex-sm-row justify-content-between align-items-sm-center gap-3 mb-4">
        <div>
          <p className="eyebrow mb-2">Your updates</p>
          <h1 className="h2 fw-bold mb-1">Notifications</h1>
          <p className="text-secondary mb-0" aria-live="polite">
            {result ? `${result.unreadCount} unread` : 'Updates about your reports and assigned work.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <button
            className="btn btn-outline-success"
            type="button"
            onClick={() => loadNotifications(page)}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            className="btn btn-success"
            type="button"
            onClick={markAllRead}
            disabled={markingAll || loading || !result?.unreadCount}
          >
            {markingAll ? 'Marking...' : 'Mark all as read'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger d-flex flex-wrap justify-content-between align-items-center gap-3" role="alert">
          <span>{error}</span>
          <button className="btn btn-sm btn-outline-danger" type="button" onClick={() => loadNotifications(page)}>
            Try again
          </button>
        </div>
      )}
      {success && <p className="alert alert-success" role="status">{success}</p>}

      {loading ? (
        <div className="py-5 text-center" aria-live="polite">
          <span className="spinner-border text-success" role="status">
            <span className="visually-hidden">Loading notifications...</span>
          </span>
          <p className="mt-3 text-secondary">Loading notifications...</p>
        </div>
      ) : result?.data.length ? (
        <>
          <ul className="list-group shadow-sm mb-4">
            {result.data.map((notification) => (
              <li
                className={`list-group-item p-3 p-md-4 ${notification.isRead ? '' : 'border-start border-4 border-success'}`}
                key={notification.id}
                aria-label={`${notification.isRead ? 'Read' : 'Unread'} notification: ${notification.title}`}
              >
                <div className="d-flex flex-column flex-md-row justify-content-between gap-3">
                  <div>
                    <div className="d-flex flex-wrap align-items-center gap-2 mb-1">
                      <h2 className="h6 fw-bold mb-0">{notification.title}</h2>
                      {notification.isRead
                        ? <span className="badge text-bg-light border">Read</span>
                        : <span className="badge text-bg-success">Unread</span>}
                    </div>
                    <p className="mb-1">{notification.message}</p>
                    <time className="small text-secondary" dateTime={notification.createdAt}>
                      {new Date(notification.createdAt).toLocaleString()}
                    </time>
                    {notification.reportId && (
                      <div className="mt-2">
                        <Link to={reportPath(notification.reportId)}>View related report</Link>
                      </div>
                    )}
                  </div>
                  {!notification.isRead && (
                    <button
                      className="btn btn-sm btn-outline-success align-self-md-start flex-shrink-0"
                      type="button"
                      onClick={() => markRead(notification.id)}
                      disabled={busyNotificationId === notification.id || markingAll}
                    >
                      {busyNotificationId === notification.id ? 'Saving...' : 'Mark as read'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <nav className="d-flex justify-content-between align-items-center gap-3" aria-label="Notification pages">
            <button
              className="btn btn-outline-success"
              type="button"
              onClick={() => loadNotifications(page - 1)}
              disabled={loading || page <= 1}
            >
              Previous
            </button>
            <span className="small text-secondary" aria-live="polite">
              Page {result.pagination.page} of {Math.max(1, result.pagination.totalPages)}
            </span>
            <button
              className="btn btn-outline-success"
              type="button"
              onClick={() => loadNotifications(page + 1)}
              disabled={loading || page >= result.pagination.totalPages}
            >
              Next
            </button>
          </nav>
        </>
      ) : (
        <section className="border rounded-3 bg-light p-4 p-md-5 text-center" aria-live="polite">
          <h2 className="h5 fw-semibold">You are all caught up</h2>
          <p className="text-secondary mb-0">New report and collection updates will appear here.</p>
        </section>
      )}
    </main>
  )
}
