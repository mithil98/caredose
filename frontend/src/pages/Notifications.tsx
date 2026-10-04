import { BellIcon, ChecksIcon } from '@phosphor-icons/react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { NotificationItem } from '../components/feeds'
import { Pager } from '../components/history'
import { Button, EmptyState, ErrorState, LoadingBlock, PageHeader, Panel, Tabs, useNow, useTab } from '../components/ui'
import { get, post } from '../lib/api'
import type { NotificationPage } from '../types/api'

export default function Notifications() {
  const [tab, setTab] = useTab(['all', 'unread'] as const, 'all')
  const [page, setPage] = useState(1)
  const now = useNow()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['notifications', 'list', tab, page],
    queryFn: () => get<NotificationPage>('/notifications', { unread_only: tab === 'unread', page, page_size: 20 }),
    placeholderData: keepPreviousData,
  })
  const readAll = useMutation({
    mutationFn: () => post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const unread = q.data?.unread ?? 0

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Every alert sent to you. Select one to open the related patient or device."
        actions={
          <Button variant="secondary" icon={ChecksIcon} disabled={!unread} loading={readAll.isPending} onClick={() => readAll.mutate()}>
            Mark all as read
          </Button>
        }
      />
      <Tabs
        label="Filter notifications"
        value={tab}
        onChange={(t) => (setTab(t), setPage(1))}
        tabs={[
          { id: 'all', label: 'All' },
          { id: 'unread', label: 'Unread', count: unread },
        ]}
      />
      <Panel bodyClass="px-2 sm:px-3 pb-0 pt-2">
        {q.isPending ? (
          <div className="p-2">
            <LoadingBlock rows={5} />
          </div>
        ) : q.error ? (
          <div className="p-2">
            <ErrorState error={q.error} onRetry={q.refetch} />
          </div>
        ) : !q.data.items.length ? (
          <EmptyState icon={BellIcon} title={tab === 'unread' ? 'You are all caught up' : 'No notifications yet'}>
            {tab === 'unread' ? 'There are no unread alerts.' : 'Alerts about doses and dispensers will appear here.'}
          </EmptyState>
        ) : (
          <>
            <ul className="flex flex-col pb-2">
              {q.data.items.map((n) => (
                <NotificationItem key={n.id} n={n} now={now} />
              ))}
            </ul>
            {q.data.total > 20 && (
              <div className="-mx-2 sm:-mx-3">
                <Pager page={page} pageSize={20} total={q.data.total} onPage={setPage} />
              </div>
            )}
          </>
        )}
      </Panel>
    </>
  )
}
