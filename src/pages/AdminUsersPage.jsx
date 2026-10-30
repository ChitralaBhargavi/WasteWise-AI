import { useCallback, useEffect, useState } from 'react'
import { adminApi } from '../lib/api.js'
import { AdminNavigation, LoadingMessage } from './AdminDashboard.jsx'
import { EmptyMessage, Pagination } from './AdminReportsPage.jsx'

const pageSize = 20

export default function AdminUsersPage() {
  const [role, setRole] = useState('')
  const [result, setResult] = useState(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadUsers = useCallback(async (requestedPage, filter = role) => {
    setLoading(true)
    setError('')
    try {
      const response = await adminApi.users({ page: requestedPage, limit: pageSize, role: filter })
      setResult(response)
      setPage(requestedPage)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [role])

  useEffect(() => {
    let active = true
    adminApi.users({ page: 1, limit: pageSize, role })
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
  }, [role])

  return (
    <main className="container py-5" id="main-content" tabIndex={-1}>
      <header className="d-flex flex-wrap justify-content-between gap-3 mb-4">
        <div><p className="eyebrow mb-2">Administration</p><h1 className="h2 fw-bold">Users</h1></div>
        <AdminNavigation />
      </header>
      <div className="admin-panel p-3 mb-4 col-sm-6 col-lg-4">
        <label className="form-label" htmlFor="admin-user-role">Filter by role</label>
        <select className="form-select" id="admin-user-role" onChange={(event) => { setLoading(true); setRole(event.target.value) }} value={role}>
          <option value="">All roles</option>
          <option value="citizen">Citizen</option>
          <option value="collector">Collector</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {loading ? <LoadingMessage /> : result?.data.length ? (
        <>
          <div className="table-responsive report-table-wrap">
            <table className="table admin-data-table align-middle mb-0">
              <caption className="visually-hidden">WasteWise user directory</caption>
              <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Created</th></tr></thead>
              <tbody>
                {result.data.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td>{user.email}</td>
                    <td className="text-capitalize">{user.role}</td>
                    <td>{new Date(user.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination result={result} page={page} onChange={loadUsers} filters={role} />
        </>
      ) : !error ? <EmptyMessage>No users found.</EmptyMessage> : null}
      <p className="form-text mt-3">User listings contain safe profile fields only. Public role changes are not available.</p>
    </main>
  )
}
