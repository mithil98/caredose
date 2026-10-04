import {
  ArrowRightIcon,
  BellIcon,
  BroadcastIcon,
  CalendarBlankIcon,
  CheckCircleIcon,
  ClockIcon,
  PillIcon,
  PlusIcon,
  UsersIcon,
  WarningCircleIcon,
  WifiSlashIcon,
  WrenchIcon,
  type Icon,
} from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { AdherenceChart, Meter, ProgressRing } from '../components/charts'
import { DoseTimeline } from '../components/doses'
import { ActivityFeed, NotificationItem } from '../components/feeds'
import { PushNudge } from '../components/PushNudge'
import { DeviceStatusBadge } from '../components/status'
import { Scene3D } from '../components/three/Scene3D'
import {
  AnimatedNumber,
  buttonClass,
  cn,
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
  TONE_SOFT,
  TONE_TEXT,
  useNow,
  type Tone,
} from '../components/ui'
import { get } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtTime, greeting } from '../lib/format'
import { useBatchReveal, useParallax, useSplitReveal } from '../lib/motion'
import { useLive } from '../lib/realtime'
import type { Dashboard as DashboardData, PatientOverview } from '../types/api'

function useDashboard() {
  const { status } = useLive()
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => get<DashboardData>('/dashboard'),
    // Live updates drive refreshes; poll only as a fallback while the socket is down.
    refetchInterval: status === 'connected' ? 120_000 : 30_000,
  })
}

function Stat({ label, value, icon: IconCmp, tone, hint }: { label: string; value: ReactNode; icon: Icon; tone: Tone; hint?: ReactNode }) {
  return (
    <div
      data-reveal
      className="group relative overflow-hidden rounded-2xl border border-line bg-surface p-4 shadow-panel transition-[transform,box-shadow] duration-300 ease-emphasis hover:-translate-y-0.5 hover:shadow-lift sm:p-5"
    >
      <span aria-hidden className={cn('absolute inset-x-0 top-0 h-1', STRIP[tone])} />
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-2">{label}</p>
        <span className={cn('inline-flex size-9 shrink-0 items-center justify-center rounded-2xl', TONE_SOFT[tone], TONE_TEXT[tone])}>
          <IconCmp className="size-5" weight="fill" aria-hidden />
        </span>
      </div>
      <p className="mt-2 text-title font-semibold text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-[13px] text-ink-3">{hint}</p>}
    </div>
  )
}

const STRIP: Record<Tone, string> = {
  neutral: 'bg-line-strong',
  brand: 'bg-aqua',
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  info: 'bg-info',
}

function Summary({ data }: { data: DashboardData }) {
  const s = data.summary
  const devicesTone: Tone = s.devices_total === 0 ? 'neutral' : s.devices_offline > 0 ? 'bad' : 'ok'
  return (
    <section aria-label="Today at a glance" className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <Stat
        label="Taken"
        value={<AnimatedNumber value={s.taken} />}
        icon={CheckCircleIcon}
        tone="ok"
        hint={s.late ? `${s.late} late` : 'Confirmed doses'}
      />
      <Stat label="Pending" value={<AnimatedNumber value={s.pending} />} icon={ClockIcon} tone="warn" hint="Due or upcoming" />
      <Stat
        label="Missed"
        value={<AnimatedNumber value={s.missed} />}
        icon={WarningCircleIcon}
        tone={s.missed ? 'bad' : 'neutral'}
        hint={s.missed ? 'Needs follow-up' : 'None today'}
      />
      <Stat
        label="Devices online"
        value={
          <>
            <AnimatedNumber value={s.devices_online} />
            <span className="text-lg font-medium text-ink-3"> / {s.devices_total}</span>
          </>
        }
        icon={s.devices_offline ? WifiSlashIcon : BroadcastIcon}
        tone={devicesTone}
        hint={s.devices_offline ? `${s.devices_offline} need attention` : s.devices_total ? 'All connected' : 'No devices yet'}
      />
    </section>
  )
}

/** Navy stage hero: SplitText greeting, parallax glows, 3D capsules and the "taken today" ring. */
function Hero({ data, name, timeZone }: { data?: DashboardData; name: string; timeZone?: string }) {
  const stage = useRef<HTMLElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const { welcome } = useAuth()
  useSplitReveal(title, [], 0.05, !welcome) // wait until the welcome loader has opened onto the page
  useParallax(stage)
  const today = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(new Date())
  const s = data?.summary
  const attention = data
    ? data.doses.filter((d) => ['missed', 'due', 'dispensed'].includes(d.status)).length + data.summary.devices_offline
    : 0
  const line = !s
    ? 'Loading today\u2019s medication overview\u2026'
    : s.doses_today === 0
      ? 'No doses are scheduled for today.'
      : `${s.taken} of ${s.doses_today} doses confirmed${s.adherence_today === null ? '' : `, ${s.adherence_today}% so far`}. ${
          attention ? `${attention} ${attention === 1 ? 'item needs' : 'items need'} your attention.` : 'Everything is on track.'
        }`
  return (
    <section
      ref={stage}
      aria-labelledby="hero-title"
      className="relative isolate mb-5 overflow-hidden rounded-2xl bg-stage px-5 py-7 text-night-ink shadow-lift sm:px-8 sm:py-9 lg:px-10"
    >
      <div
        data-depth="0.6"
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-24 -z-10 size-[26rem] bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--g2)_35%,transparent),transparent)]"
      />
      <div
        data-depth="0.3"
        aria-hidden
        className="pointer-events-none absolute -bottom-40 left-1/4 -z-10 size-[24rem] bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--g1)_30%,transparent),transparent)]"
      />
      <Scene3D variant="badge" className="pointer-events-none absolute inset-y-0 right-0 -z-10 hidden w-[55%] opacity-90 md:block" />
      <div className="grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <p className="text-sm font-medium text-night-ink-2">{today}</p>
          <h1 ref={title} id="hero-title" className="mt-1 text-title font-semibold text-balance lg:text-display">
            {greeting(timeZone)}, <span className="text-aqua">{name}</span>
          </h1>
          <p className="mt-3 max-w-[52ch] text-night-ink-2">{line}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/patients?new=1"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-white/[0.08] px-4 text-[15px] font-medium text-night-ink ring-1 ring-white/15 backdrop-blur transition hover:bg-white/[0.14] active:translate-y-px"
            >
              <PlusIcon className="size-[18px]" weight="bold" aria-hidden />
              Add patient
            </Link>
            <Link
              to="/history"
              className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-[15px] font-medium text-night-ink-2 transition hover:text-night-ink"
            >
              View history
              <ArrowRightIcon className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
        {s && s.doses_today > 0 && (
          <div className="justify-self-center md:justify-self-end">
            <ProgressRing value={s.taken} max={s.doses_today} label="Doses taken today" />
          </div>
        )}
      </div>
    </section>
  )
}

function Attention({ data }: { data: DashboardData }) {
  const items: { icon: Icon; tone: Tone; text: ReactNode; to: string }[] = []
  for (const d of data.doses) {
    if (d.status === 'missed')
      items.push({
        icon: WarningCircleIcon,
        tone: 'bad',
        text: (
          <>
            <b>{d.patient_name}</b> missed {d.medicine_name} ({fmtTime(d.scheduled_for, d.patient_timezone)})
          </>
        ),
        to: `/patients/${d.patient_id}?dose=${d.id}`,
      })
  }
  for (const p of data.patients) {
    if (p.device && (p.device.status === 'offline' || p.device.status === 'error'))
      items.push({
        icon: p.device.status === 'error' ? WrenchIcon : WifiSlashIcon,
        tone: 'bad',
        text: (
          <>
            <b>{p.device.device_uid}</b> ({p.full_name}) is {p.device.status === 'error' ? 'reporting a problem' : 'offline'}
          </>
        ),
        to: `/devices/${p.device.device_uid}`,
      })
  }
  for (const d of data.doses) {
    if (d.status === 'due' || d.status === 'dispensed')
      items.push({
        icon: ClockIcon,
        tone: 'warn',
        text: (
          <>
            <b>{d.patient_name}</b>: {d.medicine_name} is {d.status === 'due' ? 'due now' : 'dispensed, waiting for pickup'}
          </>
        ),
        to: `/patients/${d.patient_id}?dose=${d.id}`,
      })
  }
  if (!data.patients.length) return null
  if (!items.length)
    return (
      <p className="mb-5 flex items-center gap-2 rounded-xl bg-ok-soft px-4 py-3 text-[15px] font-medium text-ok-ink">
        <CheckCircleIcon className="size-5 shrink-0" weight="fill" aria-hidden />
        Everything is on track right now. Nothing needs your attention.
      </p>
    )
  return (
    <section data-reveal aria-labelledby="attention" className="mb-5 rounded-xl border border-line bg-surface shadow-panel">
      <h2 id="attention" className="flex items-center gap-2 px-4 pt-4 text-lg font-semibold tracking-tight sm:px-5">
        Needs attention
        <span className="rounded-2xl bg-bad-soft px-2 text-sm font-semibold text-bad-ink tabular">{items.length}</span>
      </h2>
      <ul className="px-2 pb-2 pt-1 sm:px-3">
        {items.slice(0, 6).map((it, i) => (
          <li key={i}>
            <Link
              to={it.to}
              className="flex items-center gap-3 rounded-lg px-2 py-2 text-[15px] text-ink-2 hover:bg-surface-2 [&_b]:font-semibold [&_b]:text-ink"
            >
              <it.icon className={cn('size-5 shrink-0', TONE_TEXT[it.tone])} weight="fill" aria-hidden />
              <span className="min-w-0 flex-1">{it.text}</span>
              <span className="text-sm font-medium text-brand">View</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

const ALERT_LINE: Record<PatientOverview['alert'], { text: string; tone: Tone; icon: Icon }> = {
  missed: { text: 'Missed a dose today', tone: 'bad', icon: WarningCircleIcon },
  device_offline: { text: 'Dispenser offline', tone: 'bad', icon: WifiSlashIcon },
  device_error: { text: 'Dispenser needs attention', tone: 'bad', icon: WrenchIcon },
  due: { text: 'A dose is due now', tone: 'warn', icon: ClockIcon },
  ok: { text: 'On track', tone: 'ok', icon: CheckCircleIcon },
}

function PatientCard({ p }: { p: PatientOverview }) {
  const a = ALERT_LINE[p.alert]
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <div className="flex items-start justify-between gap-2">
        <Link to={`/patients/${p.id}`} className="min-w-0 truncate text-[17px] font-semibold text-ink hover:link">
          {p.full_name}
        </Link>
        {p.device ? <DeviceStatusBadge status={p.device.status} /> : <span className="text-[13px] text-ink-3">No device</span>}
      </div>
      <div>
        <div className="mb-1.5 flex justify-between text-sm">
          <span className="text-ink-2">Today</span>
          <span className="font-medium text-ink tabular">
            {p.today.taken} of {p.today.total} taken
          </span>
        </div>
        <Meter value={p.today.taken} max={p.today.total} label={`${p.full_name}: doses taken today`} />
      </div>
      <p className="text-sm text-ink-2">
        {p.next_dose ? (
          <>
            Next: <span className="font-medium text-ink">{p.next_dose.medicine_name}</span> at{' '}
            {fmtTime(p.next_dose.scheduled_for, p.next_dose.patient_timezone)}
          </>
        ) : (
          'No more doses today'
        )}
      </p>
      <p className={cn('flex items-center gap-1.5 text-sm font-medium', TONE_TEXT[a.tone])}>
        <a.icon className="size-4" weight="fill" aria-hidden />
        <span className="text-ink-2">{a.text}</span>
      </p>
    </article>
  )
}

function Onboarding() {
  const steps = [
    { icon: UsersIcon, title: 'Add the person you care for', to: '/patients?new=1' },
    { icon: PillIcon, title: 'Add their medicines', to: '/medicines' },
    { icon: CalendarBlankIcon, title: 'Set morning, afternoon and night times', to: '/schedules' },
    { icon: BroadcastIcon, title: 'Register the dispenser (for example MED-001)', to: '/devices' },
    { icon: BellIcon, title: 'Turn on alerts for this device', to: '/settings' },
  ]
  return (
    <Panel title="Let's set things up" description="Five short steps. You can change everything later.">
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.to}>
            <Link
              to={s.to}
              className="flex h-full items-center gap-3 rounded-lg border border-line p-3 hover:border-brand hover:bg-brand-soft/40"
            >
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-sm font-semibold text-brand-ink tabular">
                {i + 1}
              </span>
              <s.icon className="size-5 shrink-0 text-ink-3" aria-hidden />
              <span className="text-[15px] font-medium">{s.title}</span>
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading today's overview" className="flex flex-col gap-5">
      <Skeleton className="h-28" />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.65fr_1fr]">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const { data, error, isPending, refetch, isFetching } = useDashboard()
  const now = useNow()
  const firstName = user?.full_name.split(' ')[0]
  const body = useRef<HTMLDivElement>(null)
  useBatchReveal(body, '[data-reveal]', [Boolean(data)])

  return (
    <>
      <Hero data={data} name={firstName ?? ''} timeZone={user?.timezone} />

      <PushNudge />

      {isPending ? (
        <DashboardSkeleton />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <div ref={body} className={cn('transition-opacity', isFetching && 'opacity-95')}>
          <Attention data={data} />
          <Summary data={data} />
          {data.patients.length === 0 ? (
            <Onboarding />
          ) : (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] xl:items-start">
              <div className="contents xl:flex xl:flex-col xl:gap-5">
                <Panel
                  reveal
                  className="order-1 xl:order-none"
                  title="Today's medication"
                  description={`${data.summary.doses_today} doses across ${data.summary.patients} ${data.summary.patients === 1 ? 'person' : 'people'}`}
                  action={
                    <Link to="/schedules" className="text-sm font-medium link">
                      Edit schedules
                    </Link>
                  }
                  bodyClass="px-2 sm:px-3"
                >
                  {data.doses.length ? (
                    <DoseTimeline doses={data.doses} showPatient={data.summary.patients > 1 || user?.role === 'admin'} />
                  ) : (
                    <EmptyState
                      compact
                      icon={CalendarBlankIcon}
                      title="No doses scheduled for today"
                      action={
                        <Link to="/schedules" className={buttonClass('secondary', 'sm')}>
                          Create a schedule
                        </Link>
                      }
                    >
                      Doses appear here once a medicine has a schedule for today.
                    </EmptyState>
                  )}
                </Panel>
                <Panel reveal className="order-3 xl:order-none" title="People you care for">
                  <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {data.patients.map((p) => (
                      <PatientCard key={p.id} p={p} />
                    ))}
                  </div>
                </Panel>
              </div>
              <div className="contents xl:flex xl:flex-col xl:gap-5">
                <Panel
                  reveal
                  className="order-2 xl:order-none"
                  title="Alerts"
                  description="Last 24 hours"
                  action={
                    <Link to="/notifications" className="text-sm font-medium link">
                      See all
                    </Link>
                  }
                  bodyClass="px-2 sm:px-3"
                >
                  {data.alerts.length ? (
                    <ul className="flex flex-col">
                      {data.alerts.map((n) => (
                        <NotificationItem key={n.id} n={n} now={now} compact />
                      ))}
                    </ul>
                  ) : (
                    <EmptyState compact icon={BellIcon} title="No alerts">
                      Due, missed and device alerts will appear here.
                    </EmptyState>
                  )}
                </Panel>
                <Panel reveal className="order-4 xl:order-none" title="Adherence this week" description="Confirmed doses out of doses due">
                  <AdherenceChart days={data.week} />
                </Panel>
                <Panel reveal className="order-5 xl:order-none" title="Recent activity" bodyClass="px-4 sm:px-5 pt-1">
                  <ActivityFeed events={data.activity} now={now} />
                </Panel>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
