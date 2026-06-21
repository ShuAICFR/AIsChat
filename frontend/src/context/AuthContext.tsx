import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'

interface User {
  id: number
  username: string
  role: string
  is_active: boolean
  ai_quota: number
  api_credit: number
  agent_bundle_credit: number
  file_quota_mb: number
  has_api_key: boolean
  timezone: string
  language: string
  ui_prefs: Record<string, any>
  avatar_url: string | null
  bio: string | null
  created_at: string | null
  assigned_pool_key_name: string | null  // v0.6.0: 绑定的池 Key 名
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    try {
      const data = await api.get('/auth/me')
      setUser(data)
    } catch {
      setUser(null)
      localStorage.removeItem('access_token')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (token) {
      refreshUser()
    } else {
      setLoading(false)
    }
  }, [refreshUser])

  const login = async (username: string, password: string) => {
    const data = await api.post('/auth/login', { username, password })
    localStorage.setItem('access_token', data.access_token)
    setUser({
      id: data.user_id,
      username: data.username,
      role: data.role,
      is_active: true,
      ai_quota: 0,
      api_credit: 0,
      has_api_key: false,
      timezone: 'Asia/Shanghai',
      language: 'zh',
      ui_prefs: {} as Record<string, any>,
      agent_bundle_credit: 0,
      file_quota_mb: 100,
      avatar_url: null,
      bio: null,
      created_at: null,
      assigned_pool_key_name: null,
    })
  }

  const register = async (username: string, password: string) => {
    const data = await api.post('/auth/register', { username, password })
    localStorage.setItem('access_token', data.access_token)
    setUser({
      id: data.user_id,
      username: data.username,
      role: data.role,
      is_active: true,
      ai_quota: 3,
      api_credit: 0,
      has_api_key: false,
      timezone: 'Asia/Shanghai',
      language: 'zh',
      ui_prefs: {} as Record<string, any>,
      agent_bundle_credit: 0,
      file_quota_mb: 100,
      avatar_url: null,
      bio: null,
      created_at: null,
      assigned_pool_key_name: null,
    })
  }

  const logout = () => {
    localStorage.removeItem('access_token')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
