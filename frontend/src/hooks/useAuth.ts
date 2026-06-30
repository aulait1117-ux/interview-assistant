import { useState, useEffect, createContext, useContext } from 'react'
import axios from 'axios'

interface User {
  id: string
  email: string
  plan: string
  plan_name: string
  minutes_limit: number
  minutes_left: number
  can_use_discount: boolean
  is_admin: boolean
}

interface AuthContextType {
  user: User | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  loginWithToken: (token: string, userData?: Record<string, unknown>) => void
  logout: () => void
  refreshUser: () => Promise<void>
  isLoading: boolean
}

export const AuthContext = createContext<AuthContextType>({
  user: null, token: null,
  login: async () => {}, register: async () => {},
  loginWithToken: () => {},
  logout: () => {}, refreshUser: async () => {},
  isLoading: true,
})

export function useAuth() {
  return useContext(AuthContext)
}

export function useAuthProvider(): AuthContextType {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))
  const [isLoading, setIsLoading] = useState(true)

  const setAuthHeader = (t: string | null) => {
    if (t) axios.defaults.headers.common['Authorization'] = `Bearer ${t}`
    else delete axios.defaults.headers.common['Authorization']
  }

  const refreshUser = async () => {
    try {
      const res = await axios.get<User>('/api/auth/me')
      setUser(res.data)
    } catch {
      setUser(null)
      setToken(null)
      localStorage.removeItem('token')
    }
  }

  useEffect(() => {
    if (token) {
      setAuthHeader(token)
      ;(window as any).electronAPI?.sendToken?.(token)
      // オーバーレイ用: バックエンド経由でトークンを共有（既存トークンも同期）
      fetch('/api/auth/sync-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }).catch(() => {})
      refreshUser().finally(() => setIsLoading(false))
    } else {
      setIsLoading(false)
    }
  }, [])

  const login = async (email: string, password: string) => {
    const res = await axios.post<{ token: string }>('/api/auth/login', { email, password })
    const t = res.data.token
    localStorage.setItem('token', t)
    setToken(t)
    setAuthHeader(t)
    ;(window as any).electronAPI?.sendToken?.(t)
    // オーバーレイ用: バックエンド経由でトークンを共有
    fetch('/api/auth/sync-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) }).catch(() => {})
    await refreshUser()
  }

  const register = async (email: string, password: string) => {
    const res = await axios.post<{ token: string }>('/api/auth/register', { email, password })
    const t = res.data.token
    localStorage.setItem('token', t)
    setToken(t)
    setAuthHeader(t)
    await refreshUser()
  }

  const loginWithToken = (t: string, _userData?: Record<string, unknown>) => {
    localStorage.setItem('token', t)
    setToken(t)
    setAuthHeader(t)
    ;(window as any).electronAPI?.sendToken?.(t)
    fetch('/api/auth/sync-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) }).catch(() => {})
    refreshUser()
  }

  const logout = () => {
    localStorage.removeItem('token')
    setToken(null)
    setUser(null)
    setAuthHeader(null)
  }

  return { user, token, login, register, loginWithToken, logout, refreshUser, isLoading }
}
