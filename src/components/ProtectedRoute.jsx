import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/useAuth.js'
import NotificationBell from './NotificationBell.jsx'

export default function ProtectedRoute({ children, requiredRole }) {
  const { status, error, refreshUser, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <main className="container py-5 text-center" id="main-content" tabIndex={-1} aria-live="polite">
        <div className="spinner-border text-success" role="status">
          <span className="visually-hidden">Checking your session...</span>
        </div>
        <p className="mt-3 text-secondary">Checking your session...</p>
      </main>
    )
  }

  if (status === 'error') {
    return (
      <main className="container py-5" id="main-content" tabIndex={-1}>
        <div className="alert alert-warning" role="alert">
          <h1 className="h5">Unable to check your session</h1>
          <p>{error}</p>
          <button className="btn btn-outline-success" type="button" onClick={refreshUser}>
            Try again
          </button>
        </div>
      </main>
    )
  }

  if (status === 'signedOut') {
    return <Navigate to="/" replace />
  }

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (requiredRole && user.role !== requiredRole) {
    const fallback = user.role === 'collector'
      ? '/collector/dashboard'
      : user.role === 'citizen'
        ? '/dashboard'
        : '/account'
    return <Navigate to={fallback} replace />
  }

  return (
    <>
      <nav className="container d-flex justify-content-end py-3" aria-label="Authenticated navigation">
        <NotificationBell />
      </nav>
      {children}
    </>
  )
}
