import { useRef, useState } from 'react'
import { BrowserRouter, Link, Route, Routes, useNavigate } from 'react-router-dom'
import './App.css'
import { AuthProvider } from './contexts/AuthContext.jsx'
import { useAuth } from './contexts/useAuth.js'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import NotificationBell from './components/NotificationBell.jsx'
import AccountPage from './pages/AccountPage.jsx'
import AiClassificationPage from './pages/AiClassificationPage.jsx'
import AdminAssignmentsPage from './pages/AdminAssignmentsPage.jsx'
import AdminDashboard from './pages/AdminDashboard.jsx'
import AdminReportsPage from './pages/AdminReportsPage.jsx'
import AdminReportDetailPage from './pages/AdminReportDetailPage.jsx'
import AdminUsersPage from './pages/AdminUsersPage.jsx'
import AuthPage from './pages/AuthPage.jsx'
import CitizenDashboard from './pages/CitizenDashboard.jsx'
import CollectorDashboard from './pages/CollectorDashboard.jsx'
import CollectorReportDetailPage from './pages/CollectorReportDetailPage.jsx'
import CreateReportPage from './pages/CreateReportPage.jsx'
import ReportDetailPage from './pages/ReportDetailPage.jsx'
import NotificationsPage from './pages/NotificationsPage.jsx'

const plannedFeatures = [
  {
    number: '01',
    title: 'Understand your waste',
    description:
      'Use image classification for waste categories when a compatible trained model is configured.',
  },
  {
    number: '02',
    title: 'Report a local issue',
    description:
      'Share details about waste accumulation so it can be reviewed and routed for collection.',
  },
  {
    number: '03',
    title: 'Follow collection progress',
    description:
      'Keep citizens, collectors, and administrators aligned with a clear collection-status workflow.',
  },
]

const guideCards = [
  {
    title: 'Separate at source',
    description:
      'Keep dry recyclables apart from food scraps and other wet waste. Check local rules before disposal.',
    icon: '♻',
  },
  {
    title: 'Keep recyclables clean',
    description:
      'Empty and rinse containers where practical, then let them dry before placing them with recyclables.',
    icon: '✳',
  },
  {
    title: 'Handle special waste carefully',
    description:
      'Batteries, e-waste, medicines, and sanitary waste may need dedicated handling. Follow local guidance.',
    icon: '＋',
  },
]

function AuthNavigation() {
  const { status, user, logout } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const signOutLock = useRef(false)

  async function handleLogout() {
    if (signOutLock.current) return
    signOutLock.current = true
    setSigningOut(true)
    setError('')
    try {
      await logout()
      navigate('/')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      signOutLock.current = false
      setSigningOut(false)
    }
  }

  return (
    <>
      {status === 'authenticated' ? (
        <>
          <NotificationBell />
          {user.role === 'citizen' && <Link className="nav-link" to="/dashboard">My reports</Link>}
          {user.role === 'citizen' && <Link className="nav-link" to="/classify">Classify waste</Link>}
          {user.role === 'collector' && <Link className="nav-link" to="/collector/dashboard">Assigned reports</Link>}
          {user.role === 'admin' && <Link className="nav-link" to="/admin">Admin dashboard</Link>}
          <Link className="nav-link" to="/account">Hi, {user.name}</Link>
          <button className="btn btn-outline-success rounded-pill px-4" disabled={signingOut} onClick={handleLogout} type="button">
            {signingOut ? 'Signing out...' : 'Sign out'}
          </button>
        </>
      ) : (
        <>
          <Link className="nav-link" to="/login">Sign in</Link>
          <Link className="btn btn-success rounded-pill px-4" to="/register">Create account</Link>
        </>
      )}
      {error && <span className="small text-danger" role="alert">{error}</span>}
      {status === 'error' && (
        <span className="small text-secondary" role="status">API unavailable; sign-in status could not be checked.</span>
      )}
    </>
  )
}

function LandingPage() {
  return (
    <>
      <nav aria-label="Primary navigation" className="navbar navbar-expand-lg bg-white border-bottom sticky-top">
        <div className="container">
          <Link className="navbar-brand d-flex align-items-center gap-2 fw-bold" to="/">
            <span className="brand-mark" aria-hidden="true">
              W
            </span>
            <span>WasteWise <span className="brand-accent">AI</span></span>
          </Link>
          <button
            className="navbar-toggler"
            type="button"
            data-bs-toggle="collapse"
            data-bs-target="#mainNavigation"
            aria-controls="mainNavigation"
            aria-expanded="false"
            aria-label="Toggle navigation"
          >
            <span className="navbar-toggler-icon" />
          </button>
          <div className="collapse navbar-collapse" id="mainNavigation">
            <div className="navbar-nav ms-auto align-items-lg-center gap-lg-3">
              <a className="nav-link" href="/#how-it-works">How it works</a>
              <a className="nav-link" href="/#waste-guide">Waste guide</a>
              <a className="btn btn-success rounded-pill px-4" href="/#project-status">
                Project overview
              </a>
              <AuthNavigation />
            </div>
          </div>
        </div>
      </nav>

      <main id="main-content" tabIndex={-1}>
        <section className="hero-section" id="home">
          <div className="container py-5 py-lg-6">
            <div className="row align-items-center g-5">
              <div className="col-lg-7">
                <p className="eyebrow mb-3">A smarter path from waste to resource</p>
                <h1 className="display-3 fw-bold mb-4">
                  Small choices.
                  <br />
                  <span className="text-success">A cleaner future.</span>
                </h1>
                <p className="lead text-secondary mb-4 hero-copy">
                  WasteWise AI is a project to help people understand everyday waste,
                  find better disposal options, and coordinate community collection.
                </p>
                <div className="d-flex flex-wrap gap-3">
                  <a className="btn btn-success btn-lg rounded-pill px-4" href="#waste-guide">
                    Explore the waste guide
                  </a>
                  <a className="btn btn-outline-success btn-lg rounded-pill px-4" href="#how-it-works">
                    See how it works
                  </a>
                </div>
                <p className="small text-secondary mt-3 mb-0">
                  AI suggestions are informational and should be checked against local guidance.
                </p>
              </div>
              <div className="col-lg-5">
                <div className="hero-art" role="img" aria-label="Illustration of a leafy plant growing from a recycling container">
                  <div className="sun-orb" />
                  <div className="leaf leaf-one" />
                  <div className="leaf leaf-two" />
                  <div className="leaf leaf-three" />
                  <div className="plant-stem" />
                  <div className="recycle-bin">
                    <span aria-hidden="true">↻</span>
                  </div>
                  <div className="art-caption">Better habits, shared progress</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-5" id="how-it-works">
          <div className="container py-lg-4">
            <div className="section-heading mb-4">
              <p className="eyebrow mb-2">The project vision</p>
              <h2 className="fw-bold mb-2">From everyday waste to informed action</h2>
              <p className="text-secondary mb-0">
                A connected platform for citizens, collectors, and administrators.
              </p>
            </div>
            <div className="row g-4">
              {plannedFeatures.map((feature) => (
                <div className="col-md-4" key={feature.number}>
                  <article className="card feature-card h-100">
                    <div className="card-body p-4">
                      <span className="feature-number">{feature.number}</span>
                      <h3 className="h5 fw-bold mt-4">{feature.title}</h3>
                      <p className="text-secondary mb-0">{feature.description}</p>
                    </div>
                  </article>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="guide-section py-5" id="waste-guide">
          <div className="container py-lg-4">
            <div className="section-heading mb-4">
              <p className="eyebrow mb-2">A few useful habits</p>
              <h2 className="fw-bold mb-2">Start with mindful separation</h2>
              <p className="text-secondary mb-0">
                These general tips are not a substitute for your local waste-collection rules.
              </p>
            </div>
            <div className="row g-4">
              {guideCards.map((card) => (
                <div className="col-md-4" key={card.title}>
                  <article className="guide-card h-100 p-4">
                    <span className="guide-icon" aria-hidden="true">{card.icon}</span>
                    <h3 className="h5 fw-bold mt-3">{card.title}</h3>
                    <p className="text-secondary mb-0">{card.description}</p>
                  </article>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-5" id="project-status">
          <div className="container py-lg-3">
            <div className="status-panel p-4 p-lg-5">
              <div className="row align-items-center g-3">
                <div className="col-lg-8">
                  <p className="eyebrow mb-2">Project status</p>
                  <h2 className="h3 fw-bold mb-2">Reporting, collection coordination, and administration.</h2>
                  <p className="text-secondary mb-0">
                    Reports, assignment workflows, live administrative analytics, and filtered exports
                    are available. Genuine AI predictions remain unavailable until a compatible trained
                    model is supplied and verified.
                  </p>
                </div>
                <div className="col-lg-4 text-lg-end">
                  <span className="badge rounded-pill text-bg-warning px-3 py-2">AI model not configured</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-top py-4">
        <div className="container d-flex flex-column flex-sm-row justify-content-between gap-2">
          <span className="fw-semibold">WasteWise AI</span>
          <span className="small text-secondary">
            A student project for a cleaner, more sustainable future.
          </span>
        </div>
      </footer>
    </>
  )
}

function AppRoutes() {
  return (
    <>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route
        path="/dashboard"
        element={(
          <ProtectedRoute requiredRole="citizen">
            <CitizenDashboard />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/reports/new"
        element={(
          <ProtectedRoute requiredRole="citizen">
            <CreateReportPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/classify"
        element={(
          <ProtectedRoute requiredRole="citizen">
            <AiClassificationPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/reports/:id"
        element={(
          <ProtectedRoute requiredRole="citizen">
            <ReportDetailPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/collector/dashboard"
        element={(
          <ProtectedRoute requiredRole="collector">
            <CollectorDashboard />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/collector/reports/:id"
        element={(
          <ProtectedRoute requiredRole="collector">
            <CollectorReportDetailPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin"
        element={(
          <ProtectedRoute requiredRole="admin">
            <AdminDashboard />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/reports"
        element={(
          <ProtectedRoute requiredRole="admin">
            <AdminReportsPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/reports/:id"
        element={(
          <ProtectedRoute requiredRole="admin">
            <AdminReportDetailPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/users"
        element={(
          <ProtectedRoute requiredRole="admin">
            <AdminUsersPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/admin/assignments"
        element={(
          <ProtectedRoute requiredRole="admin">
            <AdminAssignmentsPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/account"
        element={(
          <ProtectedRoute>
            <AccountPage />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/notifications"
        element={(
          <ProtectedRoute>
            <NotificationsPage />
          </ProtectedRoute>
        )}
      />
      <Route path="*" element={<LandingPage />} />
    </Routes>
    </>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
