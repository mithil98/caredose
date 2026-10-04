import {
  BellRingingIcon,
  CheckCircleIcon,
  PackageIcon,
  ProhibitIcon,
  WarningCircleIcon,
  WifiHighIcon,
  WifiSlashIcon,
  WrenchIcon,
  type Icon,
} from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { post } from '../lib/api'
import { fmtRelative, fmtTime, plainTitle } from '../lib/format'
import type { AppNotification, MedicineEvent } from '../types/api'
import { cn, TONE_SOFT, TONE_TEXT, type Tone } from './ui'

export const EVENT_META: Record<string, { label: string; icon: Icon; tone: Tone }> = {
  medicine_due: { label: 'Medicine due', icon: BellRingingIcon, tone: 'warn' },
  medicine_dispensed: { label: 'Medicine dispensed', icon: PackageIcon, tone: 'info' },
  medicine_taken: { label: 'Dose confirmed', icon: CheckCircleIcon, tone: 'ok' },
  medicine_missed: { label: 'Dose missed', icon: WarningCircleIcon, tone: 'bad' },
  medicine_cancelled: { label: 'Dose cancelled', icon: ProhibitIcon, tone: 'neutral' },
  device_online: { label: 'Device connected', icon: WifiHighIcon, tone: 'ok' },
  device_offline: { label: 'Device offline', icon: WifiSlashIcon, tone: 'bad' },
  device_error: { label: 'Device reported a problem', icon: WrenchIcon, tone: 'bad' },
  test: { label: 'Test notification', icon: BellRingingIcon, tone: 'info' },
}

const SEVERITY_TONE: Record<string, Tone> = { critical: 'bad', warning: 'warn', success: 'ok', info: 'info' }

function Glyph({ icon: IconCmp, tone }: { icon: Icon; tone: Tone }) {
  return (
    <span className={cn('inline-flex size-9 shrink-0 items-center justify-center rounded-2xl', TONE_SOFT[tone], TONE_TEXT[tone])}>
      <IconCmp className="size-5" weight="fill" aria-hidden />
    </span>
  )
}

export function sourceLabel(e: MedicineEvent) {
  if (e.source === 'device') return e.device_uid ?? 'device'
  if (e.source === 'caretaker') return 'caretaker'
  return 'system'
}

export function ActivityFeed({ events, now }: { events: MedicineEvent[]; now: number }) {
  return (
    <ol className="flex flex-col">
      {events.map((e) => {
        const m = EVENT_META[e.event_type] ?? EVENT_META.medicine_due
        const subject = [e.medicine_name, e.patient_name].filter(Boolean).join(' for ')
        return (
          <li key={e.id} className="flex gap-3 py-2.5">
            <Glyph icon={m.icon} tone={m.tone} />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium text-ink">{m.label}</p>
              <p className="truncate text-sm text-ink-3">
                {subject || (e.device_uid ? `Device ${e.device_uid}` : '')}
                {e.result !== 'applied' && <span className="text-warn-ink"> (not applied: {e.result})</span>}
              </p>
            </div>
            <div className="shrink-0 text-right text-[13px] text-ink-3">
              <time dateTime={e.event_time} title={new Date(e.event_time).toLocaleString()} className="tabular">
                {fmtTime(e.event_time)}
              </time>
              <p className="max-w-24 truncate">{sourceLabel(e)}</p>
            </div>
          </li>
        )
      })}
      {events.length === 0 && <li className="py-6 text-center text-sm text-ink-3">Nothing has happened yet today.</li>}
      <span className="sr-only">Updated {fmtRelative(new Date(now).toISOString(), now)}</span>
    </ol>
  )
}

export function NotificationItem({ n, now, compact }: { n: AppNotification; now: number; compact?: boolean }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const read = useMutation({
    mutationFn: () => post(`/notifications/${n.id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const m = EVENT_META[n.type] ?? EVENT_META.test
  const tone = SEVERITY_TONE[n.severity] ?? m.tone
  const unread = !n.read_at
  const open = () => {
    if (unread) read.mutate()
    navigate(n.url)
  }
  return (
    <li className={cn('relative flex gap-3 rounded-lg px-2 py-3 transition hover:bg-surface-2', unread && 'bg-brand-soft/40')}>
      <Glyph icon={m.icon} tone={tone} />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={open} className="text-left after:absolute after:inset-0 after:content-['']">
          <span className={cn('text-[15px] text-ink', unread ? 'font-semibold' : 'font-medium')}>{plainTitle(n.title)}</span>
          {unread && <span className="sr-only"> (unread)</span>}
        </button>
        <p className={cn('text-sm text-ink-2', compact ? 'line-clamp-1' : 'whitespace-pre-line')}>{n.body}</p>
        <p className="mt-0.5 text-[13px] text-ink-3">
          {fmtRelative(n.created_at, now)}
          {!compact && n.push_error && <span> · Push: {n.push_error}</span>}
          {!compact && !n.push_error && n.push_sent > 0 && (
            <span>
              {' '}
              · Sent to {n.push_sent} device{n.push_sent > 1 ? 's' : ''}
            </span>
          )}
        </p>
      </div>
      {unread && (
        <span className="relative z-10 mt-1 self-start rounded-2xl bg-brand px-2 text-xs font-semibold leading-5 text-on-brand">New</span>
      )}
    </li>
  )
}
