import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../lib/auth'
import { enablePush, currentPushState } from '../lib/push'
import { LiveProvider, useLive } from '../lib/realtime'
import Simulator from '../pages/Simulator'
import type { Device } from '../types/api'
import { mockApi, renderApp, signedIn } from './utils'

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.useRealTimers())

const device: Device = {
  id: 1,
  device_uid: 'MED-001',
  name: null,
  status: 'online',
  last_seen_at: null,
  patient: { id: 7, full_name: 'Rahul' },
  owner: { id: 1, full_name: 'Asha Verma' },
  firmware_version: null,
  signal_strength: null,
  last_error: null,
  offline_since: null,
  is_active: true,
  created_at: '2026-10-01T00:00:00Z',
}

describe('Device simulator', () => {
  it('uses the device contract (X-Device-Key), never the caretaker token', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /devices': [device],
      'GET /doses': { items: [], total: 0, page: 1, page_size: 50 },
      'POST /device-events': (body) => ({
        status: 201,
        json: {
          id: 1,
          event_id: (body as { event_id: string }).event_id,
          event_type: 'medicine_dispensed',
          result: 'applied',
          duplicate: false,
          detail: null,
          dose_id: 4,
          dose_status: 'dispensed',
          received_at: '2026-10-03T14:30:00Z',
        },
      }),
    })
    renderApp(<Simulator />)
    await userEvent.type(await screen.findByLabelText('Device key'), 'dk_test_key')
    await userEvent.click(screen.getByRole('button', { name: 'Dispense' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/device-events')).toBe(true))

    const sent = calls.find((c) => c.path === '/device-events')!
    expect(sent.headers['X-Device-Key']).toBe('dk_test_key')
    expect(sent.headers).not.toHaveProperty('Authorization')
    expect(sent.body).toMatchObject({ device_id: 'MED-001', event_type: 'medicine_dispensed' })
    expect((sent.body as { event_id: string }).event_id).toMatch(/^sim-/)
    expect(await screen.findByText(/"dose_status": "dispensed"/)).toBeInTheDocument()

    // Resend reuses the same event_id (idempotency demo)
    await userEvent.click(screen.getByRole('button', { name: /Resend last event/ }))
    await waitFor(() => expect(calls.filter((c) => c.path === '/device-events')).toHaveLength(2))
    const [a, b] = calls.filter((c) => c.path === '/device-events')
    expect((b.body as { event_id: string }).event_id).toBe((a.body as { event_id: string }).event_id)
  })
})

describe('Push permission flow', () => {
  function stubBrowser(permission: NotificationPermission, result: NotificationPermission) {
    const subscription = {
      endpoint: 'https://push.example.com/abc',
      options: { applicationServerKey: null },
      toJSON: () => ({ endpoint: 'https://push.example.com/abc', keys: { p256dh: 'p', auth: 'a' } }),
      unsubscribe: vi.fn(),
    }
    const subscribe = vi.fn(async () => subscription)
    const registration = { pushManager: { getSubscription: vi.fn(async () => null), subscribe } }
    vi.stubGlobal('Notification', { permission, requestPermission: vi.fn(async () => result) })
    vi.stubGlobal('PushManager', function PushManager() {})
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(registration) } })
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    return { subscribe }
  }

  it('subscribes with the server VAPID key and registers the subscription', async () => {
    const { subscribe } = stubBrowser('default', 'granted')
    const calls = mockApi({
      'GET /notifications/push-status': { configured: true, vapid_public_key: 'BAEC', subscriptions: 0 },
      'POST /notifications/push-subscription': { status: 201, json: { status: 'subscribed' } },
    })
    await enablePush()
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }))
    expect(calls.find((c) => c.path === '/notifications/push-subscription')!.body).toMatchObject({
      endpoint: 'https://push.example.com/abc',
    })
  })

  it('explains how to recover when permission is denied', async () => {
    stubBrowser('default', 'denied')
    mockApi({ 'GET /notifications/push-status': { configured: true, vapid_public_key: 'BAEC', subscriptions: 0 } })
    await expect(enablePush()).rejects.toThrow(/blocked for this site/)
  })

  it('reports missing server configuration instead of pretending success', async () => {
    stubBrowser('default', 'granted')
    mockApi({ 'GET /notifications/push-status': { configured: false, vapid_public_key: null, subscriptions: 0 } })
    await expect(enablePush()).rejects.toThrow(/not configured on the server/)
  })

  it('reports the current state', async () => {
    stubBrowser('denied', 'denied')
    expect(await currentPushState()).toBe('denied')
  })
})

describe('Live updates (WebSocket)', () => {
  class FakeSocket {
    static instances: FakeSocket[] = []
    static OPEN = 1
    readyState = 0
    sent: string[] = []
    onopen?: () => void
    onmessage?: (e: { data: string }) => void
    onclose?: (e: { code: number }) => void
    url: string
    constructor(url: string) {
      this.url = url
      FakeSocket.instances.push(this)
    }
    send(data: string) {
      this.sent.push(data)
    }
    close() {
      this.readyState = 3
    }
    open() {
      this.readyState = 1
      this.onopen?.()
    }
    message(data: object) {
      this.onmessage?.({ data: JSON.stringify(data) })
    }
    drop() {
      this.readyState = 3
      this.onclose?.({ code: 1006 })
    }
  }

  function Status() {
    return <p>status: {useLive().status}</p>
  }

  it('authenticates in the first message, reports status, and reconnects after a drop', async () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    mockApi(signedIn)
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <LiveProvider>
            <Status />
          </LiveProvider>
        </AuthProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(0))
    const first = FakeSocket.instances.at(-1)!
    expect(first.url).toMatch(/\/api\/v1\/ws$/)
    act(() => first.open())
    expect(JSON.parse(first.sent[0])).toEqual({ type: 'auth', token: 'tok' })
    act(() => first.message({ type: 'ready' }))
    expect(screen.getByText('status: connected')).toBeInTheDocument()

    vi.useFakeTimers()
    act(() => first.drop())
    expect(screen.getByText('status: reconnecting')).toBeInTheDocument()
    const before = FakeSocket.instances.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(FakeSocket.instances.length).toBe(before + 1)
    const second = FakeSocket.instances.at(-1)!
    act(() => second.open())
    act(() => second.message({ type: 'ready' }))
    expect(screen.getByText('status: connected')).toBeInTheDocument()
  })
})
