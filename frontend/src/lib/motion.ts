/**
 * GSAP setup shared by the app. Plugins are registered once; DESIGN.md's cubic-bezier curves
 * (exposed as --ds-ease-* CSS variables) become named GSAP eases so CSS and GSAP motion match.
 * Every hook runs only under `prefers-reduced-motion: no-preference`.
 */
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { CustomEase } from 'gsap/CustomEase'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import type { RefObject } from 'react'

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText, CustomEase)

export { gsap, ScrollTrigger, SplitText, useGSAP }
export const MOTION_OK = '(prefers-reduced-motion: no-preference)'

let easesReady = false
/** Register `ds-emphasis`, `ds-reveal`, `ds-standard` from DESIGN.md tokens (idempotent). */
export function dsEases() {
  if (easesReady) return
  easesReady = true
  const css = getComputedStyle(document.documentElement)
  const make = (name: string, cssVar: string, fallback: string) => {
    const nums = (css.getPropertyValue(cssVar).match(/cubic-bezier\(([^)]+)\)/)?.[1] ?? fallback).split(',').map(Number)
    const [x1, y1, x2, y2] = nums.length === 4 && nums.every(Number.isFinite) ? nums : fallback.split(',').map(Number)
    CustomEase.create(name, `M0,0 C${x1},${y1} ${x2},${y2} 1,1`)
  }
  make('ds-emphasis', '--ds-ease-emphasis', '0.25,1,0.33,1')
  make('ds-reveal', '--ds-ease-reveal', '0.33,1,0.68,1')
  make('ds-standard', '--ds-ease-standard', '0.2,0.75,0.5,1')
}

/**
 * Headline reveal: characters rise out of word masks, then the split is reverted (plain text again).
 * Gradient-text spans (.text-aqua) are kept whole (splitting breaks background-clip:text) and rise
 * as one piece. Pass `enabled=false` to hold the reveal (e.g. while the welcome loader covers it).
 */
export function useSplitReveal(ref: RefObject<HTMLElement | null>, deps: unknown[] = [], delay = 0, enabled = true) {
  useGSAP(
    () => {
      const el = ref.current
      if (!el || !enabled) return
      dsEases()
      gsap.matchMedia().add(MOTION_OK, () => {
        const split = SplitText.create(el, { type: 'words,chars', mask: 'words', ignore: '.text-aqua' })
        const tl = gsap.timeline({ delay, onComplete: () => split.revert() })
        tl.from(split.chars, { yPercent: 115, opacity: 0, duration: 0.9, ease: 'ds-reveal', stagger: 0.018 })
        const whole = el.querySelectorAll('.text-aqua')
        if (whole.length) tl.from(whole, { yPercent: 45, opacity: 0, duration: 0.9, ease: 'ds-reveal', stagger: 0.1 }, 0.2)
      })
    },
    { dependencies: [...deps, enabled], scope: ref },
  )
}

/** Fade-up children (matching `selector`) as they scroll into view, in batches. */
export function useBatchReveal(scope: RefObject<HTMLElement | null>, selector: string, deps: unknown[] = []) {
  useGSAP(
    () => {
      if (!scope.current) return
      dsEases()
      gsap.matchMedia().add(MOTION_OK, () => {
        const items = gsap.utils.toArray<HTMLElement>(selector, scope.current)
        if (!items.length) return
        // opacity (not visibility) so content stays readable by assistive tech before it animates
        gsap.set(items, { opacity: 0, y: 28 })
        ScrollTrigger.batch(items, {
          start: 'top 92%',
          once: true,
          onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 0.8, ease: 'ds-emphasis', stagger: 0.08, overwrite: true }),
        })
      })
    },
    { dependencies: deps, scope },
  )
}

/**
 * Two-axis parallax for decorative layers marked `data-depth="0.2"` (higher = moves more):
 * follows the pointer (quickTo, no React state) and drifts with scroll (ScrollTrigger scrub).
 */
export function useParallax(scope: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useGSAP(
    () => {
      const root = scope.current
      if (!root) return
      gsap.matchMedia().add(MOTION_OK, () => {
        const layers = gsap.utils.toArray<HTMLElement>('[data-depth]', root)
        const movers = layers.map((el) => {
          const depth = Number(el.dataset.depth) || 0.1
          gsap.to(el, {
            yPercent: -60 * depth,
            ease: 'none',
            scrollTrigger: { trigger: root, start: 'top top', end: 'bottom top', scrub: 0.6 },
          })
          return {
            depth,
            x: gsap.quickTo(el, 'x', { duration: 0.9, ease: 'power3.out' }),
            y: gsap.quickTo(el, 'y', { duration: 0.9, ease: 'power3.out' }),
          }
        })
        const onMove = (e: PointerEvent) => {
          const r = root.getBoundingClientRect()
          const nx = (e.clientX - r.left) / r.width - 0.5
          const ny = (e.clientY - r.top) / r.height - 0.5
          for (const m of movers) {
            m.x(nx * 60 * m.depth)
            m.y(ny * 40 * m.depth)
          }
        }
        root.addEventListener('pointermove', onMove)
        return () => root.removeEventListener('pointermove', onMove)
      })
    },
    { dependencies: deps, scope },
  )
}

/** Tween a number into an element's text (no React re-render per frame). */
export function countTo(el: HTMLElement | null, to: number, suffix = '') {
  if (!el) return
  const from = Number(el.dataset.value ?? 0)
  el.dataset.value = String(to)
  if (!window.matchMedia(MOTION_OK).matches || from === to) {
    el.textContent = `${to}${suffix}`
    return
  }
  const proxy = { v: from }
  gsap.to(proxy, {
    v: to,
    duration: 1.1,
    ease: 'power3.out',
    onUpdate: () => {
      el.textContent = `${Math.round(proxy.v)}${suffix}`
    },
  })
}
