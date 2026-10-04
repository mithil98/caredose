import { CheckIcon, CopyIcon, KeyIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { del, post, put } from '../lib/api'
import { useAuth } from '../lib/auth'
import { PERIOD_LABEL, PERIODS, todayIn, tzOptions, WEEKDAYS } from '../lib/format'
import { useAdminUsers, useMedicines, usePatients, useSave } from '../lib/queries'
import type { Device, DeviceKeyOut, Medicine, MedicineInput, Patient, PatientInput, Period, Schedule, ScheduleInput } from '../types/api'
import { PeriodIcon } from './status'
import { Button, cn, Dialog, Field, Input, Select, Switch, Textarea, useToast } from './ui'

function FormAlert({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="mb-4 flex items-start gap-2 rounded-lg bg-bad-soft px-3 py-2.5 text-sm font-medium text-bad-ink">
      <WarningCircleIcon className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden />
      {message}
    </p>
  )
}

const blank = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim()
  return s ? s : null
}

/* ---------------- Patient ---------------- */

export function PatientDialog({
  open,
  onClose,
  patient,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  patient?: Patient
  onSaved?: (p: Patient) => void
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const caretakers = useAdminUsers(isAdmin && open).data
  const toast = useToast()
  const [active, setActive] = useState(patient?.is_active ?? true)
  useEffect(() => setActive(patient?.is_active ?? true), [patient, open])
  const save = useSave(
    (body: PatientInput) => (patient ? put<Patient>(`/patients/${patient.id}`, body) : post<Patient>('/patients', body)),
    {
      invalidate: [['patients'], ['patient']],
      onSuccess: (p) => {
        toast({ tone: 'ok', title: patient ? 'Patient updated' : 'Patient added', body: p.full_name })
        onSaved?.(p)
        onClose()
      },
    },
  )
  useEffect(() => {
    if (open) save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    save.mutate({
      full_name: String(f.get('full_name')),
      date_of_birth: blank(f.get('date_of_birth')),
      contact_phone: blank(f.get('contact_phone')),
      notes: blank(f.get('notes')),
      timezone: String(f.get('timezone')),
      is_active: active,
      caretaker_id: isAdmin && f.get('caretaker_id') ? Number(f.get('caretaker_id')) : undefined,
    })
  }
  const formId = 'patient-form'
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={patient ? `Edit ${patient.full_name}` : 'Add a patient'}
      description="Only the basics. Do not enter diagnoses or other medical records."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {patient ? 'Save changes' : 'Add patient'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormAlert message={save.formError} />
        </div>
        <Field label="Full name" error={save.fields.full_name} className="sm:col-span-2">
          {(p) => <Input {...p} name="full_name" defaultValue={patient?.full_name} required maxLength={120} autoComplete="off" />}
        </Field>
        <Field label="Date of birth" optional error={save.fields.date_of_birth}>
          {(p) => (
            <Input
              {...p}
              name="date_of_birth"
              type="date"
              defaultValue={patient?.date_of_birth ?? ''}
              max={new Date().toISOString().slice(0, 10)}
            />
          )}
        </Field>
        <Field label="Contact phone" optional error={save.fields.contact_phone}>
          {(p) => (
            <Input {...p} name="contact_phone" type="tel" defaultValue={patient?.contact_phone ?? ''} inputMode="tel" autoComplete="off" />
          )}
        </Field>
        <Field label="Timezone" hint="Dose times follow this timezone." error={save.fields.timezone} className="sm:col-span-2">
          {(p) => (
            <Select {...p} name="timezone" defaultValue={patient?.timezone ?? user?.timezone ?? 'Asia/Kolkata'}>
              {tzOptions(patient?.timezone ?? user?.timezone).map((tz) => (
                <option key={tz}>{tz}</option>
              ))}
            </Select>
          )}
        </Field>
        {isAdmin && caretakers && (
          <Field label="Caretaker" className="sm:col-span-2">
            {(p) => (
              <Select {...p} name="caretaker_id" defaultValue={patient?.caretaker.id ?? user?.id}>
                {caretakers
                  .filter((c) => c.is_active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name} ({c.email})
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
        <Field
          label="Notes"
          optional
          hint="Practical notes, for example who lives with them."
          error={save.fields.notes}
          className="sm:col-span-2"
        >
          {(p) => <Textarea {...p} name="notes" defaultValue={patient?.notes ?? ''} maxLength={500} />}
        </Field>
        {patient && (
          <div className="sm:col-span-2">
            <Switch checked={active} onChange={setActive} label="Active" description="Inactive patients get no new doses or alerts." />
          </div>
        )}
      </form>
    </Dialog>
  )
}

/* ---------------- Medicine ---------------- */

const UNITS = ['tablet', 'capsule', 'ml', 'drop', 'puff', 'sachet', 'patch', 'injection', 'unit']

export function MedicineDialog({
  open,
  onClose,
  medicine,
  patientId,
}: {
  open: boolean
  onClose: () => void
  medicine?: Medicine
  patientId?: number
}) {
  const patients = usePatients().data ?? []
  const toast = useToast()
  const [active, setActive] = useState(medicine?.is_active ?? true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => {
    setActive(medicine?.is_active ?? true)
    setConfirmDelete(false)
  }, [medicine, open])
  const save = useSave(
    ({ pid, body }: { pid: number; body: MedicineInput }) =>
      medicine ? put<Medicine>(`/medicines/${medicine.id}`, body) : post<Medicine>(`/patients/${pid}/medicines`, body),
    {
      invalidate: [['medicines'], ['patients'], ['schedules']],
      onSuccess: (m) => {
        toast({ tone: 'ok', title: medicine ? 'Medicine updated' : 'Medicine added', body: `${m.name} for ${m.patient_name}` })
        onClose()
      },
    },
  )
  const remove = useSave(() => del(`/medicines/${medicine!.id}`), {
    invalidate: [['medicines'], ['patients'], ['schedules']],
    onSuccess: () => {
      toast({ tone: 'ok', title: 'Medicine deleted', body: 'Its schedules were removed. Past history is kept.' })
      onClose()
    },
  })
  useEffect(() => {
    if (open) save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    save.mutate({
      pid: Number(f.get('patient_id') ?? medicine?.patient_id ?? patientId),
      body: {
        name: String(f.get('name')),
        generic_name: blank(f.get('generic_name')),
        dose_quantity: String(f.get('dose_quantity')),
        dose_unit: String(f.get('dose_unit')).trim(),
        instructions: blank(f.get('instructions')),
        is_active: active,
      },
    })
  }
  const fixedPatient = medicine?.patient_id ?? patientId
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={medicine ? `Edit ${medicine.name}` : 'Add a medicine'}
      description="Enter it exactly as prescribed. CareDose records instructions; it does not check doses."
      footer={
        <>
          {medicine &&
            (confirmDelete ? (
              <Button
                variant="danger"
                icon={TrashIcon}
                loading={remove.isPending}
                onClick={() => remove.mutate(undefined)}
                className="mr-auto"
              >
                Confirm delete
              </Button>
            ) : (
              <Button variant="ghost" icon={TrashIcon} onClick={() => setConfirmDelete(true)} className="mr-auto text-bad-ink">
                Delete
              </Button>
            ))}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="medicine-form" loading={save.isPending}>
            {medicine ? 'Save changes' : 'Add medicine'}
          </Button>
        </>
      }
    >
      <form id="medicine-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormAlert message={save.formError ?? remove.formError} />
          {confirmDelete && (
            <p className="mb-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-ink">
              Deleting removes this medicine and its schedules. Consider switching it to inactive instead.
            </p>
          )}
        </div>
        {!fixedPatient && (
          <Field label="Patient" className="sm:col-span-2">
            {(p) => (
              <Select {...p} name="patient_id" required defaultValue="">
                <option value="" disabled>
                  Choose a patient
                </option>
                {patients.map((pt) => (
                  <option key={pt.id} value={pt.id}>
                    {pt.full_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Medicine name" error={save.fields.name}>
          {(p) => <Input {...p} name="name" defaultValue={medicine?.name} required maxLength={120} autoComplete="off" />}
        </Field>
        <Field label="Generic name" optional error={save.fields.generic_name}>
          {(p) => <Input {...p} name="generic_name" defaultValue={medicine?.generic_name ?? ''} maxLength={120} autoComplete="off" />}
        </Field>
        <Field label="Dose per intake" error={save.fields.dose_quantity}>
          {(p) => (
            <Input
              {...p}
              name="dose_quantity"
              type="number"
              min="0.25"
              max="1000"
              step="0.25"
              defaultValue={medicine ? Number(medicine.dose_quantity) : 1}
              required
            />
          )}
        </Field>
        <Field label="Unit" error={save.fields.dose_unit}>
          {(p) => (
            <>
              <Input
                {...p}
                name="dose_unit"
                list="dose-units"
                defaultValue={medicine?.dose_unit ?? 'tablet'}
                required
                pattern="[A-Za-z ]{1,24}"
                maxLength={24}
              />
              <datalist id="dose-units">
                {UNITS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field
          label="Instructions"
          optional
          hint="For example: after food, with water."
          error={save.fields.instructions}
          className="sm:col-span-2"
        >
          {(p) => <Textarea {...p} name="instructions" defaultValue={medicine?.instructions ?? ''} maxLength={500} />}
        </Field>
        <div className="sm:col-span-2">
          <Switch checked={active} onChange={setActive} label="Active" description="Inactive medicines are not scheduled." />
        </div>
      </form>
    </Dialog>
  )
}

/* ---------------- Schedule ---------------- */

export function suggestPeriod(time: string): Period {
  const h = Number(time.split(':')[0])
  if (h >= 4 && h < 12) return 'morning'
  if (h >= 12 && h < 17) return 'afternoon'
  if (h >= 17 && h < 20) return 'evening'
  return 'night'
}

export function ScheduleDialog({
  open,
  onClose,
  schedule,
  patientId,
}: {
  open: boolean
  onClose: () => void
  schedule?: Schedule
  patientId?: number
}) {
  const patients = usePatients().data ?? []
  const toast = useToast()
  const [pid, setPid] = useState<number | undefined>(schedule?.patient_id ?? patientId)
  const medicines = (useMedicines(pid).data ?? []).filter((m) => m.is_active || m.id === schedule?.medicine_id)
  const [time, setTime] = useState(schedule?.time_of_day.slice(0, 5) ?? '08:00')
  const [period, setPeriod] = useState<Period>(schedule?.period ?? 'morning')
  const [periodTouched, setPeriodTouched] = useState(!!schedule)
  const [days, setDays] = useState<number[]>(schedule?.days_of_week ?? [1, 2, 3, 4, 5, 6, 7])
  const [active, setActive] = useState(schedule?.is_active ?? true)
  const [medicineId, setMedicineId] = useState<number | ''>(schedule?.medicine_id ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setPid(schedule?.patient_id ?? patientId)
    setTime(schedule?.time_of_day.slice(0, 5) ?? '08:00')
    setPeriod(schedule?.period ?? 'morning')
    setPeriodTouched(!!schedule)
    setDays(schedule?.days_of_week ?? [1, 2, 3, 4, 5, 6, 7])
    setActive(schedule?.is_active ?? true)
    setMedicineId(schedule?.medicine_id ?? '')
    setConfirmDelete(false)
  }, [open, schedule, patientId])
  useEffect(() => {
    if (!schedule && medicineId === '' && medicines.length === 1) setMedicineId(medicines[0].id)
  }, [medicines, medicineId, schedule])

  const selected = medicines.find((m) => m.id === medicineId)
  const save = useSave(
    (body: ScheduleInput) =>
      schedule ? put<Schedule>(`/schedules/${schedule.id}`, body) : post<Schedule>(`/patients/${pid}/schedules`, body),
    {
      invalidate: [['schedules'], ['medicines'], ['patients'], ['doses']],
      onSuccess: (s) => {
        toast({
          tone: 'ok',
          title: schedule ? 'Schedule updated' : 'Schedule created',
          body: `${s.medicine_name} at ${s.time_of_day.slice(0, 5)} for ${s.patient_name}`,
        })
        onClose()
      },
    },
  )
  const remove = useSave(() => del(`/schedules/${schedule!.id}`), {
    invalidate: [['schedules'], ['medicines'], ['doses']],
    onSuccess: () => {
      toast({ tone: 'ok', title: 'Schedule deleted' })
      onClose()
    },
  })

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    if (!days.length) return
    save.mutate({
      medicine_id: Number(medicineId),
      dose_quantity: blank(f.get('dose_quantity')),
      time_of_day: time,
      period,
      days_of_week: days,
      start_date: blank(f.get('start_date')),
      end_date: blank(f.get('end_date')),
      is_active: active,
    })
  }
  const patientTz = patients.find((p) => p.id === pid)?.timezone
  const toggleDay = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()))

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={schedule ? 'Edit schedule' : 'New schedule'}
      description={patientTz ? `Times are in the patient's timezone (${patientTz}).` : 'When should this medicine be taken?'}
      footer={
        <>
          {schedule &&
            (confirmDelete ? (
              <Button
                variant="danger"
                icon={TrashIcon}
                loading={remove.isPending}
                onClick={() => remove.mutate(undefined)}
                className="mr-auto"
              >
                Confirm delete
              </Button>
            ) : (
              <Button variant="ghost" icon={TrashIcon} onClick={() => setConfirmDelete(true)} className="mr-auto text-bad-ink">
                Delete
              </Button>
            ))}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="schedule-form" loading={save.isPending} disabled={!medicineId || !days.length}>
            {schedule ? 'Save changes' : 'Create schedule'}
          </Button>
        </>
      }
    >
      <form id="schedule-form" onSubmit={submit} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormAlert message={save.formError ?? remove.formError} />
        </div>
        {!schedule && !patientId && (
          <Field label="Patient">
            {(p) => (
              <Select {...p} value={pid ?? ''} onChange={(e) => (setPid(Number(e.target.value)), setMedicineId(''))} required>
                <option value="" disabled>
                  Choose a patient
                </option>
                {patients.map((pt) => (
                  <option key={pt.id} value={pt.id}>
                    {pt.full_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Medicine" error={save.fields.medicine_id} className={!schedule && !patientId ? '' : 'sm:col-span-2'}>
          {(p) => (
            <Select {...p} value={medicineId} onChange={(e) => setMedicineId(Number(e.target.value))} required disabled={!pid}>
              <option value="" disabled>
                {pid ? (medicines.length ? 'Choose a medicine' : 'No medicines yet') : 'Choose a patient first'}
              </option>
              {medicines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {pid && medicines.length === 0 && (
          <p className="text-sm text-ink-2 sm:col-span-2">
            This patient has no medicines yet.{' '}
            <Link to={`/patients/${pid}?tab=medicines`} className="font-medium link" onClick={onClose}>
              Add a medicine first
            </Link>
            .
          </p>
        )}
        <Field label="Time" error={save.fields.time_of_day}>
          {(p) => (
            <Input
              {...p}
              type="time"
              value={time}
              required
              onChange={(e) => {
                setTime(e.target.value)
                if (!periodTouched && e.target.value) setPeriod(suggestPeriod(e.target.value))
              }}
              className="text-lg font-semibold tabular"
            />
          )}
        </Field>
        <Field label="Dose" hint={selected ? `Unit: ${selected.dose_unit}` : undefined} error={save.fields.dose_quantity}>
          {(p) => (
            <Input
              {...p}
              key={`${selected?.id}-${schedule?.id}`}
              name="dose_quantity"
              type="number"
              min="0.25"
              max="1000"
              step="0.25"
              defaultValue={schedule ? Number(schedule.dose_quantity) : selected ? Number(selected.dose_quantity) : 1}
            />
          )}
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium">Part of day</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PERIODS.map((p) => (
              <label
                key={p}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-[15px] font-medium transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40',
                  period === p ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line-strong hover:bg-surface-2',
                )}
              >
                <input
                  type="radio"
                  name="period"
                  value={p}
                  checked={period === p}
                  onChange={() => (setPeriod(p), setPeriodTouched(true))}
                  className="sr-only"
                />
                <PeriodIcon period={p} />
                {PERIOD_LABEL[p]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium">Days</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => (
              <button
                key={d.value}
                type="button"
                aria-pressed={days.includes(d.value)}
                onClick={() => toggleDay(d.value)}
                className={cn(
                  'inline-flex h-10 min-w-12 items-center justify-center gap-1 rounded-lg border px-3 text-sm font-medium transition',
                  days.includes(d.value) ? 'border-brand bg-brand text-on-brand' : 'border-line-strong text-ink-2 hover:bg-surface-2',
                )}
              >
                {days.includes(d.value) && <CheckIcon className="size-3.5" weight="bold" aria-hidden />}
                {d.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-3 text-sm">
            <button type="button" className="font-medium link" onClick={() => setDays([1, 2, 3, 4, 5, 6, 7])}>
              Every day
            </button>
            <button type="button" className="font-medium link" onClick={() => setDays([1, 2, 3, 4, 5])}>
              Weekdays
            </button>
            <button type="button" className="font-medium link" onClick={() => setDays([6, 7])}>
              Weekends
            </button>
          </div>
          {!days.length && <p className="mt-1 text-[13px] font-medium text-bad-ink">Choose at least one day.</p>}
        </fieldset>
        <Field label="Start date" error={save.fields.start_date}>
          {(p) => (
            <Input {...p} name="start_date" type="date" defaultValue={schedule?.start_date ?? (patientTz ? todayIn(patientTz) : '')} />
          )}
        </Field>
        <Field label="End date" optional hint="Leave empty to continue indefinitely." error={save.fields.end_date}>
          {(p) => <Input {...p} name="end_date" type="date" defaultValue={schedule?.end_date ?? ''} />}
        </Field>
        <div className="sm:col-span-2">
          <Switch checked={active} onChange={setActive} label="Active" description="Paused schedules create no doses or alerts." />
        </div>
      </form>
    </Dialog>
  )
}

/* ---------------- Device ---------------- */

export function DeviceKeyReveal({ result, onDone }: { result: DeviceKeyOut; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-lg bg-warn-soft p-3 text-sm text-warn-ink">
        <KeyIcon className="mt-0.5 size-5 shrink-0" weight="fill" aria-hidden />
        <p>
          This key is shown <b>only once</b>. Store it on the dispenser (or in the simulator). Only a secure hash is kept on the server. You
          can generate a new key later, which disables this one.
        </p>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium">Device key for {result.device.device_uid}</p>
        <div className="flex gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm">
            {result.device_key}
          </code>
          <Button
            variant="secondary"
            icon={copied ? CheckIcon : CopyIcon}
            onClick={async () => {
              await navigator.clipboard?.writeText(result.device_key)
              setCopied(true)
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
      <Button onClick={onDone} className="self-end">
        Done
      </Button>
    </div>
  )
}

export function DeviceDialog({ open, onClose, defaultPatientId }: { open: boolean; onClose: () => void; defaultPatientId?: number }) {
  const patients = usePatients().data ?? []
  const [result, setResult] = useState<DeviceKeyOut | null>(null)
  useEffect(() => {
    if (open) setResult(null)
  }, [open])
  const save = useSave(
    (body: { device_uid: string; name: string | null; patient_id: number | null }) => post<DeviceKeyOut>('/devices', body),
    {
      invalidate: [['devices'], ['patients']],
      onSuccess: setResult,
    },
  )
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    save.mutate({
      device_uid: String(f.get('device_uid')).trim().toUpperCase(),
      name: blank(f.get('name')),
      patient_id: f.get('patient_id') ? Number(f.get('patient_id')) : null,
    })
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={result ? 'Device registered' : 'Register a dispenser'}
      description={result ? undefined : 'Use the ID printed on the device label.'}
      footer={
        result ? undefined : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="device-form" loading={save.isPending}>
              Register device
            </Button>
          </>
        )
      }
    >
      {result ? (
        <DeviceKeyReveal result={result} onDone={onClose} />
      ) : (
        <form id="device-form" onSubmit={submit} className="flex flex-col gap-4">
          <FormAlert message={save.formError} />
          <Field label="Device ID" hint="Capital letters, numbers and dashes, for example MED-001." error={save.fields.device_uid}>
            {(p) => (
              <Input
                {...p}
                name="device_uid"
                required
                pattern="[A-Za-z0-9][A-Za-z0-9-]{2,31}"
                placeholder="MED-001"
                className="font-mono uppercase"
                autoComplete="off"
              />
            )}
          </Field>
          <Field label="Name" optional hint="Where it is, for example Living room." error={save.fields.name}>
            {(p) => <Input {...p} name="name" maxLength={80} autoComplete="off" />}
          </Field>
          <Field label="Assign to patient" optional>
            {(p) => (
              <Select {...p} name="patient_id" defaultValue={defaultPatientId ?? ''}>
                <option value="">Not assigned yet</option>
                {patients.map((pt) => (
                  <option key={pt.id} value={pt.id}>
                    {pt.full_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </form>
      )}
    </Dialog>
  )
}

export function DeviceEditDialog({ open, onClose, device }: { open: boolean; onClose: () => void; device: Device }) {
  const patients = usePatients().data ?? []
  const toast = useToast()
  const [active, setActive] = useState(device.is_active)
  useEffect(() => setActive(device.is_active), [device, open])
  const save = useSave(
    (body: { name: string | null; patient_id: number | null; is_active: boolean }) => put<Device>(`/devices/${device.device_uid}`, body),
    {
      invalidate: [['devices'], ['device'], ['patients']],
      onSuccess: () => {
        toast({ tone: 'ok', title: 'Device updated' })
        onClose()
      },
    },
  )
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    save.mutate({ name: blank(f.get('name')), patient_id: f.get('patient_id') ? Number(f.get('patient_id')) : null, is_active: active })
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Edit ${device.device_uid}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="device-edit-form" loading={save.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="device-edit-form" onSubmit={submit} className="flex flex-col gap-4">
        <FormAlert message={save.formError} />
        <Field label="Name" optional error={save.fields.name}>
          {(p) => <Input {...p} name="name" defaultValue={device.name ?? ''} maxLength={80} />}
        </Field>
        <Field label="Assigned patient">
          {(p) => (
            <Select {...p} name="patient_id" defaultValue={device.patient?.id ?? ''}>
              <option value="">Not assigned</option>
              {patients.map((pt) => (
                <option key={pt.id} value={pt.id}>
                  {pt.full_name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Switch checked={active} onChange={setActive} label="Active" description="Deactivated devices are refused by the server." />
      </form>
    </Dialog>
  )
}
