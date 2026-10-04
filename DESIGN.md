# Design By Brandin – Creative Director, Designer, and AI Product Developer

## Overview

**Product:** Design By Brandin – Creative Director, Designer, and AI Product Developer
**URL:** https://designbybrandin.com/
**Surface type:** e-commerce
**Audience:** Consumers and shoppers
**Brand character:** Product-focused shopping experience with a balanced color system and a complementary two-font typographic system.

> **Note:** Surface detection confidence is low. Verify the inferred audience and brand context before relying on this file.

### Design Principles

- Trust signals first — credibility reduces friction more than clever copy.
- Clear path to action — one primary CTA per view, never stacked.
- Speed over polish — perceived performance is part of the design system.

## Colors

| Token | Value | Role |
|-------|-------|------|
| color-1 | `#121213` | Text Primary |
| color-2 | `#555555` | Text Primary |
| color-3 | `#E82B00` | Accent |
| color-4 | `#FFFFFF` | Text Light |

## Typography

**Font stack:** Zalando Sans, Times New Roman

| Level | Size | Usage |
|-------|------|-------|
| text-xs | 0px | Captions, metadata |
| text-sm | 9px | Labels, secondary text |
| text-base | 12px | Body text (default) |
| text-lg | 16px | Subheadings, emphasis |
| text-xl | 21px | Section headings |
| text-2xl | 30px | Section headings |
| text-3xl | 45px | Section headings |
| text-4xl | 128px | Section headings |

**Weight scale:** 400 · 500 · 600 · 700
**Line heights:** 18.0642px · 108.385px · 30px · 45px · 0px · 24px · 22.1px · 12px · 21px · 12.3103px · 28px · 22px · 1px

## Spacing

**Base unit:** 4px

`space-1: 5px` · `space-2: 6px` · `space-3: 7px` · `space-4: 10px` · `space-5: 19px` · `space-6: 20px` · `space-7: 21px` · `space-8: 28px` · `space-9: 30px` · `space-10: 53px` · `space-11: 60px` · `space-12: 85px` · `space-13: 647px`

## Shapes

**Border radius:** `radius-sm: 5px` · `radius-md: 20px`

## Elevation

_None detected._

## Motion

- **duration-fast:** `all`
- **duration-fast:** `none`
- **duration-base:** `opacity 0.2s, color 0.2s`
- **duration-base:** `opacity 0.2s, background-color 0.2s`
- **duration-base:** `opacity 0.2s`
- **duration-base:** `background 0.2s, opacity 0.2s`
- **duration-base:** `margin 0.2s, transform 0.2s 1s, opacity 0.3s`
- **duration-base:** `0.2s`
- **duration-base:** `margin 0.25s`
- **duration-base:** `opacity 0.25s`
- **duration-base:** `color 0.3s`
- **duration-base:** `0.3s`
- **duration-base:** `transform 0.3s, height 0.3s, background 0.3s, opacity 0.3s, border-color 0.3s, box-shadow 0.3s, backdrop-filter 0.3s`
- **duration-slow:** `transform 0.33s`
- **duration-slow:** `opacity 0.4s 0.1s`
- **duration-slow:** `0.4s cubic-bezier(0.52, 0.01, 0.16, 1) 0.06s forwards crossRightClose`
- **duration-slow:** `0.4s cubic-bezier(0.52, 0.01, 0.16, 1) forwards crossLeftClose`
- **duration-slow:** `transform 0.55s cubic-bezier(0.25, 1, 0.33, 1)`
- **duration-slow:** `color 0.8s, background-size 0.55s cubic-bezier(0.2, 0.75, 0.5, 1)`
- **duration-slow:** `padding 0.8s, margin 0.25s`
- **duration-slow:** `color 0.8s, background-color 0.8s`
- **duration-slow:** `background-color 0.8s`
- **duration-slow:** `padding 0.8s`
- **duration-slow:** `background-color 0.8s, transform 0.8s cubic-bezier(0.15, 0.2, 0.1, 1)`
- **duration-slow:** `transform 1.2s cubic-bezier(0.25, 1, 0.5, 1), opacity 1.2s cubic-bezier(0.25, 1, 0.5, 1), filter 1.2s cubic-bezier(0.25, 1, 0.5, 1)`
- **duration-slow:** `transform 1.3s cubic-bezier(0.33, 1, 0.68, 1) 0.3s, clip-path 1.3s cubic-bezier(0.33, 1, 0.68, 1) 0.3s, opacity 1.3s cubic-bezier(0.33, 1, 0.68, 1) 0.3s`
- **duration-slow:** `transform 1.3s cubic-bezier(0.33, 1, 0.68, 1) 0.4s, clip-path 1.3s cubic-bezier(0.33, 1, 0.68, 1) 0.4s, opacity 1.3s cubic-bezier(0.33, 1, 0.68, 1) 0.4s`
- **duration-slow:** `transform 1.3s cubic-bezier(0.33, 1, 0.68, 1) 0.35s, clip-path 1.3s cubic-bezier(0.33, 1, 0.68, 1) 0.35s, opacity 1.3s cubic-bezier(0.33, 1, 0.68, 1) 0.35s`

## Components

- **Buttons:** 15 detected
- **Links:** 39 detected
- **Inputs:** 1 detected
- **Navigation:** 4 elements
- **Lists:** 23 detected
- **Forms:** 1 detected
- **Images:** 34 detected

## Do's and Don'ts

### Do

- Reference tokens by name, not raw values — agents and developers should use `color.text.primary`, not `#171717`.
- Define all interactive states: default, hover, focus-visible, active, disabled.
- Use the spacing scale for all padding, margin, and gap values.
- Write content in sentence case. Reserve ALL CAPS for acronyms only.
- Test every component at the smallest and largest breakpoint before shipping.

### Don't

- Do not introduce colors outside the extracted palette.
- Do not use arbitrary spacing values — stick to the scale.
- Do not mix border-radius values. Pin to the detected set (5px, 20px).
- Do not stack more than one primary CTA per viewport.
- Do not use red for non-error UI — reserve it for destructive actions and warnings.
- Do not ship components without defining hover, focus-visible, and disabled states.

## Writing Tone

Persuasive, benefit-driven, trustworthy. Active voice, urgency without pressure.

## Authoring Workflow

When creating or updating a component guideline for this system, follow this sequence:

1. **State the intent** — one sentence on what the component does and why it exists.
2. **Map tokens** — list every color, spacing, typography, and radius token the component uses. No raw values.
3. **Define anatomy** — break the component into named parts (container, label, icon, etc.) with their token assignments.
4. **Specify states** — document every state: default, hover, focus-visible, active, disabled, loading, error, empty.
5. **Describe interactions** — keyboard, pointer, and touch behavior, including edge cases (long content, overflow, truncation).
6. **Add accessibility criteria** — write testable pass/fail checks (e.g. "focus ring must be visible at 3:1 contrast").
7. **List anti-patterns** — concrete examples of misuse with a brief explanation of why each is wrong.
8. **Close with a QA checklist** — a mechanical list of verifiable items (see Definition of Done below).

## Required Output Structure

Every component guideline produced from this system must contain these sections, in order:

1. Overview — purpose, when to use, when not to use.
2. Tokens and foundations — all referenced tokens from the tables above.
3. Anatomy and variants — named parts, variant matrix, responsive behavior.
4. States and interactions — full state table, keyboard/pointer/touch behavior.
5. Accessibility — ARIA attributes, contrast requirements, focus management, screen reader behavior.
6. Content guidelines — copy length, tone, capitalisation, placeholder text rules.
7. Anti-patterns — explicit examples of what not to build, with reasoning.

## Component Requirements

Every component built against this system must:

- Reference only tokens defined in the tables above — no hardcoded hex, px, or font values.
- Define all interactive states: default, hover, focus-visible, active, disabled, loading, error.
- Specify responsive behavior at the smallest and largest supported breakpoint.
- Handle edge cases: empty state, overflow / truncation, maximum content length.
- Include keyboard navigation (Tab, Enter, Escape, Arrow keys where applicable).
- Document ARIA roles, labels, and live-region behavior where relevant.
- Include known page component density: - **Buttons:** 15 detected
- **Links:** 39 detected
- **Inputs:** 1 detected
- **Navigation:** 4 elements
- **Lists:** 23 detected
- **Forms:** 1 detected
- **Images:** 34 detected

## Definition of Done

A component is not complete until every item below is checked:

- Renders correctly in its default state (smoke test).
- All states documented and visually verified (hover, focus, disabled, loading, error, empty).
- All visual values use design tokens — zero hardcoded values.
- Keyboard navigation works without a pointer.
- No critical accessibility violations (contrast, ARIA, focus order).
- Tested at smallest and largest breakpoint.
- Anti-patterns section lists at least one concrete misuse example.
- Documentation covers purpose, usage, props/API, and limitations.
