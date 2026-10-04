import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { vi } from 'vitest'
import { ToastProvider } from '../components/ui'
import { AuthProvider } from '../lib/auth'
import type { User } from '../types/api'

export type Handler = (body: unknown, url: URL, init: RequestInit) => { status?: number; json?: unknown } | undefined

export interface Call {
  method: string
  path: string
  body: unknown
  headers: Record<string, string>
}

export const demoUser: User = {
  id: 1,
  email: 'care@example.com',
  full_name: 'Asha Verma',
  role: 'caretaker',
  timezone: 'Asia/Kolkata',
  is_active: true,
  created_at: '2026-10-01T00:00:00Z',
  last_login_at: null,
}

/** Route fetch calls to handlers keyed "METHOD /path" (path without /api/v1 and query). */
export function mockApi(handlers: Record<string, Handler | object>) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost')
    const method = (init.method ?? 'GET').toUpperCase()
    const path = url.pathname.replace('/api/v1', '')
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path, body, headers: (init.headers ?? {}) as Record<string, string> })
    const h = handlers[`${method} ${path}`]
    const isSpec = (v: object) => 'status' in v && Object.keys(v).every((k) => k === 'status' || k === 'json')
    const out =
      typeof h === 'function'
        ? (h as Handler)(body, url, init)
        : h
          ? isSpec(h)
            ? (h as { status: number; json?: unknown })
            : { json: h }
          : undefined
    if (!out) return new Response(JSON.stringify({ detail: `unhandled ${method} ${path}` }), { status: 404 })
    const status = out.status ?? 200
    return new Response(status === 204 ? null : JSON.stringify(out.json ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

export const signedIn = {
  'POST /auth/refresh': { access_token: 'tok', token_type: 'bearer', expires_in: 1800, user: demoUser },
}

export function renderApp(ui: ReactNode, { route = '/', path = '*' }: { route?: string; path?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[route]}>
          <ToastProvider>
            <Routes>
              <Route path={path} element={ui} />
              {path !== '*' && <Route path="*" element={<p>Navigated away</p>} />}
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}
