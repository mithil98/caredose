/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare let self: ServiceWorkerGlobalScope

/*
  Offline policy: only the static app shell (JS/CSS/fonts/icons) is cached so the app opens
  without a network. API data is never cached: patient data must not be shown stale.
*/
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }))

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

interface PushPayload {
  id?: number
  type?: string
  severity?: string
  title?: string
  body?: string
  url?: string
  tag?: string
  timestamp?: number
}

self.addEventListener('push', (event) => {
  let data: PushPayload = {}
  try {
    data = event.data?.json() ?? {}
  } catch {
    data = { body: event.data?.text() }
  }
  const url = data.url?.startsWith('/') ? data.url : '/notifications'
  const critical = data.severity === 'critical'
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title ?? 'CareDose alert', {
        body: data.body ?? '',
        tag: data.tag,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        timestamp: data.timestamp ?? Date.now(),
        requireInteraction: critical,
        data: { url, id: data.id },
      } as NotificationOptions)
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const c of clients) c.postMessage({ type: 'push', payload: data })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const { url = '/dashboard', id } = (event.notification.data ?? {}) as { url?: string; id?: number }
  const target = new URL(url, self.location.origin)
  if (target.origin !== self.location.origin) return
  if (id) target.searchParams.set('notification', String(id))
  const path = target.pathname + target.search
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = clients.find((c) => new URL(c.url).origin === self.location.origin)
      if (existing) {
        await existing.focus()
        existing.postMessage({ type: 'navigate', url: path })
        return
      }
      await self.clients.openWindow(path)
    })(),
  )
})

// The push service rotated the subscription: re-subscribe and tell the backend.
self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as Event & {
    oldSubscription?: PushSubscription | null
    newSubscription?: PushSubscription | null
    waitUntil: (p: Promise<unknown>) => void
  }
  e.waitUntil(
    (async () => {
      const old = e.oldSubscription
      const fresh =
        e.newSubscription ??
        (old?.options.applicationServerKey
          ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: old.options.applicationServerKey })
          : null)
      if (!old || !fresh) return
      await fetch('/api/v1/notifications/push-subscription/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_endpoint: old.endpoint, subscription: fresh.toJSON() }),
      })
    })(),
  )
})
