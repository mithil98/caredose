import { CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import type { FormEvent, ReactNode } from 'react'
import { Badge, Button, cn, ErrorState, Field, Input, LoadingBlock, PageHeader, Panel, useToast } from '../../components/ui'
import { get, put } from '../../lib/api'
import { fmtRelative } from '../../lib/format'
import { useSave } from '../../lib/queries'
import type { Health, SystemConfig } from '../../types/api'

function Check({ ok, label, detail }: { ok: boolean; label: string; detail?: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      {ok ? (
        <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-ok" weight="fill" aria-hidden />
      ) : (
        <WarningCircleIcon className="mt-0.5 size-5 shrink-0 text-bad" weight="fill" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium">{label}</p>
        {detail && <p className="text-sm text-ink-3">{detail}</p>}
      </div>
      <Badge tone={ok ? 'ok' : 'bad'}>{ok ? 'Healthy' : 'Problem'}</Badge>
    </li>
  )
}

function Count({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <p className="text-sm text-ink-2">{label}</p>
      <p className="text-title font-semibold">{value}</p>
    </div>
  )
}

const CONFIG_FIELDS: { key: keyof SystemConfig; label: string; hint: string }[] = [
  { key: 'missed_dose_timeout_minutes', label: 'Missed-dose timeout', hint: 'Minutes after a dose is due before it counts as missed.' },
  { key: 'late_dose_after_minutes', label: 'Late after', hint: 'Doses confirmed later than this are flagged late.' },
  {
    key: 'device_warning_after_minutes',
    label: 'Device warning after',
    hint: 'Minutes without a heartbeat before a late check-in warning.',
  },
  { key: 'device_offline_after_minutes', label: 'Device offline after', hint: 'Minutes without a heartbeat before the device is offline.' },
]

function ConfigForm({ config }: { config: SystemConfig }) {
  const toast = useToast()
  const save = useSave((body: SystemConfig) => put<SystemConfig>('/admin/config', body), {
    invalidate: [
      ['admin', 'config'],
      ['admin', 'health'],
    ],
    onSuccess: () => toast({ tone: 'ok', title: 'Configuration saved', body: 'The engine uses the new values from its next run.' }),
  })
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    save.mutate(Object.fromEntries(CONFIG_FIELDS.map(({ key }) => [key, Number(f.get(key))])) as unknown as SystemConfig)
  }
  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {save.formError && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm font-medium text-bad-ink sm:col-span-2">
          {save.fields.form ?? save.formError}
        </p>
      )}
      {CONFIG_FIELDS.map((c) => (
        <Field key={c.key} label={`${c.label} (minutes)`} hint={c.hint} error={save.fields[c.key]}>
          {(p) => <Input {...p} name={c.key} type="number" min={1} max={10080} defaultValue={config[c.key]} required className="tabular" />}
        </Field>
      ))}
      <Button type="submit" className="self-start sm:col-span-2" loading={save.isPending}>
        Save configuration
      </Button>
    </form>
  )
}

export default function AdminSystem() {
  const health = useQuery({ queryKey: ['admin', 'health'], queryFn: () => get<Health>('/admin/health'), refetchInterval: 15_000 })
  const config = useQuery({ queryKey: ['admin', 'config'], queryFn: () => get<SystemConfig>('/admin/config') })
  const h = health.data
  return (
    <>
      <PageHeader title="System" description="Health of the monitoring service and engine settings." />
      <div className="stagger grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
        <Panel
          title="Service health"
          action={h && <Badge tone={h.status === 'ok' ? 'ok' : 'bad'}>{h.status === 'ok' ? 'All systems normal' : 'Degraded'}</Badge>}
        >
          {health.error ? (
            <ErrorState error={health.error} onRetry={health.refetch} />
          ) : !h ? (
            <LoadingBlock rows={3} />
          ) : (
            <>
              <ul className="divide-y divide-line">
                <Check ok={h.database} label="Database" />
                <Check
                  ok={h.scheduler_running}
                  label="Dose engine"
                  detail={h.scheduler_last_tick_at ? `Last run ${fmtRelative(h.scheduler_last_tick_at)}` : 'Has not run yet'}
                />
                <Check
                  ok={h.push_configured}
                  label="Web Push (VAPID)"
                  detail={h.push_configured ? `${h.push_subscriptions} browser subscriptions` : 'VAPID keys missing'}
                />
              </ul>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Count label="Users" value={h.users} />
                <Count label="Patients" value={h.patients} />
                <Count label="Live connections" value={h.websocket_connections} />
                <Count label="Events (24h)" value={h.events_24h} />
                <Count label="Alerts (24h)" value={h.notifications_24h} />
                <Count label="Devices" value={Object.values(h.devices).reduce((a, b) => a + b, 0)} />
              </div>
              {Object.keys(h.devices).length > 0 && (
                <p className="mt-3 flex flex-wrap gap-2 text-sm text-ink-2">
                  {Object.entries(h.devices).map(([s, n]) => (
                    <Badge key={s} tone={s === 'online' ? 'ok' : s === 'warning' ? 'warn' : s === 'unregistered' ? 'neutral' : 'bad'}>
                      {n} {s}
                    </Badge>
                  ))}
                </p>
              )}
            </>
          )}
        </Panel>
        <Panel title="Engine configuration" description="Thresholds for missed doses and device connectivity.">
          {config.data ? (
            <ConfigForm config={config.data} />
          ) : config.error ? (
            <ErrorState error={config.error} />
          ) : (
            <LoadingBlock rows={2} />
          )}
        </Panel>
      </div>
      <p className={cn('mt-5 text-sm text-ink-3')}>Changes here are recorded in the audit log.</p>
    </>
  )
}
