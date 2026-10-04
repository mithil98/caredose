import { PencilSimpleIcon, PillIcon, PlusIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Link } from 'react-router'
import { MedicineDialog } from '../components/forms'
import { Badge, Button, EmptyState, ErrorState, Field, LoadingBlock, PageHeader, Panel, Select } from '../components/ui'
import { fmtQty } from '../lib/format'
import { useMedicines, usePatients } from '../lib/queries'
import type { Medicine } from '../types/api'

export default function Medicines() {
  const [patientId, setPatientId] = useState<number | undefined>()
  const patients = usePatients().data ?? []
  const { data, error, isPending, refetch } = useMedicines(patientId)
  const [editing, setEditing] = useState<Medicine | undefined>()
  const [open, setOpen] = useState(false)
  const groups = new Map<string, Medicine[]>()
  for (const m of data ?? [])
    groups.set(`${m.patient_id}|${m.patient_name}`, [...(groups.get(`${m.patient_id}|${m.patient_name}`) ?? []), m])

  const addButton = (
    <Button icon={PlusIcon} onClick={() => (setEditing(undefined), setOpen(true))} disabled={!patients.length}>
      Add medicine
    </Button>
  )

  return (
    <>
      <PageHeader
        title="Medicines"
        description="Medicines as prescribed for each person. Times are set on the Schedules page."
        actions={addButton}
      />
      {patients.length > 1 && (
        <div className="mb-4 max-w-xs">
          <Field label="Patient">
            {(p) => (
              <Select {...p} value={patientId ?? ''} onChange={(e) => setPatientId(e.target.value ? Number(e.target.value) : undefined)}>
                <option value="">All patients</option>
                {patients.map((pt) => (
                  <option key={pt.id} value={pt.id}>
                    {pt.full_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      )}
      {isPending ? (
        <LoadingBlock rows={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.length ? (
        <Panel>
          <EmptyState
            icon={PillIcon}
            title={patients.length ? 'No medicines yet' : 'Add a patient first'}
            action={
              patients.length ? (
                addButton
              ) : (
                <Link to="/patients?new=1" className="font-medium link">
                  Add a patient
                </Link>
              )
            }
          >
            {patients.length ? 'Add each medicine with its dose and instructions.' : 'Medicines always belong to a patient.'}
          </EmptyState>
        </Panel>
      ) : (
        <div className="flex flex-col gap-5">
          {[...groups.entries()].map(([key, meds]) => {
            const [pid, name] = key.split('|')
            return (
              <Panel
                key={key}
                title={
                  <Link to={`/patients/${pid}?tab=medicines`} className="hover:link">
                    {name}
                  </Link>
                }
                description={`${meds.length} medicine${meds.length === 1 ? '' : 's'}`}
                bodyClass="px-0 sm:px-0 pb-1"
              >
                <ul className="divide-y divide-line border-t border-line">
                  {meds.map((m) => (
                    <li
                      key={m.id}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] sm:px-5"
                    >
                      <span className="inline-flex size-9 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                        <PillIcon className="size-5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{m.name}</p>
                        <p className="truncate text-sm text-ink-3">{m.generic_name ?? fmtQty(m.dose_quantity, m.dose_unit)}</p>
                      </div>
                      <p className="hidden text-sm text-ink-2 sm:block">
                        {fmtQty(m.dose_quantity, m.dose_unit)}
                        {m.instructions && <span className="block truncate text-ink-3">{m.instructions}</span>}
                      </p>
                      <span className="hidden sm:block">
                        {m.is_active ? (
                          <Badge tone={m.schedule_count ? 'brand' : 'neutral'}>
                            {m.schedule_count ? `${m.schedule_count} schedule${m.schedule_count === 1 ? '' : 's'}` : 'Not scheduled'}
                          </Badge>
                        ) : (
                          <Badge>Inactive</Badge>
                        )}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={PencilSimpleIcon}
                        onClick={() => (setEditing(m), setOpen(true))}
                        aria-label={`Edit ${m.name}`}
                      >
                        <span className="hidden sm:inline">Edit</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </Panel>
            )
          })}
        </div>
      )}
      <MedicineDialog open={open} onClose={() => setOpen(false)} medicine={editing} patientId={editing ? undefined : patientId} />
    </>
  )
}
