import { CaretLeftIcon, CaretRightIcon, ClockCounterClockwiseIcon } from '@phosphor-icons/react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { get } from '../lib/api'
import { fmtLocalDate, fmtQty, fmtTime, PERIOD_LABEL } from '../lib/format'
import type { Dose, Page } from '../types/api'
import { DoseStatusBadge } from './status'
import { cn, EmptyState, ErrorState, IconButton, LoadingBlock } from './ui'

export type HistoryFilters = Partial<
  Record<'patient_id' | 'medicine_id' | 'device_uid' | 'status' | 'date_from' | 'date_to', string | number>
>

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total ? (page - 1) * pageSize + 1 : 0
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-ink-2 sm:px-5"
    >
      <span className="tabular">
        {from}-{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-1">
        <IconButton
          icon={CaretLeftIcon}
          label="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="disabled:opacity-40"
        />
        <span className="px-2 tabular" aria-current="page">
          Page {page} of {pages}
        </span>
        <IconButton
          icon={CaretRightIcon}
          label="Next page"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className="disabled:opacity-40"
        />
      </div>
    </nav>
  )
}

export function DoseHistoryList({ filters, showPatient = true }: { filters: HistoryFilters; showPatient?: boolean }) {
  const [page, setPage] = useState(1)
  const key = JSON.stringify(filters)
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setPage(1)
  }
  const pageSize = 20
  const q = useQuery({
    queryKey: ['doses', 'history', filters, page],
    queryFn: () => get<Page<Dose>>('/doses', { ...filters, page, page_size: pageSize }),
    placeholderData: keepPreviousData,
  })
  if (q.isPending)
    return (
      <div className="p-4">
        <LoadingBlock rows={5} />
      </div>
    )
  if (q.error)
    return (
      <div className="p-4">
        <ErrorState error={q.error} onRetry={q.refetch} />
      </div>
    )
  const { items, total } = q.data
  if (!total)
    return (
      <EmptyState icon={ClockCounterClockwiseIcon} title="No doses match">
        Doses appear here once schedules start running. Try widening the filters.
      </EmptyState>
    )
  return (
    <div className={cn('transition-opacity', q.isPlaceholderData && 'opacity-60')}>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-[15px]">
          <caption className="sr-only">Dose history</caption>
          <thead className="border-y border-line bg-surface-2/60 text-sm text-ink-3">
            <tr>
              <th className="px-5 py-2.5 font-medium">Date</th>
              {showPatient && <th className="px-3 py-2.5 font-medium">Patient</th>}
              <th className="px-3 py-2.5 font-medium">Medicine</th>
              <th className="px-3 py-2.5 text-right font-medium">Scheduled</th>
              <th className="px-3 py-2.5 text-right font-medium">Dispensed</th>
              <th className="px-3 py-2.5 text-right font-medium">Confirmed</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-5 py-2.5 font-medium">Device</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((d) => {
              const tz = d.patient_timezone
              return (
                <tr key={d.id}>
                  <td className="whitespace-nowrap px-5 py-2.5">{fmtLocalDate(d.local_date)}</td>
                  {showPatient && (
                    <td className="px-3 py-2.5">
                      <Link to={`/patients/${d.patient_id}?dose=${d.id}`} className="font-medium hover:link">
                        {d.patient_name}
                      </Link>
                    </td>
                  )}
                  <td className="px-3 py-2.5">
                    {d.medicine_name}
                    <span className="block text-sm text-ink-3">
                      {PERIOD_LABEL[d.period]} · {fmtQty(d.dose_quantity, d.dose_unit)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular">{fmtTime(d.scheduled_for, tz)}</td>
                  <td className="px-3 py-2.5 text-right tabular text-ink-2">
                    {fmtTime(d.dispensed_at, tz) || <span className="text-ink-3">Not recorded</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular text-ink-2">
                    {fmtTime(d.taken_at, tz) || <span className="text-ink-3">Not recorded</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <DoseStatusBadge dose={d} />
                  </td>
                  <td className="px-5 py-2.5 font-mono text-sm text-ink-2">{d.device_uid ?? ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {/* Mobile cards */}
      <ul className="divide-y divide-line border-t border-line md:hidden">
        {items.map((d) => {
          const tz = d.patient_timezone
          return (
            <li key={d.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{d.medicine_name}</p>
                <p className="text-sm text-ink-3">
                  {fmtLocalDate(d.local_date)} at {fmtTime(d.scheduled_for, tz)}
                  {showPatient && ` · ${d.patient_name}`}
                </p>
                {d.taken_at && <p className="text-sm text-ink-2">Confirmed {fmtTime(d.taken_at, tz)}</p>}
              </div>
              <DoseStatusBadge dose={d} />
            </li>
          )
        })}
      </ul>
      <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
    </div>
  )
}
