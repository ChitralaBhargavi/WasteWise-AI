import { useCallback, useEffect, useMemo, useState } from 'react'
import { AuthContext } from './authContext.js'
import { ApiError, authApi } from '../lib/api.js'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')

  const loadUser = useCallback(async () => {
    try {
      const result = await authApi.me()
      setUser(result.data.user)
      setStatus('authenticated')
    } catch (requestError) {
      setUser(null)
      if (requestError instanceof ApiError && requestError.status === 401) {
        setStatus('unauthenticated')
        return
      }

      setStatus('error')
      setError(requestError.message)
    }
  }, [])

  const refreshUser = useCallback(async () => {
    setStatus('loading')
    setError('')
    await loadUser()
  }, [loadUser])

  useEffect(() => {
    // Initial session hydration must update state after the API response arrives.
    // oxlint-disable-next-line react/set-state-in-effect
    loadUser()
  }, [loadUser])

  const login = useCallback(async (credentials) => {
    const result = await authApi.login(credentials)
    setUser(result.data.user)
    setStatus('authenticated')
    setError('')
    return result.data.user
  }, [])

  const register = useCallback(async (details) => {
    const result = await authApi.register(details)
    setUser(result.data.user)
    setStatus('authenticated')
    setError('')
    return result.data.user
  }, [])

  const logout = useCallback(async () => {
    await authApi.logout()
    setUser(null)
    setStatus('signedOut')
    setError('')
  }, [])

  const value = useMemo(
    () => ({ user, status, error, login, register, logout, refreshUser }),
    [user, status, error, login, register, logout, refreshUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
