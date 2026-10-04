import {
  ArrowsClockwiseIcon,
  BellRingingIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  FlaskIcon,
  HeartbeatIcon,
  KeyIcon,
  PackageIcon,
  WarningCircleIcon,
  WifiHighIcon,
  WifiSlashIcon,
  WrenchIcon,
  type Icon,
} from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { DeviceStatusBadge, DoseStatusBadge } from '../components/status'
import { Button, Callout, cn, EmptyState, Field, Input, PageHeader, Panel, Select, Switch, useToast } from '../components/ui'
import { get, post } from '../lib/api'
import { fmtTime, PERIOD_LABEL } from '../lib/format'
import { useDevices } from '../lib/queries'
import type { Device, DeviceKeyOut, Dose, Page } from '../types/api'

/**
 * Development-only stand-in for the dispenser. Every button calls the SAME device endpoints a
 * real Arduino/SIM800L will call, authenticated with the device key (never a user token).
 */

interface LogEntry {
  id: number
  at: Date
  method: string
  path: string
  body?: unknown
  status: number
  response: unknown
}

const keyStore = {
  get(uid: string) {
    try {
      return sessionStorage.getItem(`sim-key:${uid}`) ?? ''
    } catch {
      return ''
    }
  },
  set(uid: string, key: string) {
    try {
      sessionStorage.setItem(`sim-key:${uid}`, key)
    } catch {
      /* storage unavailable: key lives in memory only */
    }
  },
}

async function deviceCall(method: 'GET' | 'POST', path: string, key: string, body?: unknown) {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: { 'X-Device-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'omit',
  })
  let response: unknown = null
  try {
    response = await res.json()
  } catch {
    response = null
  }
  return { status: res.status, response }
}

const NO_DEVICES: Device[] = []
const newEventId = () => `sim-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`

type Action = { id: string; label: string; icon: Icon; type: string; needsDose?: boolean; tone: string }
const MEDICINE_ACTIONS: Action[] = [
  { id: 'due', label: 'Medicine due', icon: BellRingingIcon, type: 'medicine_due', needsDose: true, tone: 'text-warn' },
  { id: 'dispense', label: 'Dispense', icon: PackageIcon, type: 'medicine_dispensed', needsDose: true, tone: 'text-info' },
  { id: 'taken', label: 'Confirm taken', icon: CheckCircleIcon, type: 'medicine_taken', needsDose: true, tone: 'text-ok' },
  { id: 'missed', label: 'Report missed', icon: WarningCircleIcon, type: 'medicine_missed', needsDose: true, tone: 'text-bad' },
]
const DEVICE_ACTIONS: Action[] = [
  { id: 'online', label: 'Device online', icon: WifiHighIcon, type: 'device_online', tone: 'text-ok' },
  { id: 'offline', label: 'Device offline', icon: WifiSlashIcon, type: 'device_offline', tone: 'text-bad' },
  { id: 'error', label: 'Device error', icon: WrenchIcon, type: 'device_error', tone: 'text-bad' },
]

export default function Simulator() {
  const devices = useDevices().data ?? NO_DEVICES
  const toast = useToast()
  const [uid, setUid] = useState('')
  const device = devices.find((d) => d.device_uid === uid)
  const [key, setKey] = useState('')
  const [target, setTarget] = useState<string>('auto')
  const [errorText, setErrorText] = useState('Servo 2 jammed')
  const [log, setLog] = useState<LogEntry[]>([])
  const [lastEvent, setLastEvent] = useState<Record<string, unknown> | null>(null)
  const [autoBeat, setAutoBeat] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!uid && devices.length) setUid(devices[0].device_uid)
  }, [devices, uid])
  useEffect(() => setKey(uid ? keyStore.get(uid) : ''), [uid])

  const patientId = device?.patient?.id
  const since = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const dosesQ = useQuery({
    queryKey: ['doses', 'simulator', patientId],
    queryFn: () => get<Page<Dose>>('/doses', { patient_id: patientId, date_from: since, page_size: 50 }),
    enabled: !!patientId,
    select: (p) => [...p.items].sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for)),
  })
  const doses = dosesQ.data ?? []
  const targetDose = doses.find((d) => String(d.id) === target)

  async function call(label: string, method: 'GET' | 'POST', path: string, body?: unknown) {
    if (!key) {
      toast({ tone: 'warn', title: 'Device key needed', body: 'Paste the key shown at registration, or generate a new one.' })
      return null
    }
    setBusy(label)
    try {
      const r = await deviceCall(method, path, key, body)
      setLog((l) => [{ id: Date.now() + Math.random(), at: new Date(), method, path, body, ...r }, ...l].slice(0, 30))
      return r
    } catch {
      toast({ tone: 'bad', title: 'Backend unreachable', body: 'Is the API running?' })
      return null
    } finally {
      setBusy(null)
    }
  }

  const heartbeat = () =>
    call('heartbeat', 'POST', `/devices/${uid}/heartbeat`, {
      device_id: uid,
      timestamp: new Date().toISOString(),
      firmware_version: '1.0.0-sim',
      signal_strength: 18 + Math.floor(Math.random() * 6),
      status: 'ok',
    })

  useEffect(() => {
    if (!autoBeat || !key || !uid) return
    const id = window.setInterval(heartbeat, 15_000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBeat, key, uid])

  async function send(a: Action) {
    const body: Record<string, unknown> = {
      event_id: newEventId(),
      device_id: uid,
      event_type: a.type,
      event_time: new Date().toISOString(),
      metadata: { source: 'web-simulator' } as Record<string, unknown>,
    }
    if (a.needsDose && targetDose) {
      body.schedule_id = targetDose.schedule_id
      ;(body.metadata as Record<string, unknown>).slot = targetDose.period
    }
    if (a.type === 'device_error') (body.metadata as Record<string, unknown>).error = errorText
    setLastEvent(body)
    const r = await call(a.id, 'POST', '/device-events', body)
    if (r) dosesQ.refetch()
  }

  async function resend() {
    if (!lastEvent) return
    await call('resend', 'POST', '/device-events', lastEvent)
  }

  async function rotateKey() {
    try {
      const r = await post<DeviceKeyOut>(`/devices/${uid}/rotate-key`)
      setKey(r.device_key)
      keyStore.set(uid, r.device_key)
      toast({ tone: 'ok', title: 'New device key generated', body: 'A real dispenser would need this key too.' })
    } catch (e) {
      toast({ tone: 'bad', title: 'Could not generate key', body: (e as Error).message })
    }
  }

  if (!devices.length)
    return (
      <>
        <PageHeader title="Device simulator" />
        <Panel>
          <EmptyState icon={FlaskIcon} title="Register a device first">
            The simulator acts as one of your registered devices. Register MED-001 on the Devices page.
          </EmptyState>
        </Panel>
      </>
    )

  return (
    <>
      <PageHeader title="Device simulator" description="Development tool. Sends the same HTTP requests the physical dispenser will send." />
      <Callout tone="info" icon={FlaskIcon} title="Same contract as the hardware">
        Requests go to <code className="font-mono">/api/v1/device-events</code> and{' '}
        <code className="font-mono">/api/v1/devices/{'{id}'}/heartbeat</code> with the <code className="font-mono">X-Device-Key</code>{' '}
        header. Close CareDose in other tabs to see push notifications arrive with the app closed.
      </Callout>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        <div className="flex flex-col gap-5">
          <Panel title="Device">
            <div className="flex flex-col gap-4">
              <Field label="Simulate device">
                {(p) => (
                  <Select {...p} value={uid} onChange={(e) => setUid(e.target.value)}>
                    {devices.map((d) => (
                      <option key={d.id} value={d.device_uid}>
                        {d.device_uid} {d.patient ? `(${d.patient.full_name})` : '(unassigned)'}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {device && (
                <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                  Server sees it as <DeviceStatusBadge status={device.status} />
                </p>
              )}
              <Field label="Device key" hint="Shown once at registration. Kept in this browser tab only.">
                {(p) => (
                  <div className="flex gap-2">
                    <Input
                      {...p}
                      value={key}
                      onChange={(e) => (setKey(e.target.value.trim()), keyStore.set(uid, e.target.value.trim()))}
                      placeholder="dk_…"
                      className="font-mono text-sm"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <Button variant="secondary" icon={KeyIcon} onClick={rotateKey}>
                      New key
                    </Button>
                  </div>
                )}
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" icon={HeartbeatIcon} loading={busy === 'heartbeat'} onClick={heartbeat}>
                  Device heartbeat
                </Button>
                <Button
                  variant="secondary"
                  icon={DownloadSimpleIcon}
                  loading={busy === 'config'}
                  onClick={() => call('config', 'GET', `/devices/${uid}/config`)}
                >
                  Fetch config
                </Button>
              </div>
              <Switch
                checked={autoBeat}
                onChange={setAutoBeat}
                label="Send heartbeats automatically"
                description="Every 15 seconds while this page is open."
              />
            </div>
          </Panel>

          <Panel
            title="Medicine events"
            description={device?.patient ? `For ${device.patient.full_name}` : 'Assign this device to a patient to send medicine events.'}
          >
            <div className="flex flex-col gap-4">
              <Field label="Dose" hint="Auto lets the server match the nearest open dose, like a dispenser without IDs.">
                {(p) => (
                  <Select {...p} value={target} onChange={(e) => setTarget(e.target.value)} disabled={!patientId}>
                    <option value="auto">Auto (server matches)</option>
                    {doses.map((d) => (
                      <option key={d.id} value={d.id}>
                        {fmtTime(d.scheduled_for, d.patient_timezone)} {PERIOD_LABEL[d.period]}: {d.medicine_name} ({d.status})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {targetDose && (
                <p className="flex items-center gap-2 text-sm text-ink-2">
                  Current state <DoseStatusBadge dose={targetDose} />
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                {MEDICINE_ACTIONS.map((a) => (
                  <Button
                    key={a.id}
                    variant="secondary"
                    disabled={!patientId}
                    loading={busy === a.id}
                    onClick={() => send(a)}
                    className="justify-start"
                  >
                    <a.icon className={cn('size-5', a.tone)} weight="fill" aria-hidden />
                    {a.label}
                  </Button>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="Device status events">
            <div className="flex flex-col gap-4">
              <Field label="Error message (for Device error)">
                {(p) => <Input {...p} value={errorText} onChange={(e) => setErrorText(e.target.value)} maxLength={200} />}
              </Field>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {DEVICE_ACTIONS.map((a) => (
                  <Button key={a.id} variant="secondary" loading={busy === a.id} onClick={() => send(a)} className="justify-start">
                    <a.icon className={cn('size-5', a.tone)} weight="bold" aria-hidden />
                    {a.label}
                  </Button>
                ))}
              </div>
              <Button
                variant="ghost"
                icon={ArrowsClockwiseIcon}
                disabled={!lastEvent}
                loading={busy === 'resend'}
                onClick={resend}
                className="self-start"
              >
                Resend last event (same event_id)
              </Button>
              <p className="-mt-2 text-sm text-ink-3">
                Simulates a SIM800L retry. The server stores it once and answers 200 with duplicate: true.
              </p>
            </div>
          </Panel>
        </div>

        <Panel title="Request log" description="Newest first" className="lg:sticky lg:top-24">
          {log.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-3">Requests you send will appear here with the server's response.</p>
          ) : (
            <ol className="flex max-h-[70dvh] flex-col gap-3 overflow-y-auto">
              {log.map((e) => (
                <li key={e.id} className="rounded-lg border border-line">
                  <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
                    <span
                      className={cn(
                        'rounded-sm px-1.5 font-mono text-xs font-semibold',
                        e.status < 300
                          ? 'bg-ok-soft text-ok-ink'
                          : e.status < 500
                            ? 'bg-warn-soft text-warn-ink'
                            : 'bg-bad-soft text-bad-ink',
                      )}
                    >
                      {e.status}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                      {e.method} {e.path}
                    </span>
                    <time className="text-xs text-ink-3 tabular">{e.at.toLocaleTimeString()}</time>
                  </div>
                  <pre className="max-h-56 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed text-ink-2">
                    {e.body ? `> ${JSON.stringify(e.body, null, 2)}\n\n` : ''}
                    {`< ${JSON.stringify(e.response, null, 2)}`}
                  </pre>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </>
  )
}
