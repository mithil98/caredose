import {
  BellRingingIcon,
  CheckCircleIcon,
  ClockIcon,
  CloudSunIcon,
  MoonStarsIcon,
  PackageIcon,
  PlugsIcon,
  ProhibitIcon,
  SunHorizonIcon,
  SunIcon,
  WarningCircleIcon,
  WifiHighIcon,
  WifiMediumIcon,
  WifiSlashIcon,
  WrenchIcon,
  type Icon,
} from '@phosphor-icons/react'
import type { DeviceStatus, Dose, DoseStatus, Period } from '../types/api'
import { Badge, cn, type Tone } from './ui'

interface Meta {
  label: string
  tone: Tone
  icon: Icon
}

export const DOSE_META: Record<DoseStatus, Meta> = {
  scheduled: { label: 'Upcoming', tone: 'neutral', icon: ClockIcon },
  due: { label: 'Due now', tone: 'warn', icon: BellRingingIcon },
  dispensed: { label: 'Dispensed', tone: 'warn', icon: PackageIcon },
  taken: { label: 'Taken', tone: 'ok', icon: CheckCircleIcon },
  missed: { label: 'Missed', tone: 'bad', icon: WarningCircleIcon },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: ProhibitIcon },
}

export function doseMeta(d: Pick<Dose, 'status' | 'is_late'>): Meta {
  if (d.status === 'taken' && d.is_late) return { ...DOSE_META.taken, label: 'Taken late' }
  return DOSE_META[d.status]
}

export function DoseStatusBadge({ dose, className }: { dose: Pick<Dose, 'status' | 'is_late'>; className?: string }) {
  const m = doseMeta(dose)
  return (
    <Badge tone={m.tone} icon={m.icon} className={className}>
      {m.label}
    </Badge>
  )
}

export const DEVICE_META: Record<DeviceStatus, Meta & { hint: string }> = {
  online: { label: 'Online', tone: 'ok', icon: WifiHighIcon, hint: 'Checking in normally' },
  warning: { label: 'Late check-in', tone: 'warn', icon: WifiMediumIcon, hint: 'Has not checked in for a few minutes' },
  offline: { label: 'Offline', tone: 'bad', icon: WifiSlashIcon, hint: 'Not communicating with the server' },
  error: { label: 'Needs attention', tone: 'bad', icon: WrenchIcon, hint: 'The device reported a problem' },
  unregistered: { label: 'Not connected yet', tone: 'neutral', icon: PlugsIcon, hint: 'Waiting for its first check-in' },
}

export function DeviceStatusBadge({ status, className }: { status: DeviceStatus; className?: string }) {
  const m = DEVICE_META[status]
  return (
    <Badge tone={m.tone} icon={m.icon} className={className}>
      {m.label}
    </Badge>
  )
}

export const PERIOD_ICON: Record<Period, Icon> = {
  morning: SunHorizonIcon,
  afternoon: SunIcon,
  evening: CloudSunIcon,
  night: MoonStarsIcon,
}

export function PeriodIcon({ period, className }: { period: Period; className?: string }) {
  const IconCmp = PERIOD_ICON[period]
  return <IconCmp className={cn('size-5', className)} aria-hidden />
}
