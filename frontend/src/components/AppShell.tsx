import {
  BellIcon,
  BroadcastIcon,
  CalendarBlankIcon,
  ClockCounterClockwiseIcon,
  DotsThreeIcon,
  FlaskIcon,
  GearIcon,
  ListChecksIcon,
  PillIcon,
  ShieldCheckIcon,
  SignOutIcon,
  SquaresFourIcon,
  UserGearIcon,
  UsersIcon,
  WarningIcon,
  type Icon,
} from '@phosphor-icons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router'
import { get, post } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtTime } from '../lib/format'
import { syncPushSubscription } from '../lib/push'
import { useLive, type LiveStatus } from '../lib/realtime'
import type { NotificationPage } from '../types/api'
import { cn, Dialog, useToast, type Tone } from './ui'
import { WelcomeLoader } from './WelcomeLoader'

export const SIMULATOR_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_SIMULATOR === 'true'

interface NavItem {
  to: string
  label: string
  icon: Icon
  badge?: number
}

function useUnread() {
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => get<NotificationPage>('/notifications', { page_size: 1 }),
    select: (p) => p.unread,
    refetchInterval: 60_000,
  }).data
}

function useNav() {
  const { user } = useAuth()
  const unread = useUnread() ?? 0
  const main: NavItem[] = [
    { to: '/dashboard', label: 'Today', icon: SquaresFourIcon },
    { to: '/patients', label: 'Patients', icon: UsersIcon },
    { to: '/medicines', label: 'Medicines', icon: PillIcon },
    { to: '/schedules', label: 'Schedules', icon: CalendarBlankIcon },
    { to: '/devices', label: 'Devices', icon: BroadcastIcon },
    { to: '/history', label: 'History', icon: ClockCounterClockwiseIcon },
    { to: '/notifications', label: 'Notifications', icon: BellIcon, badge: unread },
    { to: '/settings', label: 'Settings', icon: GearIcon },
  ]
  const admin: NavItem[] =
    user?.role === 'admin'
      ? [
          { to: '/admin', label: 'System', icon: ShieldCheckIcon },
          { to: '/admin/users', label: 'Accounts', icon: UserGearIcon },
          { to: '/admin/audit', label: 'Audit log', icon: ListChecksIcon },
        ]
      : []
  const dev: NavItem[] = SIMULATOR_ENABLED ? [{ to: '/dev/simulator', label: 'Device simulator', icon: FlaskIcon }] : []
  return { main, admin, dev, unread }
}

function NavRow({ item, compact, dark }: { item: NavItem; compact?: boolean; dark?: boolean }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/admin'}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center rounded-lg font-medium',
          'transition-[background-color,color,box-shadow,transform] duration-[var(--ds-duration-slow)] active:scale-[0.98]',
          compact ? 'flex-col gap-1 px-1 py-2 text-[11px]' : 'gap-3 px-3 py-2.5 text-[15px]',
          dark
            ? isActive
              ? 'bg-[#3f72af] font-semibold text-night-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]'
              : 'text-night-ink-2 hover:bg-white/[0.07] hover:text-night-ink'
            : isActive
              ? compact
                ? 'text-brand-ink before:absolute before:inset-x-6 before:top-0 before:h-[3px] before:rounded-2xl before:bg-aqua'
                : 'bg-brand-soft text-brand-ink'
              : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        )
      }
    >
      <item.icon className="size-5 shrink-0" aria-hidden />
      <span className={compact ? 'leading-tight' : 'flex-1'}>{item.label}</span>
      {!!item.badge && (
        <span
          className={cn(
            'rounded-2xl bg-bad px-1.5 text-xs font-semibold leading-5 text-on-brand tabular',
            compact && 'absolute right-2 top-1',
          )}
        >
          {item.badge > 99 ? '99+' : item.badge}
          <span className="sr-only"> unread</span>
        </span>
      )}
    </NavLink>
  )
}

const LIVE: Record<LiveStatus, { label: string; tone: Tone }> = {
  connecting: { label: 'Connecting…', tone: 'neutral' },
  connected: { label: 'Live', tone: 'ok' },
  reconnecting: { label: 'Reconnecting…', tone: 'warn' },
  offline: { label: 'Offline', tone: 'bad' },
}
const LIVE_DOT: Record<Tone, string> = {
  neutral: 'bg-ink-3',
  brand: 'bg-brand',
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  info: 'bg-info',
}

export function LiveIndicator() {
  const { status } = useLive()
  const m = LIVE[status]
  return (
    <span
      role="status"
      aria-live="polite"
      title={status === 'connected' ? 'Receiving live updates' : 'Live updates paused'}
      className="inline-flex items-center gap-2 rounded-2xl border border-line bg-surface px-2.5 py-1 text-[13px] font-medium text-ink-2"
    >
      <span className={cn('size-2 rounded-2xl', LIVE_DOT[m.tone], status !== 'connected' && 'animate-pulse-dot')} aria-hidden />
      <span className="sr-only">Live updates: </span>
      {m.label}
    </span>
  )
}

function StaleBanner() {
  const { status, lastSyncAt } = useLive()
  const [grace, setGrace] = useState(true)
  useEffect(() => {
    const id = window.setTimeout(() => setGrace(false), 4000)
    return () => window.clearTimeout(id)
  }, [])
  if (status === 'connected' || (grace && status === 'connecting')) return null
  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn-ink"
    >
      <WarningIcon className="mt-0.5 size-5 shrink-0" weight="fill" aria-hidden />
      <p>
        <span className="font-semibold">Live updates paused.</span>{' '}
        {lastSyncAt ? `Information below was last updated at ${fmtTime(lastSyncAt.toISOString())} and may be out of date. ` : ''}
        {status === 'offline' ? 'You appear to be offline.' : 'Reconnecting automatically.'}
      </p>
    </div>
  )
}

/** Routes alerts to toasts, handles notification-click deep links and push renewal. */
function useAlertPlumbing() {
  const { subscribe } = useLive()
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()

  useEffect(
    () =>
      subscribe((n) => {
        if (n.notification_type === 'test') return
        const tone: Tone = n.severity === 'critical' ? 'bad' : n.severity === 'warning' ? 'warn' : n.severity === 'success' ? 'ok' : 'info'
        toast({ tone, title: n.title.replace(/^[^\p{L}\p{N}]+/u, ''), body: n.body.split('\n')[0], action: { label: 'View', to: n.url } })
      }),
    [subscribe, toast],
  )

  useEffect(() => {
    syncPushSubscription()
    if (!('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'navigate' && typeof e.data.url === 'string' && e.data.url.startsWith('/')) navigate(e.data.url)
      if (e.data?.type === 'push') queryClient.invalidateQueries({ queryKey: ['notifications'] })
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate, queryClient])

  const opened = params.get('notification')
  useEffect(() => {
    if (!opened || !/^\d+$/.test(opened)) return
    post(`/notifications/${opened}/read`)
      .then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }))
      .catch(() => undefined)
    setParams(
      (p) => {
        p.delete('notification')
        return p
      },
      { replace: true },
    )
  }, [opened, setParams, queryClient])
}

export default function AppShell() {
  const { user, logout, welcome, finishWelcome } = useAuth()
  const { main, admin, dev, unread } = useNav()
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()
  useAlertPlumbing()
  useEffect(() => setMoreOpen(false), [location.pathname])

  const bottom = [main[0], main[1], main[3], { ...main[6], label: 'Alerts' }]
  const more = [main[2], main[4], main[5], main[7], ...admin, ...dev]

  return (
    <div className="min-h-[100dvh] md:flex">
      <a href="#main" className="sr-only z-50 rounded-lg bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>

      {welcome && user && <WelcomeLoader name={user.full_name.split(' ')[0]} onDone={finishWelcome} />}

      {/* Sidebar (navy stage): icon rail on tablets, full on laptops */}
      <aside className="sticky top-0 hidden h-[100dvh] shrink-0 flex-col bg-stage text-night-ink md:flex md:w-[88px] lg:w-64">
        <Link to="/dashboard" className="flex h-16 items-center gap-2.5 px-5 md:justify-center lg:justify-start">
          <img src="/favicon.svg" alt="" width={32} height={32} className="size-8" />
          <span translate="no" className="hidden text-lg font-semibold tracking-tight lg:inline">
            Care<span className="text-aqua">Dose</span>
          </span>
        </Link>
        <nav aria-label="Main" className="mt-2 flex flex-1 flex-col gap-1 overflow-y-auto px-2 lg:px-3">
          {main.map((item) => (
            <div key={item.to}>
              <div className="hidden lg:block">
                <NavRow item={item} dark />
              </div>
              <div className="lg:hidden">
                <NavRow item={item} compact dark />
              </div>
            </div>
          ))}
          {[...admin, ...dev].length > 0 && <hr className="my-3 border-white/10" />}
          {[...admin, ...dev].map((item) => (
            <div key={item.to}>
              <div className="hidden lg:block">
                <NavRow item={item} dark />
              </div>
              <div className="lg:hidden">
                <NavRow item={item} compact dark />
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="hidden items-center gap-3 px-2 pb-2 lg:flex">
            <span className="inline-flex size-9 items-center justify-center rounded-2xl bg-night-ink font-semibold text-night" aria-hidden>
              {user?.full_name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{user?.full_name}</p>
              <p className="truncate text-[13px] capitalize text-night-ink-2">{user?.role}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-night-ink-2 hover:bg-white/[0.07] hover:text-night-ink md:justify-center lg:justify-start"
          >
            <SignOutIcon className="size-5" aria-hidden />
            <span className="md:sr-only lg:not-sr-only">Sign out</span>
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line/70 bg-canvas/70 px-4 backdrop-blur-xl md:h-16 sm:px-6 lg:px-8">
          <Link to="/dashboard" className="flex items-center gap-2 md:hidden">
            <img src="/favicon.svg" alt="" width={28} height={28} className="size-7" />
            <span translate="no" className="font-semibold tracking-tight">
              CareDose
            </span>
          </Link>
          <div className="hidden md:block" />
          <div className="flex items-center gap-2">
            <LiveIndicator />
            <Link
              to="/notifications"
              aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
              className="relative inline-flex size-10 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink"
            >
              <BellIcon className="size-[22px]" aria-hidden />
              {!!unread && (
                <span
                  className="absolute right-1 top-1 min-w-[18px] rounded-2xl bg-bad px-1 text-center text-[11px] font-semibold leading-[18px] text-on-brand tabular"
                  aria-hidden
                >
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-[1320px] flex-1 px-4 pb-28 pt-5 sm:px-6 md:pb-12 lg:px-8 lg:pt-8">
          <StaleBanner />
          <div key={location.pathname} className="page-enter">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 px-1 pt-1 pb-safe backdrop-blur md:hidden"
      >
        {bottom.map((item) => (
          <NavRow key={item.to} item={item} compact />
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] font-medium text-ink-2"
          aria-haspopup="dialog"
        >
          <DotsThreeIcon className="size-5" weight="bold" aria-hidden />
          More
        </button>
      </nav>
      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <nav aria-label="More" className="flex flex-col gap-1">
          {more.map((item) => (
            <NavRow key={item.to} item={item} />
          ))}
          <hr className="my-2 border-line" />
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium text-ink-2 hover:bg-surface-2"
          >
            <SignOutIcon className="size-5" aria-hidden />
            Sign out ({user?.email})
          </button>
        </nav>
      </Dialog>
    </div>
  )
}
