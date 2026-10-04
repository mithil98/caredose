import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Pager } from '../../components/history'
import { ErrorState, Field, LoadingBlock, PageHeader, Panel, Select } from '../../components/ui'
import { get } from '../../lib/api'
import { fmtDateTime } from '../../lib/format'
import type { AuditEntry, Page } from '../../types/api'

const FILTERS = [
  ['', 'All actions'],
  ['auth', 'Sign-ins'],
  ['user', 'Accounts'],
  ['patient', 'Patients'],
  ['medicine', 'Medicines'],
  ['schedule', 'Schedules'],
  ['device', 'Devices'],
  ['dose', 'Manual dose changes'],
  ['push', 'Push subscriptions'],
  ['config', 'Configuration'],
] as const

export default function AdminAudit() {
  const [action, setAction] = useState('')
  const [page, setPage] = useState(1)
  const q = useQuery({
    queryKey: ['admin', 'audit', action, page],
    queryFn: () => get<Page<AuditEntry>>('/admin/audit-logs', { action, page, page_size: 50 }),
    placeholderData: keepPreviousData,
  })
  return (
    <>
      <PageHeader title="Audit log" description="Who changed what, and when. Patient details are never written here." />
      <div className="mb-4 max-w-xs">
        <Field label="Show">
          {(p) => (
            <Select {...p} value={action} onChange={(e) => (setAction(e.target.value), setPage(1))}>
              {FILTERS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Panel bodyClass="px-0 sm:px-0 pb-0 pt-0">
        {q.isPending ? (
          <div className="p-4">
            <LoadingBlock rows={6} />
          </div>
        ) : q.error ? (
          <div className="p-4">
            <ErrorState error={q.error} onRetry={q.refetch} />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[15px]">
                <caption className="sr-only">Audit log</caption>
                <thead className="border-b border-line bg-surface-2/60 text-sm text-ink-3">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">When</th>
                    <th className="px-3 py-2.5 font-medium">Who</th>
                    <th className="px-3 py-2.5 font-medium">Action</th>
                    <th className="px-3 py-2.5 font-medium">Target</th>
                    <th className="px-5 py-2.5 font-medium">From</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {q.data.items.map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap px-5 py-2.5 tabular">{fmtDateTime(a.created_at)}</td>
                      <td className="px-3 py-2.5">{a.actor_email ?? (a.actor_device_id ? `device #${a.actor_device_id}` : 'anonymous')}</td>
                      <td className="px-3 py-2.5 font-mono text-sm">{a.action}</td>
                      <td className="px-3 py-2.5 text-sm text-ink-2">
                        {a.entity_type}
                        {a.entity_id && ` ${a.entity_id}`}
                      </td>
                      <td className="px-5 py-2.5 font-mono text-sm text-ink-3">{a.ip ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!q.data.items.length && <p className="px-5 py-10 text-center text-ink-3">No entries.</p>}
            <Pager page={page} pageSize={50} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  )
}
