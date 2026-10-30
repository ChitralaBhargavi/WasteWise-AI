import { useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/useAuth.js'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function AuthPage({ mode }) {
  const isRegister = mode === 'register'
  const { status, login, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submitLock = useRef(false)

  if (status === 'authenticated') {
    return <Navigate to="/account" replace />
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitLock.current) return
    setError('')

    const normalizedEmail = email.trim().toLowerCase()
    if (isRegister && name.trim().length === 0) {
      setError('Enter your name.')
      return
    }
    if (isRegister && name.trim().length > 80) {
      setError('Your name must be 80 characters or fewer.')
      return
    }
    if (!emailPattern.test(normalizedEmail) || normalizedEmail.length > 254) {
      setError('Enter a valid email address.')
      return
    }
    if (Array.from(password).length < 12) {
      setError('Your password must be at least 12 characters long.')
      return
    }
    if (new TextEncoder().encode(password).length > 72) {
      setError('Your password must be no more than 72 UTF-8 bytes.')
      return
    }

    submitLock.current = true
    setSubmitting(true)
    try {
      const credentials = { email: normalizedEmail, password }
      if (isRegister) {
        await register({ ...credentials, name: name.trim() })
      } else {
        await login(credentials)
      }
      navigate(location.state?.from ?? '/account', { replace: true })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page py-5" id="main-content" tabIndex={-1}>
      <div className="container">
        <div className="auth-card mx-auto">
          <Link className="auth-back-link" to="/" aria-label="Back to WasteWise AI home">
            <span aria-hidden="true">←</span> WasteWise AI
          </Link>
          <p className="eyebrow mt-4 mb-2">{isRegister ? 'Join the community' : 'Welcome back'}</p>
          <h1 className="h2 fw-bold mb-2">{isRegister ? 'Create your account' : 'Sign in to WasteWise'}</h1>
          <p className="text-secondary mb-4">
            {isRegister
              ? 'Create a citizen account to get started.'
              : 'Use your email and password to continue.'}
          </p>

          {error && <div className="alert alert-danger" id="auth-form-error" role="alert">{error}</div>}

          <form aria-describedby={error ? 'auth-form-error' : undefined} onSubmit={handleSubmit} noValidate>
            {isRegister && (
              <div className="mb-3">
                <label className="form-label" htmlFor="auth-name">Name</label>
                <input
                  autoComplete="name"
                  className="form-control form-control-lg"
                  id="auth-name"
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  required
                  value={name}
                />
              </div>
            )}
            <div className="mb-3">
              <label className="form-label" htmlFor="auth-email">Email address</label>
              <input
                autoComplete="email"
                className="form-control form-control-lg"
                id="auth-email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </div>
            <div className="mb-4">
              <label className="form-label" htmlFor="auth-password">Password</label>
              <div className="input-group input-group-lg">
                <input
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  className="form-control"
                  id="auth-password"
                  maxLength={128}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                />
                <button
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="btn btn-outline-secondary"
                  onClick={() => setShowPassword((visible) => !visible)}
                  type="button"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <div className="form-text">At least 12 characters. Passwords are never trimmed.</div>
            </div>
            <button className="btn btn-success btn-lg w-100" disabled={submitting} type="submit">
              {submitting ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
                  {isRegister ? 'Creating account...' : 'Signing in...'}
                </>
              ) : isRegister ? 'Create citizen account' : 'Sign in'}
            </button>
          </form>

          <p className="text-secondary text-center mt-4 mb-0">
            {isRegister ? 'Already have an account?' : 'New to WasteWise AI?'}{' '}
            <Link to={isRegister ? '/login' : '/register'}>
              {isRegister ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
