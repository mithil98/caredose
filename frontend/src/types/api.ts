// Mirrors backend/app/schemas.py (the API contract).

export type Role = 'admin' | 'caretaker'
export type Period = 'morning' | 'afternoon' | 'evening' | 'night'
export type DoseStatus = 'scheduled' | 'due' | 'dispensed' | 'taken' | 'missed' | 'cancelled'
export type DeviceStatus = 'online' | 'warning' | 'offline' | 'error' | 'unregistered'
export type Severity = 'info' | 'success' | 'warning' | 'critical'

export interface User {
  id: number
  email: string
  full_name: string
  role: Role
  timezone: string
  is_active: boolean
  created_at: string
  last_login_at: string | null
}

export interface TokenOut {
  access_token: string
  token_type: string
  expires_in: number
  user: User
}

export interface PersonRef {
  id: number
  full_name: string
}

export interface DeviceBrief {
  id: number
  device_uid: string
  name: string | null
  status: DeviceStatus
  last_seen_at: string | null
}

export interface DayStats {
  scheduled: number
  taken: number
  missed: number
  late: number
  pending: number
  total: number
  adherence: number | null
}

export interface Patient {
  id: number
  full_name: string
  date_of_birth: string | null
  contact_phone: string | null
  notes: string | null
  timezone: string
  is_active: boolean
  created_at: string
  caretaker: PersonRef
  devices: DeviceBrief[]
  medicine_count: number
  today: DayStats
}

export interface PatientInput {
  full_name: string
  date_of_birth: string | null
  contact_phone: string | null
  notes: string | null
  timezone: string
  is_active: boolean
  caretaker_id?: number | null
}

export interface Medicine {
  id: number
  patient_id: number
  patient_name: string
  name: string
  generic_name: string | null
  dose_quantity: string
  dose_unit: string
  instructions: string | null
  is_active: boolean
  schedule_count: number
  created_at: string
  updated_at: string
}

export interface MedicineInput {
  name: string
  generic_name: string | null
  dose_quantity: string
  dose_unit: string
  instructions: string | null
  is_active: boolean
}

export interface Schedule {
  id: number
  patient_id: number
  patient_name: string
  medicine_id: number
  medicine_name: string
  dose_quantity: string
  dose_unit: string
  time_of_day: string
  period: Period
  days_of_week: number[]
  start_date: string
  end_date: string | null
  is_active: boolean
  created_at: string
}

export interface ScheduleInput {
  medicine_id: number
  dose_quantity: string | null
  time_of_day: string
  period: Period
  days_of_week: number[]
  start_date: string | null
  end_date: string | null
  is_active: boolean
}

export interface Dose {
  id: number
  patient_id: number
  patient_name: string
  patient_timezone: string
  schedule_id: number | null
  medicine_id: number | null
  medicine_name: string
  dose_quantity: string
  dose_unit: string
  period: Period
  scheduled_for: string
  local_date: string
  status: DoseStatus
  due_at: string | null
  dispensed_at: string | null
  taken_at: string | null
  missed_at: string | null
  cancelled_at: string | null
  is_late: boolean
  device_uid: string | null
}

export interface MedicineEvent {
  id: number
  event_id: string
  source: 'device' | 'server' | 'caretaker'
  event_type: string
  result: 'applied' | 'ignored' | 'unmatched'
  detail: string | null
  device_uid: string | null
  patient_id: number | null
  patient_name: string | null
  dose_id: number | null
  medicine_name: string | null
  period: Period | null
  event_time: string
  received_at: string
}

export interface Device extends DeviceBrief {
  patient: PersonRef | null
  owner: PersonRef
  firmware_version: string | null
  signal_strength: number | null
  last_error: string | null
  offline_since: string | null
  is_active: boolean
  created_at: string
}

export interface DeviceKeyOut {
  device: Device
  device_key: string
}

export interface AppNotification {
  id: number
  type: string
  severity: Severity
  title: string
  body: string
  url: string
  patient_id: number | null
  patient_name: string | null
  device_id: number | null
  dose_id: number | null
  read_at: string | null
  created_at: string
  push_sent: number
  push_error: string | null
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface NotificationPage extends Page<AppNotification> {
  unread: number
}

export interface Preferences {
  medicine_due: boolean
  medicine_dispensed: boolean
  medicine_taken: boolean
  medicine_missed: boolean
  device_offline: boolean
  device_online: boolean
  device_error: boolean
}

export interface PushStatus {
  configured: boolean
  vapid_public_key: string | null
  subscriptions: number
}

export interface DailyAdherence extends DayStats {
  date: string
}

export interface Adherence {
  patient_id: number | null
  today: DayStats
  week: DayStats
  month: DayStats
  daily: DailyAdherence[]
  note: string
}

export interface PatientOverview {
  id: number
  full_name: string
  timezone: string
  device: DeviceBrief | null
  today: DayStats
  next_dose: Dose | null
  alert: 'missed' | 'device_offline' | 'device_error' | 'due' | 'ok'
}

export interface Dashboard {
  generated_at: string
  summary: {
    patients: number
    doses_today: number
    taken: number
    pending: number
    missed: number
    late: number
    devices_total: number
    devices_online: number
    devices_offline: number
    adherence_today: number | null
  }
  doses: Dose[]
  patients: PatientOverview[]
  activity: MedicineEvent[]
  alerts: AppNotification[]
  week: DailyAdherence[]
}

export interface AdminUser extends User {
  patient_count: number
  device_count: number
}

export interface SystemConfig {
  missed_dose_timeout_minutes: number
  late_dose_after_minutes: number
  device_warning_after_minutes: number
  device_offline_after_minutes: number
}

export interface AuditEntry {
  id: number
  actor_email: string | null
  actor_device_id: number | null
  action: string
  entity_type: string
  entity_id: string | null
  details: Record<string, unknown>
  ip: string | null
  created_at: string
}

export interface Health {
  status: 'ok' | 'degraded'
  database: boolean
  scheduler_running: boolean
  scheduler_last_tick_at: string | null
  push_configured: boolean
  websocket_connections: number
  users: number
  patients: number
  devices: Record<string, number>
  push_subscriptions: number
  notifications_24h: number
  events_24h: number
}

export interface DeviceEventResult {
  id: number
  event_id: string
  event_type: string
  result: 'applied' | 'ignored' | 'unmatched'
  duplicate: boolean
  detail: string | null
  dose_id: number | null
  dose_status: DoseStatus | null
  received_at: string
}
