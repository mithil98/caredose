import { BellRingingIcon, XIcon } from '@phosphor-icons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { currentPushState, enablePush } from '../lib/push'
import { Button, IconButton, useToast } from './ui'

const KEY = 'caredose.push-nudge-dismissed'

function dismissed() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** Prompt to turn on push alerts for this browser. Permission is only requested on click. */
export function PushNudge() {
  const state = useQuery({ queryKey: ['push-state'], queryFn: currentPushState }).data
  const [hidden, setHidden] = useState(dismissed)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const qc = useQueryClient()
  if (hidden || (state !== 'disabled' && state !== 'denied')) return null

  const enable = async () => {
    setBusy(true)
    try {
      await enablePush()
      toast({ tone: 'ok', title: 'Alerts turned on', body: 'This device will be notified even when CareDose is closed.' })
      qc.invalidateQueries({ queryKey: ['push-state'] })
    } catch (e) {
      toast({ tone: 'bad', title: 'Could not turn on alerts', body: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-5 flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-panel sm:flex-row sm:items-center">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand">
        <BellRingingIcon className="size-5" weight="fill" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{state === 'denied' ? 'Alerts are blocked in this browser' : 'Get alerts on this device'}</p>
        <p className="text-sm text-ink-2">
          {state === 'denied'
            ? 'Allow notifications for this site in your browser settings so missed doses reach you when CareDose is closed.'
            : 'Be told when a dose is due, missed, or a dispenser goes offline, even when this page is closed.'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {state === 'denied' ? (
          <Link to="/settings" className="text-sm font-medium link">
            How to fix
          </Link>
        ) : (
          <Button onClick={enable} loading={busy} icon={BellRingingIcon}>
            Turn on alerts
          </Button>
        )}
        <IconButton
          icon={XIcon}
          label="Dismiss"
          onClick={() => {
            try {
              localStorage.setItem(KEY, '1')
            } catch {
              /* private mode: dismiss for this visit only */
            }
            setHidden(true)
          }}
        />
      </div>
    </div>
  )
}
