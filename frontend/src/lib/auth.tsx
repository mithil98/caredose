import { useQueryClient } from '@tanstack/react-query'
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { TokenOut, User } from '../types/api'
import { post, refreshSession, setAccessToken, setSessionExpiredHandler } from './api'

interface AuthState {
  user: User | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  register: (input: { email: string; password: string; full_name: string; timezone: string }) => Promise<void>
  logout: () => Promise<void>
  setUser: (user: User) => void
  /** true right after an interactive sign-in / registration: shows the welcome loader once */
  welcome: boolean
  finishWelcome: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [welcome, setWelcome] = useState(false)
  const queryClient = useQueryClient()

  const accept = useCallback((data: TokenOut) => {
    setAccessToken(data.access_token)
    setUser(data.user)
  }, [])

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setAccessToken(null)
      setUser(null)
    })
    refreshSession().then((data) => {
      if (data) accept(data)
      setReady(true)
    })
  }, [accept])

  // Access tokens are short-lived; renew quietly before they expire.
  useEffect(() => {
    if (!user) return
    const id = window.setInterval(
      () => {
        refreshSession().then((data) => data && setAccessToken(data.access_token))
      },
      20 * 60 * 1000,
    )
    return () => window.clearInterval(id)
  }, [user])

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      setUser,
      welcome,
      finishWelcome: () => setWelcome(false),
      login: async (email, password) => {
        accept(await post<TokenOut>('/auth/login', { email, password }))
        setWelcome(true)
      },
      register: async (input) => {
        accept(await post<TokenOut>('/auth/register', input))
        setWelcome(true)
      },
      logout: async () => {
        await post('/auth/logout').catch(() => undefined)
        setAccessToken(null)
        setUser(null)
        queryClient.clear()
      },
    }),
    [user, ready, welcome, accept, queryClient],
  )
  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth() {
  const ctx = use(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
