import { BellRingingIcon, BellSlashIcon, CheckCircleIcon, InfoIcon, PaperPlaneTiltIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Badge, Button, Callout, Field, Input, LoadingBlock, PageHeader, Panel, Select, Switch, useToast } from '../components/ui'
import { get, put, post } from '../lib/api'
import { useAuth } from '../lib/auth'
import { tzOptions } from '../lib/format'
import { currentPushState, disablePush, enablePush, type PushState } from '../lib/push'
import { useSave } from '../lib/queries'
import type { Preferences, PushStatus, User } from '../types/api'

const PREFS: { key: keyof Preferences; label: string; description: string }[] = [
  { key: 'medicine_due', label: 'Medicine due', description: 'When a scheduled dose becomes due.' },
  { key: 'medicine_dispensed', label: 'Medicine dispensed', description: 'When the dispenser releases a dose.' },
  { key: 'medicine_taken', label: 'Medicine taken', description: 'When pickup of a dose is confirmed.' },
  { key: 'medicine_missed', label: 'Medicine missed', description: 'When a dose is not confirmed in time.' },
  { key: 'device_offline', label: 'Device offline', description: 'When a dispenser stops checking in.' },
  { key: 'device_online', label: 'Device restored', description: 'When an offline dispenser reconnects.' },
  { key: 'device_error', label: 'Device problem', description: 'When a dispenser reports an error.' },
]

function PushPanel() {
  const toast = useToast()
  const qc = useQueryClient()
  const state = useQuery({ queryKey: ['push-state'], queryFn: currentPushState })
  const server = useQuery({ queryKey: ['push-status'], queryFn: () => get<PushStatus>('/notifications/push-status') })
  const [busy, setBusy] = useState(false)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['push-state'] })
    qc.invalidateQueries({ queryKey: ['push-status'] })
  }
  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast({ tone: 'ok', title: ok })
    } catch (e) {
      toast({ tone: 'bad', title: 'Something went wrong', body: (e as Error).message })
    } finally {
      setBusy(false)
      refresh()
    }
  }
  const test = useMutation({
    mutationFn: () => post<{ sent: number; failed: number; errors: string[] }>('/notifications/test'),
    onSuccess: (r) =>
      toast(
        r.sent
          ? { tone: 'ok', title: `Test sent to ${r.sent} device${r.sent > 1 ? 's' : ''}`, body: 'It should appear within a few seconds.' }
          : { tone: 'bad', title: 'Test could not be delivered', body: r.errors.join('\n') },
      ),
    onError: (e) => toast({ tone: 'bad', title: 'Test failed', body: (e as Error).message }),
  })

  const s: PushState | undefined = state.data
  return (
    <Panel
      title="Alerts on this device"
      description="Push notifications reach you even when CareDose is closed, as long as the browser is allowed to show them."
      action={
        s === 'enabled' ? (
          <Badge tone="ok" icon={CheckCircleIcon}>
            On
          </Badge>
        ) : s ? (
          <Badge>Off</Badge>
        ) : undefined
      }
    >
      {state.isPending ? (
        <LoadingBlock rows={1} />
      ) : (
        <div className="flex flex-col gap-4">
          {server.data && !server.data.configured && (
            <Callout tone="bad" icon={WarningCircleIcon} title="Push is not configured on the server">
              An administrator needs to set the VAPID keys. In-app alerts still work.
            </Callout>
          )}
          {s === 'insecure' && (
            <Callout tone="warn" icon={InfoIcon} title="A secure connection is required">
              Push notifications only work over HTTPS (or on localhost during development).
            </Callout>
          )}
          {s === 'unsupported' && (
            <Callout tone="warn" icon={InfoIcon} title="This browser cannot receive push notifications">
              Try a current version of Chrome, Edge or Firefox. On iPhone and iPad, first use Share, then Add to Home Screen, and open
              CareDose from there.
            </Callout>
          )}
          {s === 'denied' && (
            <Callout tone="bad" icon={BellSlashIcon} title="Notifications are blocked for this site">
              <ol className="mt-1 list-decimal pl-5">
                <li>Select the icon to the left of the address bar.</li>
                <li>Set Notifications to Allow.</li>
                <li>Reload this page and select Turn on alerts.</li>
              </ol>
            </Callout>
          )}
          <div className="flex flex-wrap gap-2">
            {(s === 'disabled' || s === 'denied') && (
              <Button
                icon={BellRingingIcon}
                loading={busy}
                disabled={s === 'denied'}
                onClick={() => run(enablePush, 'Alerts turned on for this device')}
              >
                Turn on alerts
              </Button>
            )}
            {s === 'enabled' && (
              <>
                <Button icon={PaperPlaneTiltIcon} loading={test.isPending} onClick={() => test.mutate()}>
                  Send test notification
                </Button>
                <Button
                  variant="secondary"
                  icon={BellSlashIcon}
                  loading={busy}
                  onClick={() => run(disablePush, 'Alerts turned off for this device')}
                >
                  Turn off on this device
                </Button>
              </>
            )}
          </div>
          {server.data && (
            <p className="text-sm text-ink-3">
              {server.data.subscriptions === 0
                ? 'No browsers are registered for your alerts yet.'
                : `${server.data.subscriptions} browser${server.data.subscriptions > 1 ? 's are' : ' is'} registered for your alerts.`}
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}

function PreferencesPanel() {
  const toast = useToast()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['preferences'], queryFn: () => get<Preferences>('/notifications/preferences') })
  const save = useMutation({
    mutationFn: (p: Preferences) => put<Preferences>('/notifications/preferences', p),
    onMutate: (p) => qc.setQueryData(['preferences'], p),
    onError: (e) => {
      toast({ tone: 'bad', title: 'Could not save preference', body: (e as Error).message })
      qc.invalidateQueries({ queryKey: ['preferences'] })
    },
  })
  return (
    <Panel
      title="Which alerts to push"
      description="Everything is still listed in your notification center. These switches only control push alerts."
    >
      {q.data ? (
        <div className="flex flex-col divide-y divide-line">
          {PREFS.map((p) => (
            <div key={p.key} className="py-3 first:pt-0 last:pb-0">
              <Switch
                label={p.label}
                description={p.description}
                checked={q.data[p.key]}
                onChange={(v) => save.mutate({ ...q.data, [p.key]: v })}
              />
            </div>
          ))}
        </div>
      ) : (
        <LoadingBlock rows={3} />
      )}
    </Panel>
  )
}

function ProfilePanel() {
  const { user, setUser } = useAuth()
  const toast = useToast()
  const save = useSave((body: { full_name: string; timezone: string }) => put<User>('/auth/me', body), {
    onSuccess: (u) => {
      setUser(u)
      toast({ tone: 'ok', title: 'Profile saved' })
    },
  })
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    save.mutate({ full_name: String(f.get('full_name')), timezone: String(f.get('timezone')) })
  }
  return (
    <Panel title="Your profile">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Email" hint="Contact an administrator to change it.">
          {(p) => <Input {...p} value={user?.email ?? ''} disabled readOnly />}
        </Field>
        <Field label="Name" error={save.fields.full_name}>
          {(p) => <Input {...p} name="full_name" defaultValue={user?.full_name} required maxLength={120} />}
        </Field>
        <Field label="Your timezone" hint="Used for your greeting and weekly summaries." error={save.fields.timezone}>
          {(p) => (
            <Select {...p} name="timezone" defaultValue={user?.timezone}>
              {tzOptions(user?.timezone).map((tz) => (
                <option key={tz}>{tz}</option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" variant="secondary" className="self-start" loading={save.isPending}>
          Save profile
        </Button>
      </form>
    </Panel>
  )
}

export default function Settings() {
  return (
    <>
      <PageHeader title="Settings" description="Alerts for this device and your account." />
      <div className="stagger grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-5">
          <PushPanel />
          <PreferencesPanel />
        </div>
        <ProfilePanel />
      </div>
    </>
  )
}
