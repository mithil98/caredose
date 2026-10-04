import { useQueryClient } from '@tanstack/react-query'
import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { getAccessToken, refreshSession } from './api'
import { useAuth } from './auth'

/** Live dashboard channel. Messages only say "something changed"; queries refetch from the API. */

export type LiveStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline'

export interface LiveNotice {
  id: number
  notification_type: string
  severity: string
  title: string
  body: string
  url: string
}

interface Live {
  status: LiveStatus
  lastSyncAt: Date | null
  subscribe: (fn: (n: LiveNotice) => void) => () => void
}

const LiveContext = createContext<Live>({ status: 'offline', lastSyncAt: null, subscribe: () => () => {} })

const KEYS_BY_TYPE: Record<string, string[][]> = {
  event: [['dashboard'], ['events'], ['doses'], ['adherence'], ['patients']],
  dose: [['dashboard'], ['doses'], ['adherence'], ['patients'], ['dose']],
  device: [['dashboard'], ['devices'], ['device'], ['patients']],
  notification: [['notifications'], ['dashboard']],
  notification_read: [['notifications'], ['dashboard']],
}

export function wsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/api/v1/ws`
}

export function backoff(attempt: number) {
  return Math.min(30_000, 1000 * 2 ** attempt) * (0.75 + Math.random() * 0.5)
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null)
  const listeners = useRef(new Set<(n: LiveNotice) => void>())

  useEffect(() => {
    if (!user) return
    let ws: WebSocket | null = null
    let attempt = 0
    let retryTimer = 0
    let pingTimer = 0
    let stopped = false
    let wasConnected = false

    const connect = () => {
      setStatus(wasConnected || attempt > 0 ? 'reconnecting' : 'connecting')
      ws = new WebSocket(wsUrl())
      ws.onopen = () => ws?.send(JSON.stringify({ type: 'auth', token: getAccessToken() }))
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as { type: string } & Partial<LiveNotice>
        if (msg.type === 'ready') {
          // Anything may have changed while we were away: refetch everything visible.
          if (wasConnected || attempt > 0) queryClient.invalidateQueries()
          wasConnected = true
          attempt = 0
          setStatus('connected')
          setLastSyncAt(new Date())
          pingTimer = window.setInterval(() => ws?.send('{"type":"ping"}'), 25_000)
          return
        }
        if (msg.type === 'pong') return
        setLastSyncAt(new Date())
        for (const key of KEYS_BY_TYPE[msg.type] ?? []) queryClient.invalidateQueries({ queryKey: key })
        if (msg.type === 'notification') listeners.current.forEach((fn) => fn(msg as LiveNotice))
      }
      ws.onclose = async (e) => {
        window.clearInterval(pingTimer)
        if (stopped) return
        setStatus(navigator.onLine ? 'reconnecting' : 'offline')
        if (e.code === 4401) await refreshSession()
        retryTimer = window.setTimeout(connect, backoff(attempt++))
      }
    }
    const reconnectNow = () => {
      if (ws?.readyState === WebSocket.OPEN) return
      window.clearTimeout(retryTimer)
      attempt = 0
      connect()
    }
    const goOffline = () => setStatus('offline')

    connect()
    window.addEventListener('online', reconnectNow)
    window.addEventListener('offline', goOffline)
    return () => {
      stopped = true
      window.clearTimeout(retryTimer)
      window.clearInterval(pingTimer)
      window.removeEventListener('online', reconnectNow)
      window.removeEventListener('offline', goOffline)
      ws?.close()
    }
  }, [user, queryClient])

  const subscribe = useCallback((fn: (n: LiveNotice) => void) => {
    listeners.current.add(fn)
    return () => {
      listeners.current.delete(fn)
    }
  }, [])
  return <LiveContext value={{ status, lastSyncAt, subscribe }}>{children}</LiveContext>
}

export function useLive() {
  return use(LiveContext)
}
