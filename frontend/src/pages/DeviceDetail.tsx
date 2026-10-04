import { KeyIcon, PencilSimpleIcon, TrashIcon } from '@phosphor-icons/react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ActivityFeed } from '../components/feeds'
import { DeviceEditDialog, DeviceKeyReveal } from '../components/forms'
import { Pager } from '../components/history'
import { DEVICE_META } from '../components/status'
import { Button, cn, Dialog, ErrorState, LoadingBlock, PageHeader, Panel, TONE_SOFT, TONE_TEXT, useNow, useToast } from '../components/ui'
import { del, get, post } from '../lib/api'
import { fmtDateTime, fmtRelative } from '../lib/format'
import { useSave } from '../lib/queries'
import type { Device, DeviceKeyOut, MedicineEvent, Page } from '../types/api'

function signal(csq: number | null) {
  if (csq === null || csq === 99) return 'Unknown'
  if (csq >= 20) return `Excellent (${csq})`
  if (csq >= 15) return `Good (${csq})`
  if (csq >= 10) return `Fair (${csq})`
  return `Weak (${csq})`
}

export default function DeviceDetail() {
  const uid = useParams().uid!.toUpperCase()
  const navigate = useNavigate()
  const toast = useToast()
  const now = useNow(5000)
  const [dialog, setDialog] = useState<null | 'edit' | 'key' | 'delete'>(null)
  const [newKey, setNewKey] = useState<DeviceKeyOut | null>(null)
  const [page, setPage] = useState(1)
  const deviceQ = useQuery({ queryKey: ['device', uid], queryFn: () => get<Device>(`/devices/${uid}`) })
  const eventsQ = useQuery({
    queryKey: ['events', 'device', uid, page],
    queryFn: () => get<Page<MedicineEvent>>('/device-events', { device_uid: uid, page, page_size: 15 }),
    placeholderData: keepPreviousData,
  })
  const rotate = useSave(() => post<DeviceKeyOut>(`/devices/${uid}/rotate-key`), { invalidate: [['device']], onSuccess: setNewKey })
  const remove = useSave(() => del(`/devices/${uid}`), {
    invalidate: [['devices'], ['patients']],
    onSuccess: () => {
      toast({ tone: 'ok', title: `${uid} removed` })
      navigate('/devices')
    },
  })

  if (deviceQ.isPending) return <LoadingBlock rows={4} label="Loading device" />
  if (deviceQ.error) return <ErrorState error={deviceQ.error} onRetry={deviceQ.refetch} />
  const d = deviceQ.data
  const m = DEVICE_META[d.status]

  return (
    <>
      <PageHeader
        back={{ to: '/devices', label: 'All devices' }}
        title={<span className="font-mono">{d.device_uid}</span>}
        description={d.name ?? 'Unnamed device'}
        actions={
          <>
            <Button variant="secondary" icon={PencilSimpleIcon} onClick={() => setDialog('edit')}>
              Edit
            </Button>
            <Button variant="secondary" icon={KeyIcon} onClick={() => (setNewKey(null), setDialog('key'))}>
              New device key
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-start">
        <div className="flex flex-col gap-5">
          <section aria-label="Connection status" className={cn('flex items-center gap-4 rounded-xl p-5', TONE_SOFT[m.tone])}>
            <span className={cn('inline-flex size-14 shrink-0 items-center justify-center rounded-2xl bg-surface', TONE_TEXT[m.tone])}>
              <m.icon className="size-7" weight="bold" aria-hidden />
            </span>
            <div>
              <p className="text-xl font-semibold text-ink">{m.label}</p>
              <p className="text-sm text-ink-2">{m.hint}</p>
              <p className="mt-1 text-sm text-ink-2">
                Last seen <b className="font-semibold text-ink">{d.last_seen_at ? fmtRelative(d.last_seen_at, now) : 'never'}</b>
                {d.last_seen_at && <span className="text-ink-3"> ({fmtDateTime(d.last_seen_at)})</span>}
              </p>
              {d.status === 'error' && d.last_error && <p className="mt-1 text-sm font-medium text-bad-ink">Reported: {d.last_error}</p>}
            </div>
          </section>
          <Panel title="Details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-[15px]">
              <dt className="text-ink-3">Patient</dt>
              <dd>
                {d.patient ? (
                  <Link to={`/patients/${d.patient.id}`} className="font-medium link">
                    {d.patient.full_name}
                  </Link>
                ) : (
                  'Not assigned'
                )}
              </dd>
              <dt className="text-ink-3">Firmware</dt>
              <dd className="font-mono">{d.firmware_version ?? 'Unknown'}</dd>
              <dt className="text-ink-3">Signal</dt>
              <dd>{signal(d.signal_strength)}</dd>
              <dt className="text-ink-3">Registered</dt>
              <dd>{fmtDateTime(d.created_at)}</dd>
              <dt className="text-ink-3">Caretaker</dt>
              <dd>{d.owner.full_name}</dd>
              <dt className="text-ink-3">State</dt>
              <dd>{d.is_active ? 'Active' : 'Deactivated'}</dd>
            </dl>
          </Panel>
          <Panel title="Hardware connection" description="The dispenser (or simulator) talks to these endpoints with its device key.">
            <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[13px] leading-relaxed text-ink-2">
              {`POST /api/v1/devices/${d.device_uid}/heartbeat
POST /api/v1/device-events
GET  /api/v1/devices/${d.device_uid}/config
Header: X-Device-Key: <device key>`}
            </pre>
          </Panel>
          <Button variant="ghost" icon={TrashIcon} className="self-start text-bad-ink" onClick={() => setDialog('delete')}>
            Remove device
          </Button>
        </div>
        <Panel title="Device events" description="Everything this device reported, newest first" bodyClass="px-0 sm:px-0 pb-0">
          {eventsQ.data ? (
            <>
              <div className="px-4 sm:px-5">
                <ActivityFeed events={eventsQ.data.items} now={now} />
              </div>
              {eventsQ.data.total > 15 && <Pager page={page} pageSize={15} total={eventsQ.data.total} onPage={setPage} />}
            </>
          ) : eventsQ.error ? (
            <div className="p-4">
              <ErrorState error={eventsQ.error} onRetry={eventsQ.refetch} />
            </div>
          ) : (
            <div className="p-4">
              <LoadingBlock />
            </div>
          )}
        </Panel>
      </div>

      <DeviceEditDialog open={dialog === 'edit'} onClose={() => setDialog(null)} device={d} />
      <Dialog open={dialog === 'key'} onClose={() => setDialog(null)} title="Generate a new device key">
        {newKey ? (
          <DeviceKeyReveal result={newKey} onDone={() => setDialog(null)} />
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-ink-2">
              The current key stops working immediately. The dispenser must be updated with the new key before it can report again.
            </p>
            <Button className="self-end" icon={KeyIcon} loading={rotate.isPending} onClick={() => rotate.mutate(undefined)}>
              Generate new key
            </Button>
          </div>
        )}
      </Dialog>
      <Dialog
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        title={`Remove ${d.device_uid}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Keep device
            </Button>
            <Button variant="danger" icon={TrashIcon} loading={remove.isPending} onClick={() => remove.mutate(undefined)}>
              Remove device
            </Button>
          </>
        }
      >
        <p className="text-ink-2">The device will no longer be able to report. Past dose history is kept.</p>
      </Dialog>
    </>
  )
}
