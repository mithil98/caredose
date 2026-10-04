import { CalendarBlankIcon, PlusIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { fmtClock, fmtDays, fmtLocalDate, fmtQty, PERIOD_LABEL, PERIODS } from '../lib/format'
import { useSchedules } from '../lib/queries'
import type { Schedule } from '../types/api'
import { ScheduleDialog } from './forms'
import { PeriodIcon } from './status'
import { Badge, Button, cn, EmptyState, ErrorState, LoadingBlock, Panel } from './ui'

/** Day-planner view: one column per part of the day, each schedule editable in place. */
export function ScheduleBoard({ patientId, showPatient = false }: { patientId?: number; showPatient?: boolean }) {
  const { data, error, isPending, refetch } = useSchedules(patientId)
  const [editing, setEditing] = useState<Schedule | undefined>()
  const [open, setOpen] = useState(false)
  const openNew = () => (setEditing(undefined), setOpen(true))

  if (isPending) return <LoadingBlock rows={3} />
  if (error) return <ErrorState error={error} onRetry={refetch} />

  return (
    <>
      {!data.length ? (
        <Panel>
          <EmptyState
            icon={CalendarBlankIcon}
            title="No schedules yet"
            action={
              <Button icon={PlusIcon} onClick={openNew}>
                Create schedule
              </Button>
            }
          >
            A schedule says which medicine to take, how much, and at what time of day.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <div className="mb-4 flex justify-end">
            <Button icon={PlusIcon} onClick={openNew}>
              New schedule
            </Button>
          </div>
          <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {PERIODS.map((period) => {
              const items = data.filter((s) => s.period === period)
              return (
                <section
                  key={period}
                  aria-labelledby={`col-${period}`}
                  className="flex flex-col rounded-xl border border-line bg-surface shadow-panel"
                >
                  <h2 id={`col-${period}`} className="flex items-center gap-2 border-b border-line px-4 py-3 font-semibold">
                    <PeriodIcon period={period} className="text-brand" />
                    {PERIOD_LABEL[period]}
                    <span className="ml-auto text-sm font-normal text-ink-3 tabular">{items.length}</span>
                  </h2>
                  <ul className="flex flex-1 flex-col gap-2 p-3">
                    {items.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => (setEditing(s), setOpen(true))}
                          aria-label={`Edit ${s.medicine_name} at ${fmtClock(s.time_of_day)}`}
                          className={cn(
                            'flex w-full flex-col gap-1 rounded-lg border border-line p-3 text-left transition hover:border-brand hover:bg-brand-soft/40',
                            !s.is_active && 'border-dashed opacity-70',
                          )}
                        >
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="text-lg font-semibold tracking-tight tabular">{fmtClock(s.time_of_day)}</span>
                            {!s.is_active && <Badge>Paused</Badge>}
                          </span>
                          <span className="font-medium text-ink">{s.medicine_name}</span>
                          <span className="text-sm text-ink-2">
                            {fmtQty(s.dose_quantity, s.dose_unit)} · {fmtDays(s.days_of_week)}
                          </span>
                          {showPatient && <span className="text-sm text-ink-3">{s.patient_name}</span>}
                          {s.end_date && <span className="text-[13px] text-ink-3">Until {fmtLocalDate(s.end_date)}</span>}
                        </button>
                      </li>
                    ))}
                    {!items.length && <li className="px-1 py-4 text-center text-sm text-ink-3">Nothing in the {period}.</li>}
                  </ul>
                </section>
              )
            })}
          </div>
        </>
      )}
      <ScheduleDialog open={open} onClose={() => setOpen(false)} schedule={editing} patientId={patientId} />
    </>
  )
}
