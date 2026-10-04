import type { Period } from '../types/api'

const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone

export function fmtTime(iso: string | null | undefined, timeZone?: string) {
  if (!iso) return ''
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso))
}

export function fmtDate(iso: string | null | undefined, timeZone?: string, opts: Intl.DateTimeFormatOptions = {}) {
  if (!iso) return ''
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone, ...opts }).format(new Date(iso))
}

export function fmtDateTime(iso: string | null | undefined, timeZone?: string) {
  if (!iso) return ''
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso))
}

/** "YYYY-MM-DD" (a calendar date, no timezone) to a readable label. */
export function fmtLocalDate(day: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const [y, m, d] = day.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
}

/** "20:00:00" -> "8:00 PM" */
export function fmtClock(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, 0, 1, h, m)),
  )
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function fmtRelative(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return 'never'
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) return seconds <= 0 ? `${Math.max(abs, 1)} seconds ago` : 'in a few seconds'
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour')
  return rtf.format(Math.round(seconds / 86400), 'day')
}

const NO_PLURAL = new Set(['ml', 'mg', 'mcg', 'g', 'iu'])

export function fmtQty(qty: string | number, unit: string) {
  const n = Number(qty)
  const plural = n === 1 || unit.endsWith('s') || NO_PLURAL.has(unit.toLowerCase()) ? unit : `${unit}s`
  return `${n} ${plural}`
}

export const PERIODS: Period[] = ['morning', 'afternoon', 'evening', 'night']
export const PERIOD_LABEL: Record<Period, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
}

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const WEEKDAYS = DAY_SHORT.map((label, i) => ({ value: i + 1, label }))

export function fmtDays(days: number[]) {
  const set = [...new Set(days)].sort()
  if (set.length === 7) return 'Every day'
  if (set.join() === '1,2,3,4,5') return 'Weekdays'
  if (set.join() === '6,7') return 'Weekends'
  return set.map((d) => DAY_SHORT[d - 1]).join(', ')
}

export function greeting(timeZone?: string) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date()))
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function ageFrom(dob: string | null) {
  if (!dob) return null
  const [y, m, d] = dob.split('-').map(Number)
  const now = new Date()
  let age = now.getFullYear() - y
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--
  return age
}

export function tzLabel(tz: string) {
  return tz === browserTz ? '' : tz.split('/').pop()!.replace(/_/g, ' ')
}

export function todayIn(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
}

// ICU still reports some legacy IANA names; show the current ones (the backend accepts both).
const LEGACY_TZ: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Rangoon': 'Asia/Yangon',
  'Europe/Kiev': 'Europe/Kyiv',
}

export const TIMEZONES: string[] = (() => {
  let zones: string[]
  try {
    zones = Intl.supportedValuesOf('timeZone')
  } catch {
    zones = []
  }
  return [...new Set([...zones.map((z) => LEGACY_TZ[z] ?? z), 'Asia/Kolkata', 'UTC'])].sort()
})()

export function browserTimezone() {
  return LEGACY_TZ[browserTz] ?? browserTz
}

/** Options for a timezone <select>, guaranteed to contain the saved value. */
export function tzOptions(current?: string) {
  return current && !TIMEZONES.includes(current) ? [current, ...TIMEZONES] : TIMEZONES
}

/** Strip a leading emoji from push-style titles; the UI shows icons instead. */
export function plainTitle(title: string) {
  return title.replace(/^[^\p{L}\p{N}]+/u, '')
}
