const apiBaseUrl = import.meta.env.DEV ? '/api' : (import.meta.env.VITE_API_BASE_URL ?? '/api')

export class ApiError extends Error {
  constructor(message, status = 0, duplicate = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.duplicate = duplicate
  }
}

export async function apiRequest(path, { method = 'GET', body } = {}) {
  const requestMethod = method.toUpperCase()
  const headers = { Accept: 'application/json' }
  const options = {
    method: requestMethod,
    credentials: 'include',
    headers,
  }

  if (body !== undefined) {
    if (body instanceof FormData) {
      options.body = body
    } else {
      headers['Content-Type'] = 'application/json'
      options.body = JSON.stringify(body)
    }
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(requestMethod)) {
    let csrfResponse
    try {
      csrfResponse = await fetch(`${apiBaseUrl}/auth/csrf`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
    } catch {
      throw new ApiError('Cannot reach the WasteWise API. Check that the backend is running and try again.')
    }
    const csrfResult = await readResponse(csrfResponse)
    headers['X-CSRF-Token'] = csrfResult.data.csrfToken
  }

  let response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, options)
  } catch {
    throw new ApiError('Cannot reach the WasteWise API. Check that the backend is running and try again.')
  }

  return readResponse(response)
}

async function readResponse(response) {
  let result
  try {
    result = await response.json()
  } catch {
    if (response.ok && response.status === 204) {
      return null
    }
    throw new ApiError('The API returned an unreadable response.', response.status)
  }

  if (!response.ok) {
    throw new ApiError(
      result.error?.message ?? 'The request could not be completed.',
      response.status,
      result.error?.duplicate ?? null,
    )
  }

  return result
}

async function downloadCsv(path) {
  let response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      credentials: 'include',
      headers: { Accept: 'text/csv, application/json' },
    })
  } catch {
    throw new ApiError('Cannot reach the WasteWise API. Check that the backend is running and try again.')
  }

  if (!response.ok) {
    await readResponse(response)
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/csv')) {
    throw new ApiError('The API did not return a CSV file.', response.status)
  }
  return response.blob()
}

export async function apiRequestBlob(path) {
  let response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      credentials: 'include',
      headers: { Accept: 'image/*, application/json' },
    })
  } catch {
    throw new ApiError('Cannot reach the WasteWise API. Check that the backend is running and try again.')
  }
  if (!response.ok) {
    await readResponse(response)
  }
  return response.blob()
}

export const authApi = Object.freeze({
  me() {
    return apiRequest('/auth/me')
  },
  register({ name, email, password }) {
    return apiRequest('/auth/register', { method: 'POST', body: { name, email, password } })
  },
  login({ email, password }) {
    return apiRequest('/auth/login', { method: 'POST', body: { email, password } })
  },
  logout() {
    return apiRequest('/auth/logout', { method: 'POST', body: {} })
  },
})

export const notificationsApi = Object.freeze({
  list({ page = 1, limit = 20 } = {}) {
    const query = new URLSearchParams({ page: String(page), limit: String(limit) })
    return apiRequest(`/notifications?${query}`)
  },
  markRead(id) {
    return apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH', body: {} })
  },
  markAllRead() {
    return apiRequest('/notifications/read-all', { method: 'PATCH', body: {} })
  },
})

export const reportsApi = Object.freeze({
  list({ page = 1, limit = 20 } = {}) {
    const query = new URLSearchParams({ page: String(page), limit: String(limit) })
    return apiRequest(`/reports?${query}`)
  },
  get(id) {
    return apiRequest(`/reports/${encodeURIComponent(id)}`)
  },
  create(report, image) {
    const body = new FormData()
    body.set('category', report.category)
    if (report.description) body.set('description', report.description)
    if (report.location) body.set('location', JSON.stringify(report.location))
    if (image) body.set('image', image)
    return apiRequest('/reports', { method: 'POST', body })
  },
})

export const aiApi = Object.freeze({
  health() {
    return apiRequest('/health')
  },
  classify(image) {
    const body = new FormData()
    body.set('image', image)
    return apiRequest('/ai/classify', { method: 'POST', body })
  },
})

export const collectorApi = Object.freeze({
  list({ page = 1, limit = 20 } = {}) {
    const query = new URLSearchParams({ page: String(page), limit: String(limit) })
    return apiRequest(`/collector/reports?${query}`)
  },
  get(id) {
    return apiRequest(`/collector/reports/${encodeURIComponent(id)}`)
  },
  updateStatus(id, status, image) {
    if (image) {
      const body = new FormData()
      body.set('status', status)
      body.set('image', image)
      return apiRequest(`/collector/reports/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body,
      })
    }
    return apiRequest(`/collector/reports/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: { status },
    })
  },
})

export const adminApi = Object.freeze({
  overview() {
    return apiRequest('/admin/overview')
  },
  reports({ page = 1, limit = 20, status = '', category = '', reviewStatus = '', priority = '', overdue = '' } = {}) {
    const query = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (status) query.set('status', status)
    if (category) query.set('category', category)
    if (reviewStatus) query.set('reviewStatus', reviewStatus)
    if (priority) query.set('priority', priority)
    if (overdue) query.set('overdue', overdue)
    return apiRequest(`/admin/reports?${query}`)
  },
  exportReports({ status = '', category = '', reviewStatus = '', priority = '', overdue = '' } = {}) {
    const query = new URLSearchParams()
    if (status) query.set('status', status)
    if (category) query.set('category', category)
    if (reviewStatus) query.set('reviewStatus', reviewStatus)
    if (priority) query.set('priority', priority)
    if (overdue) query.set('overdue', overdue)
    return downloadCsv(`/admin/reports/export.csv?${query}`)
  },
  report(id) {
    return apiRequest(`/admin/reports/${encodeURIComponent(id)}`)
  },
  users({ page = 1, limit = 20, role = '' } = {}) {
    const query = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (role) query.set('role', role)
    return apiRequest(`/admin/users?${query}`)
  },
  collectors() {
    return apiRequest('/admin/collectors')
  },
  assignments({ page = 1, limit = 20, status = '' } = {}) {
    const query = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (status) query.set('status', status)
    return apiRequest(`/admin/assignments?${query}`)
  },
  assignReport(reportId, collectorId) {
    return apiRequest(`/admin/reports/${encodeURIComponent(reportId)}/assign`, {
      method: 'POST',
      body: { collectorId },
    })
  },
  reviewReport(reportId, decision, reason) {
    return apiRequest(`/admin/reports/${encodeURIComponent(reportId)}/review`, {
      method: 'PATCH',
      body: { decision, ...(reason ? { reason } : {}) },
    })
  },
  updatePriority(reportId, priority) {
    return apiRequest(`/admin/reports/${encodeURIComponent(reportId)}/priority`, {
      method: 'PATCH',
      body: { priority },
    })
  },
})
