/**
 * Turns the repo's DESIGN.md into CSS custom properties (`--ds-*`), so the UI is themed from
 * that file: edit DESIGN.md and the dev server reloads with the new palette, font, radii and motion.
 *
 *   import 'virtual:design-tokens.css'   // in main.tsx
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

export interface DesignColor {
  token: string
  value: string
  role: string
}

export interface DesignTokens {
  colors: DesignColor[]
  roles: { ink: string; muted: string; accent: string; light: string }
  fonts: string[]
  typeScale: Record<string, number>
  radius: Record<string, number>
  durations: { base: number; slow: number; reveal: number }
  easings: { standard: string; emphasis: string; reveal: string }
  elevation: boolean
}

const DEFAULT_ROLES = { ink: '#121213', muted: '#555555', accent: '#e82b00', light: '#ffffff' }
const DEFAULT_EASE = 'cubic-bezier(0.25, 1, 0.33, 1)'
const SERIF = /^(times|georgia|garamond|serif|cambria|palatino)/i

function luminance(hex: string) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6)
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function section(md: string, title: string) {
  const m = md.match(new RegExp(`^## ${title}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'))
  return m ? m[1] : ''
}

function seconds(text: string) {
  return [...text.matchAll(/(\d*\.?\d+)s\b/g)].map((m) => Number(m[1]))
}

export function parseDesign(md: string): DesignTokens {
  const colors = [...section(md, 'Colors').matchAll(/^\|\s*([\w-]+)\s*\|\s*`?(#[0-9a-fA-F]{3,8})`?\s*\|\s*([^|]*?)\s*\|/gm)].map(
    ([, token, value, role]) => ({ token, value: value.toLowerCase(), role }),
  )

  // Roles: darkest text colour = ink, next = muted, "Accent" = accent, "Light"/lightest = light.
  const byLum = [...colors].sort((a, b) => luminance(a.value) - luminance(b.value))
  const texts = byLum.filter((c) => /text/i.test(c.role) && !/light/i.test(c.role))
  const roles = {
    ink: texts[0]?.value ?? byLum[0]?.value ?? DEFAULT_ROLES.ink,
    muted: texts[1]?.value ?? DEFAULT_ROLES.muted,
    accent: colors.find((c) => /accent|brand|primary action/i.test(c.role))?.value ?? DEFAULT_ROLES.accent,
    light: colors.find((c) => /light|background|surface/i.test(c.role))?.value ?? byLum.at(-1)?.value ?? DEFAULT_ROLES.light,
  }

  const stack = md.match(/\*\*Font stack:\*\*\s*(.+)/)?.[1] ?? ''
  const fonts = stack
    .split(',')
    .map((f) => f.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)

  const typeScale = Object.fromEntries(
    [...section(md, 'Typography').matchAll(/^\|\s*(text-[\w]+)\s*\|\s*(\d+(?:\.\d+)?)px\s*\|/gm)].map(([, k, v]) => [k, Number(v)]),
  )
  const radius = Object.fromEntries(
    [...section(md, 'Shapes').matchAll(/radius-(\w+):\s*(\d+(?:\.\d+)?)px/g)].map(([, k, v]) => [k, Number(v)]),
  )

  const motion = section(md, 'Motion')
  const lines = (kind: string) => [...motion.matchAll(new RegExp(`\\*\\*duration-${kind}:\\*\\*\\s*\`([^\`]+)\``, 'g'))].map((m) => m[1])
  const base = lines('base').flatMap(seconds)
  const slow = lines('slow')
    .flatMap(seconds)
    .filter((s) => s >= 0.25)
  const mode = (xs: number[]) => xs.sort((a, b) => xs.filter((v) => v === b).length - xs.filter((v) => v === a).length)[0]
  const easeIn = (pick: (line: string) => boolean) => {
    const line = lines('slow').find((l) => pick(l) && l.includes('cubic-bezier'))
    return line?.match(/cubic-bezier\([^)]+\)/)?.[0]
  }

  return {
    colors,
    roles,
    fonts,
    typeScale,
    radius,
    durations: {
      base: mode(base) ?? 0.2,
      slow: slow.length ? Math.min(...slow) : 0.35,
      reveal: slow.length ? Math.max(...slow) : 0.8,
    },
    easings: {
      standard: easeIn((l) => /color|background/.test(l)) ?? DEFAULT_EASE,
      emphasis: easeIn((l) => l.startsWith('transform')) ?? DEFAULT_EASE,
      reveal: easeIn((l) => l.includes('clip-path')) ?? easeIn(() => true) ?? DEFAULT_EASE,
    },
    elevation: !/_None detected\._/.test(section(md, 'Elevation')),
  }
}

export function toCss(t: DesignTokens) {
  const [primary, ...rest] = t.fonts
  // Self-hosted variable fonts register as "<Family> Variable". Serif fallbacks are skipped so the
  // brief swap while the web font loads stays sans-serif.
  const family = [primary && `"${primary} Variable"`, primary && `"${primary}"`, ...rest.filter((f) => !SERIF.test(f)).map((f) => `"${f}"`)]
    .filter(Boolean)
    .join(', ')
  const px = (k: string, fallback: number) => `${t.typeScale[k] ?? fallback}px`
  const vars: Record<string, string> = {
    '--ds-ink': t.roles.ink,
    '--ds-muted': t.roles.muted,
    '--ds-accent': t.roles.accent,
    '--ds-light': t.roles.light,
    '--ds-font-sans': `${family ? family + ', ' : ''}ui-sans-serif, system-ui, sans-serif`,
    '--ds-text-lg': px('text-lg', 16),
    '--ds-text-xl': px('text-xl', 21),
    '--ds-text-2xl': px('text-2xl', 30),
    '--ds-text-3xl': px('text-3xl', 45),
    '--ds-radius-sm': `${t.radius.sm ?? 5}px`,
    '--ds-radius-md': `${t.radius.md ?? t.radius.lg ?? 20}px`,
    '--ds-duration-base': `${t.durations.base}s`,
    '--ds-duration-slow': `${t.durations.slow}s`,
    '--ds-duration-reveal': `${t.durations.reveal}s`,
    '--ds-ease-standard': t.easings.standard,
    '--ds-ease-emphasis': t.easings.emphasis,
    '--ds-ease-reveal': t.easings.reveal,
    '--ds-elevation': t.elevation ? '1' : '0',
  }
  for (const c of t.colors) vars[`--ds-${c.token}`] = c.value
  return `/* generated from DESIGN.md */\n:root {\n${Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')}\n}\n`
}

export function readDesign(file: string) {
  return parseDesign(readFileSync(file, 'utf8'))
}

const VIRTUAL = 'virtual:design-tokens.css'
const RESOLVED = '\0' + VIRTUAL

export const DESIGN_FILE = process.env.DESIGN_FILE ?? fileURLToPath(new URL('../DESIGN.md', import.meta.url))

export function designTokens(file = DESIGN_FILE): Plugin {
  return {
    name: 'design-tokens',
    resolveId: (id) => (id === VIRTUAL ? RESOLVED : undefined),
    load(id) {
      if (id !== RESOLVED) return
      this.addWatchFile(file)
      return toCss(readDesign(file))
    },
    configureServer(server) {
      server.watcher.add(file)
      server.watcher.on('change', (changed) => {
        if (resolve(changed).toLowerCase() !== file.toLowerCase()) return
        const mod = server.moduleGraph.getModuleById(RESOLVED)
        if (mod) server.moduleGraph.invalidateModule(mod)
        server.ws.send({ type: 'full-reload' })
      })
    },
  }
}
