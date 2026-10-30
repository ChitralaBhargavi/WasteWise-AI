import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { notificationsApi } from '../lib/api.js'

export default function NotificationBell() {
  const location = useLocation()
  const [unreadCount, setUnreadCount] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function refreshUnreadCount() {
      try {
        const response = await notificationsApi.list({ page: 1, limit: 1 })
        if (active) {
          setUnreadCount(response.unreadCount)
          setError('')
        }
      } catch (requestError) {
        if (active) setError(requestError.message)
      }
    }

    refreshUnreadCount()
    window.addEventListener('wastewise:notifications-updated', refreshUnreadCount)
    return () => {
      active = false
      window.removeEventListener('wastewise:notifications-updated', refreshUnreadCount)
    }
  }, [location.pathname])

  return (
    <>
      <Link
        className="nav-link d-inline-flex align-items-center gap-2"
        to="/notifications"
        aria-label={`Notifications, ${unreadCount} unread`}
        title={error ? `Notifications unavailable: ${error}` : undefined}
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Notifications</span>
        {unreadCount > 0 && (
          <span className="badge rounded-pill text-bg-danger" aria-live="polite">
            {unreadCount > 99 ? '99+' : unreadCount}
            <span className="visually-hidden"> unread</span>
          </span>
        )}
      </Link>
      {error && <span className="visually-hidden" role="status">Unread notification count could not be refreshed.</span>}
    </>
  )
}
