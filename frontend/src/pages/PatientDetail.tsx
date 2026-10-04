import {
  BroadcastIcon,
  CalendarBlankIcon,
  ClockCounterClockwiseIcon,
  PencilSimpleIcon,
  PillIcon,
  PlusIcon,
  SealCheckIcon,
} from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { AdherenceChart } from '../components/charts'
import { doseTrail, DoseTimeline } from '../components/doses'
import { DeviceDialog, MedicineDialog, PatientDialog, ScheduleDialog } from '../components/forms'
import { NotificationItem } from '../components/feeds'
import { ScheduleBoard } from '../components/ScheduleBoard'
import { DoseHistoryList } from '../components/history'
import { DeviceStatusBadge, DoseStatusBadge } from '../components/status'
import {
  Badge,
  Button,
  buttonClass,
  Callout,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Panel,
  Tabs,
  useNow,
  useTab,
} from '../components/ui'
import { get } from '../lib/api'
import { ageFrom, fmtDate, fmtLocalDate, fmtQty, fmtRelative, fmtTime, todayIn } from '../lib/format'
import { useMedicines, useSchedules } from '../lib/queries'
import type { Adherence, Dose, Medicine, NotificationPage, Page, Patient } from '../types/api'

const TABS = ['overview', 'medicines', 'schedule', 'history', 'adherence', 'device'] as const

function StatBlock({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <p className="text-sm text-ink-2">{label}</p>
      <p className="text-section font-semibold sm:text-title">{value}</p>
      <p className="text-[13px] text-ink-3 tabular">{sub}</p>
    </div>
  )
}

function AdherenceSummary({ a }: { a: Adherence }) {
  const pct = (v: number | null) => (v === null ? 'None due' : `${v}%`)
  return (
    <div className="grid grid-cols-3 gap-2">
      <StatBlock label="Today" value={pct(a.today.adherence)} sub={`${a.today.taken} of ${a.today.scheduled}`} />
      <StatBlock label="7 days" value={pct(a.week.adherence)} sub={`${a.week.taken} of ${a.week.scheduled}`} />
      <StatBlock label="30 days" value={pct(a.month.adherence)} sub={`${a.month.taken} of ${a.month.scheduled}`} />
    </div>
  )
}

function OpenedDose({ doseId }: { doseId: number }) {
  const { data } = useQuery({ queryKey: ['dose', doseId], queryFn: () => get<Dose>(`/doses/${doseId}`) })
  if (!data) return null
  const tz = data.patient_timezone
  return (
    <Callout
      tone={data.status === 'missed' ? 'bad' : data.status === 'taken' ? 'ok' : 'warn'}
      icon={SealCheckIcon}
      title={`${data.medicine_name}, ${fmtQty(data.dose_quantity, data.dose_unit)} at ${fmtTime(data.scheduled_for, tz)} on ${fmtLocalDate(data.local_date)}`}
      action={<DoseStatusBadge dose={data} />}
    >
      <p>{doseTrail(data) || 'No device events recorded yet.'}</p>
      {data.device_uid && <p className="text-ink-3">Reported by {data.device_uid}</p>}
    </Callout>
  )
}

export default function PatientDetail() {
  const id = Number(useParams().id)
  const [params] = useSearchParams()
  const doseParam = Number(params.get('dose')) || undefined
  const [tab, setTab] = useTab(TABS, 'overview')
  const now = useNow()
  const [dialog, setDialog] = useState<null | 'edit' | 'medicine' | 'schedule' | 'device'>(null)
  const [editMedicine, setEditMedicine] = useState<Medicine | undefined>()

  const patientQ = useQuery({ queryKey: ['patient', id], queryFn: () => get<Patient>(`/patients/${id}`) })
  const patient = patientQ.data
  const today = patient ? todayIn(patient.timezone) : undefined
  const dosesQ = useQuery({
    queryKey: ['doses', 'patient-today', id, today],
    queryFn: () => get<Page<Dose>>('/doses', { patient_id: id, date_from: today, date_to: today, page_size: 100 }),
    enabled: !!today,
    select: (p) => [...p.items].sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for)),
  })
  const adherenceQ = useQuery({ queryKey: ['adherence', id], queryFn: () => get<Adherence>(`/analytics/patients/${id}/adherence`) })
  const alertsQ = useQuery({
    queryKey: ['notifications', 'patient', id],
    queryFn: () => get<NotificationPage>('/notifications', { patient_id: id, page_size: 5 }),
  })
  const medicines = useMedicines(id)
  const schedules = useSchedules(id)

  if (patientQ.isPending) return <LoadingBlock rows={5} label="Loading patient" />
  if (patientQ.error || !patient) return <ErrorState error={patientQ.error ?? new Error('Patient not found')} onRetry={patientQ.refetch} />

  const age = ageFrom(patient.date_of_birth)
  const device = patient.devices[0]

  return (
    <>
      <PageHeader
        back={{ to: '/patients', label: 'All patients' }}
        title={patient.full_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {age !== null && <span>{age} years</span>}
            <span className="text-ink-3">{patient.timezone}</span>
            {!patient.is_active && <Badge>Inactive</Badge>}
            {device ? <DeviceStatusBadge status={device.status} /> : <Badge>No dispenser</Badge>}
          </span>
        }
        actions={
          <Button variant="secondary" icon={PencilSimpleIcon} onClick={() => setDialog('edit')}>
            Edit details
          </Button>
        }
      />
      <Tabs
        label="Patient sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'medicines', label: 'Medicines', count: medicines.data?.length },
          { id: 'schedule', label: 'Schedule', count: schedules.data?.length },
          { id: 'history', label: 'History' },
          { id: 'adherence', label: 'Adherence' },
          { id: 'device', label: 'Device' },
        ]}
      />

      {tab === 'overview' && (
        <div className="flex flex-col gap-5">
          {doseParam && <OpenedDose doseId={doseParam} />}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
            <Panel
              title="Today"
              description={today ? fmtLocalDate(today, { weekday: 'long', day: 'numeric', month: 'long' }) : undefined}
              bodyClass="px-2 sm:px-3"
              action={
                <Button size="sm" variant="secondary" icon={PlusIcon} onClick={() => setDialog('schedule')}>
                  Schedule
                </Button>
              }
            >
              {dosesQ.isPending ? (
                <LoadingBlock />
              ) : dosesQ.error ? (
                <ErrorState error={dosesQ.error} onRetry={dosesQ.refetch} />
              ) : dosesQ.data.length ? (
                <DoseTimeline doses={dosesQ.data} showPatient={false} highlightId={doseParam} />
              ) : (
                <EmptyState compact icon={CalendarBlankIcon} title="No doses today">
                  {schedules.data?.length ? 'No schedule applies to today.' : 'Create a schedule to start tracking doses.'}
                </EmptyState>
              )}
            </Panel>
            <div className="flex flex-col gap-5">
              <Panel title="Adherence" description="Confirmed doses out of doses due">
                {adherenceQ.data ? <AdherenceSummary a={adherenceQ.data} /> : <LoadingBlock rows={1} />}
              </Panel>
              <Panel
                title="Recent alerts"
                bodyClass="px-2 sm:px-3"
                action={
                  <Link to="/notifications" className="text-sm font-medium link">
                    All alerts
                  </Link>
                }
              >
                {alertsQ.data?.items.length ? (
                  <ul>
                    {alertsQ.data.items.map((n) => (
                      <NotificationItem key={n.id} n={n} now={now} compact />
                    ))}
                  </ul>
                ) : (
                  <p className="px-2 py-4 text-sm text-ink-3">No alerts for {patient.full_name} yet.</p>
                )}
              </Panel>
              <Panel title="Profile">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
                  <dt className="text-ink-3">Date of birth</dt>
                  <dd>
                    {patient.date_of_birth
                      ? fmtLocalDate(patient.date_of_birth, { day: 'numeric', month: 'long', year: 'numeric' })
                      : 'Not set'}
                  </dd>
                  <dt className="text-ink-3">Phone</dt>
                  <dd>{patient.contact_phone ?? 'Not set'}</dd>
                  <dt className="text-ink-3">Caretaker</dt>
                  <dd>{patient.caretaker.full_name}</dd>
                  <dt className="text-ink-3">Added</dt>
                  <dd>{fmtDate(patient.created_at, undefined, { year: 'numeric' })}</dd>
                  {patient.notes && (
                    <>
                      <dt className="text-ink-3">Notes</dt>
                      <dd className="whitespace-pre-line">{patient.notes}</dd>
                    </>
                  )}
                </dl>
              </Panel>
            </div>
          </div>
        </div>
      )}

      {tab === 'medicines' && (
        <Panel
          title="Medicines"
          description="As entered by the caretaker. Changes apply to upcoming doses."
          action={
            <Button size="sm" icon={PlusIcon} onClick={() => (setEditMedicine(undefined), setDialog('medicine'))}>
              Add medicine
            </Button>
          }
        >
          {medicines.isPending ? (
            <LoadingBlock />
          ) : medicines.data?.length ? (
            <ul className="divide-y divide-line">
              {medicines.data.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-3">
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                    <PillIcon className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {m.name}
                      {m.generic_name && <span className="font-normal text-ink-3"> ({m.generic_name})</span>}
                    </p>
                    <p className="text-sm text-ink-2">
                      {fmtQty(m.dose_quantity, m.dose_unit)}
                      {m.instructions && ` · ${m.instructions}`}
                    </p>
                  </div>
                  {!m.is_active && <Badge>Inactive</Badge>}
                  <span className="hidden text-sm text-ink-3 sm:inline">
                    {m.schedule_count} schedule{m.schedule_count === 1 ? '' : 's'}
                  </span>
                  <Button size="sm" variant="ghost" icon={PencilSimpleIcon} onClick={() => (setEditMedicine(m), setDialog('medicine'))}>
                    Edit
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={PillIcon} title="No medicines yet">
              Add the first medicine for {patient.full_name}.
            </EmptyState>
          )}
        </Panel>
      )}

      {tab === 'schedule' && <ScheduleBoard patientId={id} />}

      {tab === 'history' && (
        <Panel title="Dose history" bodyClass="px-0 sm:px-0 pb-0">
          <DoseHistoryList filters={{ patient_id: id }} showPatient={false} />
        </Panel>
      )}

      {tab === 'adherence' && (
        <div className="flex flex-col gap-5">
          {adherenceQ.data ? (
            <>
              <Panel title="Summary">
                <AdherenceSummary a={adherenceQ.data} />
                <p className="mt-3 text-sm text-ink-3">{adherenceQ.data.note}</p>
              </Panel>
              <Panel title="Last 30 days" description="Hover or focus a day for details">
                <AdherenceChart days={adherenceQ.data.daily} height={200} />
              </Panel>
              <Panel title="Missed and late doses (30 days)">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StatBlock label="Doses due" value={String(adherenceQ.data.month.scheduled)} sub="last 30 days" />
                  <StatBlock label="Taken" value={String(adherenceQ.data.month.taken)} sub="confirmed" />
                  <StatBlock label="Late" value={String(adherenceQ.data.month.late)} sub="taken after the window" />
                  <StatBlock label="Missed" value={String(adherenceQ.data.month.missed)} sub="not confirmed" />
                </div>
              </Panel>
            </>
          ) : adherenceQ.error ? (
            <ErrorState error={adherenceQ.error} onRetry={adherenceQ.refetch} />
          ) : (
            <LoadingBlock />
          )}
        </div>
      )}

      {tab === 'device' && (
        <Panel title="Dispenser">
          {device ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                <BroadcastIcon className="size-6" aria-hidden />
              </span>
              <div className="flex-1">
                <p className="font-mono text-lg font-semibold">{device.device_uid}</p>
                <p className="text-sm text-ink-2">
                  {device.name ?? 'Unnamed'} · last seen {fmtRelative(device.last_seen_at, now)}
                </p>
              </div>
              <DeviceStatusBadge status={device.status} />
              <Link to={`/devices/${device.device_uid}`} className={buttonClass('secondary', 'sm')}>
                <ClockCounterClockwiseIcon className="size-4" aria-hidden />
                Device details
              </Link>
            </div>
          ) : (
            <EmptyState
              compact
              icon={BroadcastIcon}
              title="No dispenser assigned"
              action={
                <Button icon={PlusIcon} onClick={() => setDialog('device')}>
                  Register dispenser
                </Button>
              }
            >
              Register the device at {patient.full_name}'s home to receive its events.
            </EmptyState>
          )}
        </Panel>
      )}

      <PatientDialog open={dialog === 'edit'} onClose={() => setDialog(null)} patient={patient} />
      <MedicineDialog open={dialog === 'medicine'} onClose={() => setDialog(null)} medicine={editMedicine} patientId={id} />
      <ScheduleDialog open={dialog === 'schedule'} onClose={() => setDialog(null)} patientId={id} />
      <DeviceDialog open={dialog === 'device'} onClose={() => setDialog(null)} defaultPatientId={id} />
    </>
  )
}
