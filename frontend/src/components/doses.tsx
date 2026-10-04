import { CheckIcon, DotsThreeVerticalIcon, ProhibitIcon } from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { patch } from '../lib/api'
import { fmtQty, fmtTime, PERIOD_LABEL, PERIODS, tzLabel } from '../lib/format'
import type { Dose } from '../types/api'
import { DoseStatusBadge, PeriodIcon } from './status'
import { Button, cn, Dialog, IconButton, useToast } from './ui'

const OPEN = new Set(['scheduled', 'due', 'dispensed'])

export function doseTrail(d: Dose) {
  const tz = d.patient_timezone
  const parts: string[] = []
  if (d.dispensed_at) parts.push(`Dispensed ${fmtTime(d.dispensed_at, tz)}`)
  if (d.taken_at) parts.push(`Confirmed ${fmtTime(d.taken_at, tz)}`)
  if (d.status === 'missed' && d.missed_at) parts.push(`No confirmation by ${fmtTime(d.missed_at, tz)}`)
  if (d.cancelled_at) parts.push(`Cancelled ${fmtTime(d.cancelled_at, tz)}`)
  if (!parts.length && d.status === 'due') parts.push('Waiting for the dispenser')
  return parts.join(' · ')
}

function DoseActions({ dose }: { dose: Dose }) {
  const [open, setOpen] = useState(false)
  const toast = useToast()
  const qc = useQueryClient()
  const update = useMutation({
    mutationFn: (status: 'taken' | 'cancelled') => patch<Dose>(`/doses/${dose.id}`, { status }),
    onSuccess: (d) => {
      setOpen(false)
      toast({
        tone: 'ok',
        title: d.status === 'taken' ? 'Dose confirmed' : 'Dose cancelled',
        body: `${d.medicine_name} for ${d.patient_name}`,
      })
      qc.invalidateQueries()
    },
    onError: (e) => toast({ tone: 'bad', title: 'Could not update dose', body: (e as Error).message }),
  })
  if (!OPEN.has(dose.status) && dose.status !== 'missed') return <span className="hidden w-10 sm:block" />
  return (
    <>
      <IconButton icon={DotsThreeVerticalIcon} label={`Update ${dose.medicine_name} dose`} onClick={() => setOpen(true)} />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Update this dose"
        description={`${dose.medicine_name}, ${fmtQty(dose.dose_quantity, dose.dose_unit)} for ${dose.patient_name} at ${fmtTime(dose.scheduled_for, dose.patient_timezone)}`}
      >
        <p className="text-sm text-ink-2">
          Use this when you confirmed the dose yourself, or when the dose should not be given today. The dispenser normally reports this
          automatically.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button icon={CheckIcon} loading={update.isPending && update.variables === 'taken'} onClick={() => update.mutate('taken')}>
            {dose.status === 'missed' ? 'Mark taken (late)' : 'Mark as taken'}
          </Button>
          {OPEN.has(dose.status) && dose.status !== 'dispensed' && (
            <Button
              variant="secondary"
              icon={ProhibitIcon}
              loading={update.isPending && update.variables === 'cancelled'}
              onClick={() => update.mutate('cancelled')}
            >
              Cancel this dose
            </Button>
          )}
        </div>
      </Dialog>
    </>
  )
}

function DoseRow({ dose, showPatient, highlight }: { dose: Dose; showPatient: boolean; highlight: boolean }) {
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlight])
  const tz = dose.patient_timezone
  const trail = doseTrail(dose)
  const tzHint = tzLabel(tz)
  return (
    <li
      ref={ref}
      id={`dose-${dose.id}`}
      className={cn(
        'grid grid-cols-[4.75rem_minmax(0,1fr)_auto] items-start gap-x-3 rounded-lg px-2 py-3 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto_auto] sm:items-center',
        highlight && 'animate-flash bg-brand-soft',
        dose.status === 'cancelled' && 'opacity-70',
      )}
    >
      <div className="pt-0.5 sm:pt-0">
        <p className="text-[15px] font-semibold text-ink tabular">{fmtTime(dose.scheduled_for, tz)}</p>
        {tzHint && <p className="text-xs text-ink-3">{tzHint} time</p>}
      </div>
      <div className="min-w-0">
        <p className="font-medium text-ink">
          {dose.medicine_name}
          <span className="whitespace-nowrap font-normal text-ink-3"> · {fmtQty(dose.dose_quantity, dose.dose_unit)}</span>
        </p>
        <p className="truncate text-sm text-ink-3">
          {showPatient && (
            <Link to={`/patients/${dose.patient_id}`} className="font-medium text-ink-2 hover:link">
              {dose.patient_name}
            </Link>
          )}
          {showPatient && trail && ' · '}
          {trail}
        </p>
        <div className="mt-2 sm:hidden">
          <DoseStatusBadge dose={dose} />
        </div>
      </div>
      <div className="hidden sm:block">
        <DoseStatusBadge dose={dose} />
      </div>
      <DoseActions dose={dose} />
    </li>
  )
}

/** Today's doses grouped Morning / Afternoon / Evening / Night with a "now" marker. */
export function DoseTimeline({ doses, showPatient = true, highlightId }: { doses: Dose[]; showPatient?: boolean; highlightId?: number }) {
  const now = Date.now()
  const nowIndex = doses.findIndex((d) => new Date(d.scheduled_for).getTime() > now)
  return (
    <div className="flex flex-col gap-5">
      {PERIODS.map((period) => {
        const group = doses.filter((d) => d.period === period)
        if (!group.length) return null
        const done = group.filter((d) => d.status === 'taken').length
        return (
          <section key={period} aria-label={`${PERIOD_LABEL[period]} doses`}>
            <h3 className="mb-1 flex items-center gap-2 px-2 text-sm font-semibold text-ink-2">
              <PeriodIcon period={period} className="text-ink-3" />
              {PERIOD_LABEL[period]}
              <span className="font-normal text-ink-3 tabular">
                {done} of {group.length} taken
              </span>
            </h3>
            <ol className="divide-y divide-line">
              {group.map((d) => (
                <Fragment key={d.id}>
                  {doses.indexOf(d) === nowIndex && nowIndex > 0 && <NowMarker />}
                  <DoseRow dose={d} showPatient={showPatient} highlight={d.id === highlightId} />
                </Fragment>
              ))}
            </ol>
          </section>
        )
      })}
    </div>
  )
}

function NowMarker() {
  return (
    <li aria-label="Current time" className="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-brand">
      <span className="tabular">Now {fmtTime(new Date().toISOString())}</span>
      <span className="h-px flex-1 bg-brand/50" />
    </li>
  )
}
