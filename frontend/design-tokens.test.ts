// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DESIGN_FILE, parseDesign, toCss } from './design-tokens.ts'

describe('DESIGN.md tokens', () => {
  const tokens = parseDesign(readFileSync(DESIGN_FILE, 'utf8'))

  it('maps palette roles from the file', () => {
    expect(tokens.colors.length).toBeGreaterThanOrEqual(4)
    expect(tokens.roles).toEqual({ ink: '#121213', muted: '#555555', accent: '#e82b00', light: '#ffffff' })
  })

  it('reads font, radii, type scale and motion', () => {
    expect(tokens.fonts[0]).toBe('Zalando Sans')
    expect(tokens.radius).toEqual({ sm: 5, md: 20 })
    expect(tokens.typeScale['text-3xl']).toBe(45)
    expect(tokens.durations.base).toBe(0.2)
    expect(tokens.durations.reveal).toBe(1.3)
    expect(tokens.easings.reveal).toBe('cubic-bezier(0.33, 1, 0.68, 1)')
    expect(tokens.easings.emphasis).toBe('cubic-bezier(0.25, 1, 0.33, 1)')
    expect(tokens.elevation).toBe(false)
  })

  it('emits CSS variables, skipping serif fallbacks', () => {
    const css = toCss(tokens)
    expect(css).toContain('--ds-accent: #e82b00;')
    expect(css).toContain('--ds-font-sans: "Zalando Sans Variable", "Zalando Sans", ui-sans-serif')
    expect(css).not.toContain('Times New Roman')
    expect(css).toContain('--ds-radius-md: 20px;')
  })

  it('falls back to safe defaults when sections are missing', () => {
    const t = parseDesign('# Empty design file')
    expect(t.roles.ink).toBe('#121213')
    expect(t.durations).toEqual({ base: 0.2, slow: 0.35, reveal: 0.8 })
    expect(toCss(t)).toContain('--ds-radius-sm: 5px;')
  })

  it('re-themes when the file changes', () => {
    const t = parseDesign(
      '## Colors\n| Token | Value | Role |\n|--|--|--|\n| c1 | `#0a2540` | Text Primary |\n| c2 | `#00d4aa` | Accent |\n| c3 | `#f6f9fc` | Text Light |\n',
    )
    expect(t.roles).toMatchObject({ ink: '#0a2540', accent: '#00d4aa', light: '#f6f9fc' })
  })
})
