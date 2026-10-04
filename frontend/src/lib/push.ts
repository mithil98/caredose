import type { PushStatus } from '../types/api'
import { del, get, post } from './api'

/** Browser side of Web Push: permission, subscription, renewal and removal. */

export type PushState = 'unsupported' | 'insecure' | 'denied' | 'disabled' | 'enabled'

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function bytesToBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return ''
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('The background service worker is not running. Reload the page and try again.')), 8000),
  )
  return Promise.race([navigator.serviceWorker.ready, timeout])
}

export async function currentPushState(): Promise<PushState> {
  if (!window.isSecureContext) return 'insecure'
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') return 'disabled'
  const reg = await registration().catch(() => null)
  if (!reg) return 'unsupported'
  return (await reg.pushManager.getSubscription()) ? 'enabled' : 'disabled'
}

async function save(sub: PushSubscription) {
  await post('/notifications/push-subscription', sub.toJSON())
}

/** Ask permission (must be called from a click), subscribe, and register with the backend. */
export async function enablePush(): Promise<void> {
  const status = await get<PushStatus>('/notifications/push-status')
  if (!status.configured || !status.vapid_public_key) {
    throw new Error('Push notifications are not configured on the server yet. Ask your administrator to add VAPID keys.')
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for this site. Allow them in your browser site settings, then try again.'
        : 'Notification permission was not granted.',
    )
  }
  const reg = await registration()
  const key = base64UrlToBytes(status.vapid_public_key)
  let sub = await reg.pushManager.getSubscription()
  if (sub && bytesToBase64Url(sub.options.applicationServerKey) !== status.vapid_public_key) {
    await sub.unsubscribe() // server key rotated: old subscription can no longer be used
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  await save(sub)
}

export async function disablePush(): Promise<void> {
  const sub = await (await registration()).pushManager.getSubscription()
  if (!sub) return
  await del('/notifications/push-subscription', { endpoint: sub.endpoint }).catch(() => undefined)
  await sub.unsubscribe()
}

/** On each app start: make sure the backend still has this browser's subscription (renewal). */
export async function syncPushSubscription(): Promise<void> {
  if (!window.isSecureContext || !pushSupported() || Notification.permission !== 'granted') return
  const sub = await (await registration()).pushManager.getSubscription()
  if (sub) await save(sub).catch(() => undefined)
}
