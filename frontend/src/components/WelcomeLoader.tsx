import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useId, useRef, useState } from 'react'
import { get } from '../lib/api'
import { dsEases, gsap, MOTION_OK, useGSAP } from '../lib/motion'
import type { Dashboard, NotificationPage } from '../types/api'
import { Scene3D } from './three/Scene3D'

const STEPS = ['Signing you in', "Checking today's doses", 'Connecting to dispensers', 'Preparing your alerts']
const R = 54
const C = 2 * Math.PI * R
/** Choreography length: intro + eased fill + settle + exit lands at roughly six seconds. */
const FILL_SECONDS = 3.8

/**
 * Shown once after sign-in. Progress tracks real work (dashboard and alert data are prefetched
 * into the query cache) on an eased ~6 s timeline, then the overlay softly dissolves into the
 * dashboard. Reduced motion: a plain status message and a quick fade as soon as data is ready.
 */
export function WelcomeLoader({ name, onDone }: { name: string; onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  const ring = useRef<SVGCircleElement>(null)
  const pct = useRef<HTMLSpanElement>(null)
  const step = useRef<HTMLSpanElement>(null)
  const bars = useRef<(HTMLSpanElement | null)[]>([])
  const exitRef = useRef<() => void>(() => onDone())
  const [spin, setSpin] = useState(0)
  const qc = useQueryClient()
  const gradId = useId()

  useGSAP(
    () => {
      dsEases()
      // Keep the ~6 s choreography on wall-clock time even when the 3D scene drops frames.
      gsap.ticker.lagSmoothing(0)
      let alive = true
      const tasks = Promise.race([
        Promise.allSettled([
          qc.prefetchQuery({ queryKey: ['dashboard'], queryFn: () => get<Dashboard>('/dashboard') }),
          qc.prefetchQuery({
            queryKey: ['notifications', 'unread'],
            queryFn: () => get<NotificationPage>('/notifications', { page_size: 1 }),
          }),
        ]),
        new Promise((resolve) => setTimeout(resolve, 8000)), // never block on a slow backend
      ])
      const proxy = { p: 0 }
      let lastSpin = 0
      let current = 0

      const showStep = (i: number) => {
        if (i === current || !step.current) return
        current = i
        const el = step.current
        gsap
          .timeline()
          .to(el, { yPercent: -100, opacity: 0, duration: 0.28, ease: 'sine.in' })
          .call(() => {
            el.textContent = STEPS[i]
          })
          .fromTo(el, { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.42, ease: 'ds-emphasis' })
      }
      const paint = () => {
        ring.current?.setAttribute('stroke-dashoffset', String(C * (1 - proxy.p / 100)))
        if (pct.current) pct.current.textContent = String(Math.round(proxy.p))
        bars.current.forEach((bar, n) => {
          if (bar) bar.style.transform = `scaleX(${Math.min(1, Math.max(0, (proxy.p - n * 25) / 25))})`
        })
        showStep(Math.min(STEPS.length - 1, Math.floor(proxy.p / 25)))
        if (proxy.p - lastSpin >= 8) setSpin((lastSpin = proxy.p) / 100)
      }
      const exit = () => {
        if (!alive) return
        alive = false
        gsap
          .timeline({ onComplete: onDone })
          .to('[data-loader-content]', { y: -14, opacity: 0, filter: 'blur(6px)', duration: 0.6, ease: 'sine.inOut' })
          .to(root.current, { opacity: 0, scale: 1.04, filter: 'blur(4px)', duration: 0.75, ease: 'power2.inOut' }, '-=0.25')
      }
      exitRef.current = exit

      const mm = gsap.matchMedia()
      mm.add({ motion: MOTION_OK, reduce: '(prefers-reduced-motion: reduce)' }, (ctx) => {
        if (!ctx.conditions?.motion) {
          exitRef.current = () => onDone()
          tasks.then(() => {
            if (alive) gsap.to(root.current, { opacity: 0, duration: 0.2, onComplete: onDone })
          })
          return () => {
            alive = false
            gsap.ticker.lagSmoothing(500, 33)
          }
        }
        gsap
          .timeline()
          .from(root.current, { opacity: 0, duration: 0.5, ease: 'sine.out' })
          .from('[data-loader-ring]', { scale: 0.7, opacity: 0, rotate: -30, duration: 1.1, ease: 'ds-emphasis' }, 0.1)
          .from('[data-loader-title] > *', { yPercent: 110, opacity: 0, stagger: 0.1, duration: 0.9, ease: 'ds-reveal' }, 0.35)
          .from(
            '[data-loader-step], [data-loader-bars], [data-loader-skip]',
            { y: 10, opacity: 0, stagger: 0.08, duration: 0.6, ease: 'sine.out' },
            0.7,
          )
        // Smooth, unhurried fill; the last stretch waits for the real data.
        gsap.to(proxy, { p: 90, duration: FILL_SECONDS, ease: 'sine.inOut', onUpdate: paint, delay: 0.3 })
        Promise.all([tasks, new Promise((r) => setTimeout(r, (FILL_SECONDS + 0.3) * 1000))]).then(() => {
          if (!alive) return
          gsap.to(proxy, {
            p: 100,
            duration: 0.6,
            ease: 'sine.out',
            onUpdate: paint,
            overwrite: true,
            onComplete: () => {
              gsap.delayedCall(0.2, exit)
            },
          })
        })
        return () => {
          alive = false
          gsap.ticker.lagSmoothing(500, 33)
        }
      })
    },
    { scope: root },
  )

  const skip = useCallback(() => exitRef.current(), [])

  return (
    <div
      ref={root}
      role="status"
      aria-live="polite"
      aria-label="Loading your dashboard"
      className="fixed inset-0 z-[60] grid place-items-center overflow-hidden bg-stage text-night-ink"
    >
      <Scene3D variant="loader" progress={spin} className="absolute inset-0" />
      <div data-loader-content className="relative flex flex-col items-center px-6 text-center">
        <div data-loader-ring className="relative size-40 sm:size-48">
          <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--g1)" />
                <stop offset="100%" stopColor="var(--g2)" />
              </linearGradient>
            </defs>
            <circle cx="60" cy="60" r={R} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="4" />
            <circle
              ref={ring}
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C}
            />
          </svg>
          <p className="absolute inset-0 grid place-items-center text-title font-semibold">
            <span>
              <span ref={pct}>0</span>
              <span className="text-section text-night-ink-2">%</span>
            </span>
          </p>
        </div>
        <h2 data-loader-title className="mt-8 overflow-hidden text-title font-semibold text-balance sm:text-display">
          <span className="inline-block">Welcome back,&nbsp;</span>
          <span className="inline-block text-aqua">{name}</span>
        </h2>
        <p data-loader-step className="mt-3 h-6 overflow-hidden text-night-ink-2">
          <span ref={step} className="inline-block">
            {STEPS[0]}
          </span>
        </p>
        <div data-loader-bars className="mt-5 flex gap-1.5" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s} className="h-1 w-10 overflow-hidden rounded-2xl bg-white/15">
              <span
                ref={(el) => {
                  bars.current[i] = el
                }}
                style={{ transform: 'scaleX(0)' }}
                className="block h-full origin-left rounded-2xl bg-g1"
              />
            </span>
          ))}
        </div>
        <button
          data-loader-skip
          type="button"
          onClick={skip}
          className="mt-8 rounded-sm px-3 py-1.5 text-sm text-night-ink-2 underline underline-offset-4 hover:text-night-ink"
        >
          Skip
        </button>
      </div>
    </div>
  )
}
