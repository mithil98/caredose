import { CaretRightIcon, PlusIcon, UsersIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Meter } from '../components/charts'
import { PatientDialog } from '../components/forms'
import { DeviceStatusBadge } from '../components/status'
import { Badge, Button, EmptyState, ErrorState, LoadingBlock, PageHeader, Panel } from '../components/ui'
import { useAuth } from '../lib/auth'
import { ageFrom } from '../lib/format'
import { usePatients } from '../lib/queries'
import type { Patient } from '../types/api'

function TodayCell({ p }: { p: Patient }) {
  if (!p.today.total) return <span className="text-sm text-ink-3">No doses today</span>
  return (
    <div className="flex min-w-36 flex-col gap-1.5">
      <span className="text-sm text-ink-2 tabular">
        {p.today.taken} of {p.today.total} taken
        {p.today.missed > 0 && <span className="font-medium text-bad-ink">, {p.today.missed} missed</span>}
      </span>
      <Meter value={p.today.taken} max={p.today.total} label={`${p.full_name}: doses taken today`} />
    </div>
  )
}

export default function Patients() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(params.get('new') === '1')
  const { data, error, isPending, refetch } = usePatients()
  const close = () => {
    setOpen(false)
    if (params.has('new')) setParams({}, { replace: true })
  }
  const add = (
    <Button icon={PlusIcon} onClick={() => setOpen(true)}>
      Add patient
    </Button>
  )

  return (
    <>
      <PageHeader
        title="Patients"
        description="The people you care for, their dispensers and how today is going."
        actions={data?.length ? add : undefined}
      />
      {isPending ? (
        <LoadingBlock rows={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.length ? (
        <Panel>
          <EmptyState icon={UsersIcon} title="No patients yet" action={add}>
            Add the person you care for to start building their medicine schedule.
          </EmptyState>
        </Panel>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-xl border border-line bg-surface shadow-panel md:block">
            <table className="w-full text-left">
              <thead className="border-b border-line bg-surface-2/60 text-sm text-ink-3">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-3 py-3 font-medium">Dispenser</th>
                  <th className="px-3 py-3 font-medium">Medicines</th>
                  <th className="px-3 py-3 font-medium">Today</th>
                  {user?.role === 'admin' && <th className="px-3 py-3 font-medium">Caretaker</th>}
                  <th className="px-3 py-3">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((p) => {
                  const age = ageFrom(p.date_of_birth)
                  return (
                    <tr key={p.id} className="group relative hover:bg-surface-2/60">
                      <td className="px-5 py-3.5">
                        <Link
                          to={`/patients/${p.id}`}
                          className="font-semibold text-ink after:absolute after:inset-0 group-hover:text-brand"
                        >
                          {p.full_name}
                        </Link>
                        <p className="text-sm text-ink-3">
                          {age !== null ? `${age} years` : 'Age not set'}
                          {!p.is_active && ' · Inactive'}
                        </p>
                      </td>
                      <td className="px-3 py-3.5">
                        {p.devices[0] ? (
                          <div className="flex flex-col items-start gap-1">
                            <span className="font-mono text-sm">{p.devices[0].device_uid}</span>
                            <DeviceStatusBadge status={p.devices[0].status} />
                          </div>
                        ) : (
                          <span className="text-sm text-ink-3">None</span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 tabular">{p.medicine_count}</td>
                      <td className="px-3 py-3.5">
                        <TodayCell p={p} />
                      </td>
                      {user?.role === 'admin' && <td className="px-3 py-3.5 text-sm text-ink-2">{p.caretaker.full_name}</td>}
                      <td className="px-3 py-3.5 text-right">
                        <CaretRightIcon className="ml-auto size-5 text-ink-3" aria-hidden />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="stagger flex flex-col gap-3 md:hidden">
            {data.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/patients/${p.id}`}
                  className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-panel active:bg-surface-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[17px] font-semibold">{p.full_name}</p>
                      <p className="text-sm text-ink-3">
                        {p.medicine_count} medicine{p.medicine_count === 1 ? '' : 's'}
                        {!p.is_active && ' · Inactive'}
                      </p>
                    </div>
                    {p.devices[0] ? <DeviceStatusBadge status={p.devices[0].status} /> : <Badge>No device</Badge>}
                  </div>
                  <TodayCell p={p} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <PatientDialog open={open} onClose={close} />
    </>
  )
}
