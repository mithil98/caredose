import type { TokenOut } from '../types/api'

/** Thin fetch wrapper: bearer token in memory, refresh token in an HttpOnly cookie. */

const BASE = '/api/v1'
let accessToken: string | null = null
let refreshing: Promise<TokenOut | null> | null = null
let onSessionExpired: () => void = () => {}

export class ApiError extends Error {
  status: number
  fields: Record<string, string>

  constructor(status: number, message: string, fields: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.fields = fields
  }
}

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken() {
  return accessToken
}

export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn
}

type Query = Record<string, string | number | boolean | null | undefined>

export function withQuery(path: string, query?: Query) {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

async function parseError(res: Response): Promise<ApiError> {
  let detail: unknown
  try {
    detail = (await res.json()).detail
  } catch {
    detail = undefined
  }
  if (Array.isArray(detail)) {
    const fields: Record<string, string> = {}
    for (const item of detail as { loc?: (string | number)[]; msg?: string }[]) {
      const key = String(item.loc?.[item.loc.length - 1] ?? 'form')
      fields[key] = (item.msg ?? 'Invalid value').replace(/^Value error, /, '')
    }
    return new ApiError(res.status, 'Please check the highlighted fields.', fields)
  }
  if (typeof detail === 'string') return new ApiError(res.status, detail)
  if (res.status >= 500) return new ApiError(res.status, 'The server had a problem. Please try again in a moment.')
  return new ApiError(res.status, `Request failed (${res.status})`)
}

export async function refreshSession(): Promise<TokenOut | null> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'same-origin' })
    .then(async (res) => {
      if (!res.ok) return null
      const data = (await res.json()) as TokenOut
      accessToken = data.access_token
      return data
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

interface Options {
  method?: string
  body?: unknown
  query?: Query
  raw?: boolean
}

export async function api<T>(path: string, { method = 'GET', body, query, raw }: Options = {}, retried = false): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + withQuery(path, query), {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.')
  }
  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, { method, body, query, raw }, true)
    onSessionExpired()
  }
  if (!res.ok) throw await parseError(res)
  if (raw) return res as T
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const get = <T>(path: string, query?: Query) => api<T>(path, { query })
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body })
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body })
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body })
export const del = <T = void>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body })
