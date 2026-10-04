import { useId, useRef, useState } from 'react'
import { fmtLocalDate } from '../lib/format'
import { countTo, gsap, MOTION_OK, useGSAP } from '../lib/motion'
import type { DailyAdherence } from '../types/api'
import { cn } from './ui'

/**
 * Daily adherence as a single-series column chart (one hue: brand). Taken / missed counts
 * live in the tooltip and the table view, so identity never depends on red vs green.
 * Specs: columns <= 24px, 4px rounded top, square baseline, hairline gridlines, label only
 * the latest day, hover + keyboard tooltip, table fallback.
 */
export function AdherenceChart({ days, height = 160, className }: { days: DailyAdherence[]; height?: number; className?: string }) {
  const [active, setActive] = useState<number | null>(null)
  const tableId = useId()
  const labelEvery = days.length > 10 ? 5 : 1
  const last = days.length - 1

  const describe = (d: DailyAdherence) =>
    d.scheduled === 0
      ? `${fmtLocalDate(d.date)}: no doses due`
      : `${fmtLocalDate(d.date)}: ${d.adherence}% adherence, ${d.taken} of ${d.scheduled} taken${d.missed ? `, ${d.missed} missed` : ''}${d.late ? `, ${d.late} late` : ''}`

  return (
    <figure className={cn('m-0', className)}>
      <div className="relative flex gap-2" style={{ height }}>
        {/* y axis */}
        <div className="flex w-9 shrink-0 flex-col justify-between pb-6 text-right text-xs text-ink-3 tabular" aria-hidden>
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between" aria-hidden>
            <div className="border-t border-line" />
            <div className="border-t border-line" />
            <div className="border-t border-line-strong" />
          </div>
          <ul className="absolute inset-0 flex items-stretch" aria-label="Daily adherence" aria-describedby={tableId}>
            {days.map((d, i) => {
              const pct = d.adherence ?? 0
              const has = d.scheduled > 0
              return (
                <li
                  key={d.date}
                  tabIndex={0}
                  aria-label={describe(d)}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="group relative flex min-w-0 flex-1 cursor-default flex-col items-center rounded-md outline-none focus-visible:bg-brand-soft/60 focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <div className="relative flex w-full flex-1 items-end justify-center pb-0">
                    {has && (
                      <div
                        className={cn(
                          'bar-grow w-[min(24px,70%)] rounded-t-sm bg-linear-to-t from-g3 via-g2 to-g1 transition-opacity',
                          active !== null && active !== i && 'opacity-45',
                          'group-focus-visible:ring-2 group-focus-visible:ring-brand/40',
                        )}
                        style={{ height: `${Math.max(pct, 1.5)}%`, animationDelay: `${i * 40}ms` }}
                      />
                    )}
                    {i === last && has && (
                      <span
                        className="absolute text-xs font-semibold text-ink tabular"
                        style={{ bottom: `calc(${pct}% + 4px)` }}
                        aria-hidden
                      >
                        {d.adherence}%
                      </span>
                    )}
                  </div>
                  <span className="h-6 pt-1.5 text-[11px] leading-none text-ink-3" aria-hidden>
                    {i % labelEvery === 0 || i === last
                      ? fmtLocalDate(d.date, {
                          weekday: days.length > 10 ? undefined : 'short',
                          day: days.length > 10 ? 'numeric' : undefined,
                        })
                      : ''}
                  </span>
                  {active === i && (
                    <div
                      role="presentation"
                      className={cn(
                        'pointer-events-none absolute bottom-full z-10 mb-1 w-max max-w-48 rounded-lg border border-line bg-surface px-3 py-2 text-left shadow-pop',
                        i > days.length / 2 ? 'right-0' : 'left-0',
                      )}
                    >
                      <p className="text-[15px] font-semibold text-ink tabular">{has ? `${d.adherence}%` : 'No doses due'}</p>
                      <p className="text-xs text-ink-3">{fmtLocalDate(d.date)}</p>
                      {has && (
                        <p className="mt-1 text-xs text-ink-2 tabular">
                          {d.taken} of {d.scheduled} taken
                          {d.missed > 0 && `, ${d.missed} missed`}
                          {d.late > 0 && `, ${d.late} late`}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-ink-3 hover:text-ink">Show as table</summary>
        <div className="mt-2 max-h-60 overflow-auto">
          <table id={tableId} className="w-full text-left text-sm tabular">
            <caption className="sr-only">Daily adherence</caption>
            <thead className="text-ink-3">
              <tr>
                <th className="py-1 font-medium">Day</th>
                <th className="py-1 text-right font-medium">Due</th>
                <th className="py-1 text-right font-medium">Taken</th>
                <th className="py-1 text-right font-medium">Missed</th>
                <th className="py-1 text-right font-medium">Adherence</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-t border-line">
                  <td className="py-1">{fmtLocalDate(d.date)}</td>
                  <td className="py-1 text-right">{d.scheduled}</td>
                  <td className="py-1 text-right">{d.taken}</td>
                  <td className="py-1 text-right">{d.missed}</td>
                  <td className="py-1 text-right">{d.adherence === null ? 'No doses' : `${d.adherence}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}

/** Small "x of y" meter. Track is a lighter step of the same hue. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max ? Math.round((value / max) * 100) : 0
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="h-1.5 w-full overflow-hidden rounded-2xl bg-brand-soft"
    >
      <div className="h-full rounded-2xl bg-aqua transition-[width] duration-700 ease-emphasis" style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Radial "taken today" ring with the brand gradient. GSAP sweeps the arc and counts the number. */
export function ProgressRing({ value, max, size = 168, label }: { value: number; max: number; size?: number; label: string }) {
  const arc = useRef<SVGCircleElement>(null)
  const num = useRef<HTMLSpanElement>(null)
  const gradId = useId()
  const r = 52
  const c = 2 * Math.PI * r
  const pct = max ? value / max : 0
  useGSAP(
    () => {
      const offset = c * (1 - pct)
      countTo(num.current, value)
      if (!window.matchMedia(MOTION_OK).matches) {
        arc.current?.setAttribute('stroke-dashoffset', String(offset))
        return
      }
      gsap.to(arc.current, { attr: { 'stroke-dashoffset': offset }, duration: 1.4, ease: 'power3.out', delay: 0.2 })
    },
    { dependencies: [value, max] },
  )
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--g1)" />
            <stop offset="55%" stopColor="var(--g2)" />
            <stop offset="100%" stopColor="var(--g3)" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="9" />
        <circle
          ref={arc}
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <p className="text-title font-semibold leading-none">
          <span ref={num} />
          <span className="text-section font-medium text-night-ink-2">/{max}</span>
        </p>
        <p className="mt-1 text-[13px] text-night-ink-2">taken today</p>
      </div>
    </div>
  )
}
