import { DownloadSimpleIcon, FunnelIcon } from '@phosphor-icons/react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { EVENT_META, sourceLabel } from '../components/feeds'
import { DoseHistoryList, Pager, type HistoryFilters } from '../components/history'
import {
  Badge,
  Button,
  cn,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Panel,
  Select,
  Tabs,
  useTab,
  useToast,
} from '../components/ui'
import { api, get } from '../lib/api'
import { fmtDateTime } from '../lib/format'
import { useDevices, useMedicines, usePatients } from '../lib/queries'
import type { MedicineEvent, Page } from '../types/api'

const FILTER_KEYS = ['patient_id', 'medicine_id', 'device_uid', 'status', 'date_from', 'date_to'] as const

const STATUSES = [
  ['', 'Any status'],
  ['taken', 'Taken'],
  ['late', 'Taken late'],
  ['missed', 'Missed'],
  ['dispensed', 'Dispensed'],
  ['due', 'Due'],
  ['scheduled', 'Upcoming'],
  ['cancelled', 'Cancelled'],
] as const

function EventLog({ filters }: { filters: HistoryFilters }) {
  const [page, setPage] = useState(1)
  const { patient_id, device_uid, date_from, date_to } = filters
  const q = useQuery({
    queryKey: ['events', 'log', patient_id, device_uid, date_from, date_to, page],
    queryFn: () => get<Page<MedicineEvent>>('/device-events', { patient_id, device_uid, date_from, date_to, page, page_size: 25 }),
    placeholderData: keepPreviousData,
  })
  if (q.isPending)
    return (
      <div className="p-4">
        <LoadingBlock />
      </div>
    )
  if (q.error)
    return (
      <div className="p-4">
        <ErrorState error={q.error} onRetry={q.refetch} />
      </div>
    )
  if (!q.data.total) return <p className="px-5 py-10 text-center text-ink-3">No events recorded for these filters.</p>
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[15px]">
          <caption className="sr-only">Event log</caption>
          <thead className="border-y border-line bg-surface-2/60 text-sm text-ink-3">
            <tr>
              <th className="px-5 py-2.5 font-medium">Time</th>
              <th className="px-3 py-2.5 font-medium">Event</th>
              <th className="px-3 py-2.5 font-medium">Patient / medicine</th>
              <th className="px-3 py-2.5 font-medium">Source</th>
              <th className="px-5 py-2.5 font-medium">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {q.data.items.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-5 py-2.5 tabular">{fmtDateTime(e.event_time)}</td>
                <td className="px-3 py-2.5">{EVENT_META[e.event_type]?.label ?? e.event_type}</td>
                <td className="px-3 py-2.5 text-ink-2">
                  {[e.patient_name, e.medicine_name].filter(Boolean).join(', ') || <span className="text-ink-3">Device only</span>}
                </td>
                <td className="px-3 py-2.5 font-mono text-sm text-ink-2">{sourceLabel(e)}</td>
                <td className="px-5 py-2.5">
                  <Badge tone={e.result === 'applied' ? 'ok' : 'warn'}>{e.result}</Badge>
                  {e.detail && <span className="block text-[13px] text-ink-3">{e.detail}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pageSize={25} total={q.data.total} onPage={setPage} />
    </>
  )
}

export default function History() {
  const [tab, setTab] = useTab(['doses', 'events'] as const, 'doses')
  const [params, setParams] = useSearchParams()
  const filters: HistoryFilters = Object.fromEntries(FILTER_KEYS.flatMap((k) => (params.get(k) ? [[k, params.get(k)!]] : [])))
  const patients = usePatients().data ?? []
  const medicines = useMedicines(filters.patient_id ? Number(filters.patient_id) : undefined).data ?? []
  const devices = useDevices().data ?? []
  const toast = useToast()
  const [exporting, setExporting] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const activeCount = Object.values(filters).filter(Boolean).length
  // Filters live in the URL so a filtered view can be shared or revisited.
  const set = (k: keyof HistoryFilters, v: string) =>
    setParams(
      (p) => {
        if (v) p.set(k, v)
        else p.delete(k)
        if (k === 'patient_id') p.delete('medicine_id')
        return p
      },
      { replace: true },
    )

  async function exportCsv() {
    setExporting(true)
    try {
      const res = await api<Response>('/doses/export.csv', { query: filters, raw: true })
      const url = URL.createObjectURL(await res.blob())
      const a = Object.assign(document.createElement('a'), { href: url, download: 'medicine-history.csv' })
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast({ tone: 'bad', title: 'Export failed', body: (e as Error).message })
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="History"
        description="Every scheduled dose and what happened to it."
        actions={
          <Button variant="secondary" icon={DownloadSimpleIcon} loading={exporting} onClick={exportCsv}>
            Export CSV
          </Button>
        }
      />
      <Button
        variant="secondary"
        icon={FunnelIcon}
        className="mb-4 md:hidden"
        aria-expanded={showFilters}
        aria-controls="history-filters"
        onClick={() => setShowFilters((v) => !v)}
      >
        {showFilters ? 'Hide filters' : 'Filters'}
        {activeCount > 0 && <span className="rounded-2xl bg-brand px-1.5 text-xs leading-5 text-on-brand tabular">{activeCount}</span>}
      </Button>
      <form
        id="history-filters"
        aria-label="Filters"
        className={cn('mb-5 grid-cols-2 gap-3 md:grid md:grid-cols-3 xl:grid-cols-6', showFilters ? 'grid' : 'hidden')}
        onSubmit={(e) => e.preventDefault()}
      >
        <Field label="Patient">
          {(p) => (
            <Select {...p} value={filters.patient_id ?? ''} onChange={(e) => set('patient_id', e.target.value)}>
              <option value="">All</option>
              {patients.map((pt) => (
                <option key={pt.id} value={pt.id}>
                  {pt.full_name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Medicine">
          {(p) => (
            <Select
              {...p}
              value={filters.medicine_id ?? ''}
              onChange={(e) => set('medicine_id', e.target.value)}
              disabled={tab === 'events'}
            >
              <option value="">All</option>
              {medicines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {filters.patient_id ? '' : ` (${m.patient_name})`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Status">
          {(p) => (
            <Select {...p} value={filters.status ?? ''} onChange={(e) => set('status', e.target.value)} disabled={tab === 'events'}>
              {STATUSES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Device">
          {(p) => (
            <Select {...p} value={filters.device_uid ?? ''} onChange={(e) => set('device_uid', e.target.value)}>
              <option value="">All</option>
              {devices.map((d) => (
                <option key={d.id} value={d.device_uid}>
                  {d.device_uid}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="From">
          {(p) => <Input {...p} type="date" value={String(filters.date_from ?? '')} onChange={(e) => set('date_from', e.target.value)} />}
        </Field>
        <Field label="To">
          {(p) => <Input {...p} type="date" value={String(filters.date_to ?? '')} onChange={(e) => set('date_to', e.target.value)} />}
        </Field>
      </form>
      <Tabs
        label="History views"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'doses', label: 'Doses' },
          { id: 'events', label: 'Event log' },
        ]}
      />
      <Panel bodyClass="px-0 sm:px-0 pb-0 pt-0">
        {tab === 'doses' ? <DoseHistoryList filters={filters} /> : <EventLog filters={filters} />}
      </Panel>
    </>
  )
}
