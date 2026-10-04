import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationItem } from '../components/feeds'
import { LoginPage } from '../pages/Auth'
import Dashboard from '../pages/Dashboard'
import Notifications from '../pages/Notifications'
import type { Dashboard as DashboardData, Dose } from '../types/api'
import { demoUser, mockApi, renderApp, signedIn } from './utils'

beforeEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const dose = (over: Partial<Dose>): Dose => ({
  id: 1,
  patient_id: 7,
  patient_name: 'Rahul',
  patient_timezone: 'Asia/Kolkata',
  schedule_id: 3,
  medicine_id: 2,
  medicine_name: 'Medicine A',
  dose_quantity: '1.00',
  dose_unit: 'tablet',
  period: 'morning',
  scheduled_for: '2026-10-03T02:30:00Z',
  local_date: '2026-10-03',
  status: 'taken',
  due_at: null,
  dispensed_at: '2026-10-03T02:31:00Z',
  taken_at: '2026-10-03T02:34:00Z',
  missed_at: null,
  cancelled_at: null,
  is_late: false,
  device_uid: 'MED-001',
  ...over,
})

const dashboard: DashboardData = {
  generated_at: '2026-10-03T10:00:00Z',
  summary: {
    patients: 1,
    doses_today: 3,
    taken: 1,
    pending: 1,
    missed: 1,
    late: 0,
    devices_total: 1,
    devices_online: 1,
    devices_offline: 0,
    adherence_today: 50,
  },
  doses: [
    dose({}),
    dose({
      id: 2,
      medicine_name: 'Medicine B',
      period: 'afternoon',
      scheduled_for: '2026-10-03T07:30:00Z',
      status: 'missed',
      taken_at: null,
      missed_at: '2026-10-03T08:30:00Z',
    }),
    dose({
      id: 3,
      medicine_name: 'Medicine C',
      period: 'night',
      scheduled_for: '2026-10-03T14:30:00Z',
      status: 'scheduled',
      taken_at: null,
      dispensed_at: null,
    }),
  ],
  patients: [
    {
      id: 7,
      full_name: 'Rahul',
      timezone: 'Asia/Kolkata',
      device: { id: 1, device_uid: 'MED-001', name: null, status: 'online', last_seen_at: '2026-10-03T09:59:50Z' },
      today: { scheduled: 2, taken: 1, missed: 1, late: 0, pending: 1, total: 3, adherence: 50 },
      next_dose: null,
      alert: 'missed',
    },
  ],
  activity: [
    {
      id: 9,
      event_id: 'e1',
      source: 'device',
      event_type: 'medicine_taken',
      result: 'applied',
      detail: null,
      device_uid: 'MED-001',
      patient_id: 7,
      patient_name: 'Rahul',
      dose_id: 1,
      medicine_name: 'Medicine A',
      period: 'morning',
      event_time: '2026-10-03T02:34:00Z',
      received_at: '2026-10-03T02:34:01Z',
    },
  ],
  alerts: [],
  week: [],
}

describe('Login', () => {
  it('signs in and navigates to the dashboard', async () => {
    const calls = mockApi({
      'POST /auth/refresh': { status: 401, json: { detail: 'no session' } },
      'POST /auth/login': { access_token: 'tok', token_type: 'bearer', expires_in: 1800, user: demoUser },
    })
    renderApp(<LoginPage />, { route: '/login', path: '/login' })
    await userEvent.type(screen.getByLabelText('Email'), 'care@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'secret-pass')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Navigated away')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/auth/login')?.body).toEqual({ email: 'care@example.com', password: 'secret-pass' })
  })

  it('shows the server error for wrong credentials', async () => {
    mockApi({
      'POST /auth/refresh': { status: 401, json: {} },
      'POST /auth/login': { status: 401, json: { detail: 'Incorrect email or password' } },
    })
    renderApp(<LoginPage />, { route: '/login', path: '/login' })
    await userEvent.type(screen.getByLabelText('Email'), 'care@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'nope')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password')
  })
})

describe('Dashboard', () => {
  it("answers today's questions: totals, missed doses, device state, activity", async () => {
    mockApi({ ...signedIn, 'GET /dashboard': dashboard })
    renderApp(<Dashboard />)
    expect(await screen.findByRole('heading', { name: /Asha/ })).toBeInTheDocument()

    const glance = await screen.findByRole('region', { name: 'Today at a glance' })
    expect(within(glance).getByText('Missed').closest('[data-reveal]')).toHaveTextContent('1')
    expect(screen.getByText(/1 of 3 doses confirmed, 50% so far/)).toBeInTheDocument()

    const attention = screen.getByRole('region', { name: /Needs attention/ })
    expect(attention).toHaveTextContent('Rahul missed Medicine B')

    // Every status carries a text label, not just colour
    expect(screen.getAllByText('Taken').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Missed').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Upcoming').length).toBeGreaterThan(0)
    expect(screen.getByRole('region', { name: 'Morning doses' })).toHaveTextContent('Medicine A')
    expect(screen.getByText('Dose confirmed')).toBeInTheDocument()
  })

  it('shows an error state with retry when the API fails', async () => {
    mockApi({ ...signedIn, 'GET /dashboard': { status: 500, json: {} } })
    renderApp(<Dashboard />)
    expect(await screen.findByText('Could not load this section')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('explains when the backend cannot be reached', async () => {
    mockApi({ ...signedIn })
    const real = globalThis.fetch as typeof fetch
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/dashboard') ? Promise.reject(new TypeError('Failed to fetch')) : real(input, init),
    )
    renderApp(<Dashboard />)
    expect(await screen.findByText('Cannot reach the server. Check your connection.')).toBeInTheDocument()
  })

  it('guides a new caretaker through setup when there are no patients', async () => {
    mockApi({ ...signedIn, 'GET /dashboard': { ...dashboard, patients: [], doses: [], summary: { ...dashboard.summary, patients: 0 } } })
    renderApp(<Dashboard />)
    expect(await screen.findByText("Let's set things up")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Add the person you care for/ })).toHaveAttribute('href', '/patients?new=1')
  })
})

describe('Notification center', () => {
  const n = {
    id: 5,
    type: 'medicine_missed',
    severity: 'critical' as const,
    title: '⚠️ Medicine Missed',
    body: "Rahul's night dose has not been confirmed.",
    url: '/patients/7?dose=3',
    patient_id: 7,
    patient_name: 'Rahul',
    device_id: null,
    dose_id: 3,
    read_at: null,
    created_at: new Date().toISOString(),
    push_sent: 1,
    push_error: null,
  }

  it('lists unread alerts and marks all as read', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /notifications': { items: [n], total: 1, unread: 1, page: 1, page_size: 20 },
      'POST /notifications/read-all': { status: 204 },
    })
    renderApp(<Notifications />)
    expect(await screen.findByText('Medicine Missed')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getByText(/Sent to 1 device/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/notifications/read-all')).toBe(true))
  })

  it('opening an alert marks it read and goes to the patient', async () => {
    const calls = mockApi({ ...signedIn, 'POST /notifications/5/read': { status: 204 } })
    renderApp(
      <ul>
        <NotificationItem n={n} now={Date.now()} />
      </ul>,
      { route: '/notifications', path: '/notifications' },
    )
    await userEvent.click(screen.getByRole('button', { name: /Medicine Missed/ }))
    expect(await screen.findByText('Navigated away')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/notifications/5/read')).toBe(true)
  })
})
