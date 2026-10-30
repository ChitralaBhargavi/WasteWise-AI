import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/useAuth.js'

export default function AccountPage() {
  const { user, logout } = useAuth()
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submitLock = useRef(false)
  const navigate = useNavigate()

  async function handleLogout() {
    if (submitLock.current) return
    submitLock.current = true
    setSubmitting(true)
    setError('')
    try {
      await logout()
      navigate('/', { replace: true })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  return (
    <main className="container py-5" id="main-content" tabIndex={-1}>
      <div className="account-card mx-auto p-4 p-lg-5">
        <p className="eyebrow mb-2">Your account</p>
        <h1 className="h2 fw-bold">Welcome, {user.name}</h1>
        <p className="text-secondary">You are signed in to WasteWise AI.</p>
        <dl className="account-details">
          <div><dt>Email</dt><dd>{user.email}</dd></div>
          <div><dt>Role</dt><dd>{user.role}</dd></div>
        </dl>
        {user.role === 'citizen' && <Link className="btn btn-success me-2" to="/dashboard">Open my reports</Link>}
        {user.role === 'citizen' && <Link className="btn btn-outline-success me-2" to="/classify">Classify a waste image</Link>}
        {user.role === 'collector' && <Link className="btn btn-success me-2" to="/collector/dashboard">Open assigned reports</Link>}
        {user.role === 'admin' && <Link className="btn btn-success me-2" to="/admin">Open admin dashboard</Link>}
        {error && <div className="alert alert-danger" role="alert">{error}</div>}
        <div className="d-flex flex-wrap gap-3">
          <button className="btn btn-outline-success" disabled={submitting} onClick={handleLogout} type="button">
            {submitting ? 'Signing out...' : 'Sign out'}
          </button>
          <Link className="btn btn-link" to="/">Return to home</Link>
        </div>
      </div>
    </main>
  )
}
