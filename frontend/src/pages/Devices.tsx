import { BroadcastIcon, CaretRightIcon, PlusIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Link } from 'react-router'
import { DeviceDialog } from '../components/forms'
import { DEVICE_META, DeviceStatusBadge } from '../components/status'
import { Button, cn, EmptyState, ErrorState, LoadingBlock, PageHeader, Panel, TONE_SOFT, TONE_TEXT, useNow } from '../components/ui'
import { fmtRelative } from '../lib/format'
import { useDevices } from '../lib/queries'

export default function Devices() {
  const { data, error, isPending, refetch } = useDevices()
  const [open, setOpen] = useState(false)
  const now = useNow(5000)
  const add = (
    <Button icon={PlusIcon} onClick={() => setOpen(true)}>
      Register device
    </Button>
  )
  return (
    <>
      <PageHeader
        title="Devices"
        description="Medicine dispensers and whether they are checking in."
        actions={data?.length ? add : undefined}
      />
      {isPending ? (
        <LoadingBlock rows={3} />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.length ? (
        <Panel>
          <EmptyState icon={BroadcastIcon} title="No devices registered" action={add}>
            Register a dispenser to receive its dose events. Without hardware, use the device simulator.
          </EmptyState>
        </Panel>
      ) : (
        <ul className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((d) => {
            const m = DEVICE_META[d.status]
            return (
              <li key={d.id}>
                <Link
                  to={`/devices/${d.device_uid}`}
                  className={cn(
                    'flex h-full flex-col gap-4 rounded-xl border border-line bg-surface p-4 shadow-panel transition hover:border-brand',
                    !d.is_active && 'opacity-70',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        'inline-flex size-11 shrink-0 items-center justify-center rounded-2xl',
                        TONE_SOFT[m.tone],
                        TONE_TEXT[m.tone],
                      )}
                    >
                      <m.icon className="size-6" weight="bold" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-lg font-semibold">{d.device_uid}</p>
                      <p className="truncate text-sm text-ink-3">{d.name ?? 'Unnamed device'}</p>
                    </div>
                    <CaretRightIcon className="size-5 text-ink-3" aria-hidden />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <DeviceStatusBadge status={d.status} />
                    {!d.is_active && <span className="text-sm text-ink-3">Deactivated</span>}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <dt className="text-ink-3">Patient</dt>
                    <dd className="truncate">{d.patient?.full_name ?? 'Not assigned'}</dd>
                    <dt className="text-ink-3">Last seen</dt>
                    <dd>{d.last_seen_at ? fmtRelative(d.last_seen_at, now) : 'Never'}</dd>
                    <dt className="text-ink-3">Firmware</dt>
                    <dd className="font-mono">{d.firmware_version ?? 'Unknown'}</dd>
                  </dl>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      <DeviceDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
