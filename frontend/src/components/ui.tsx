import {
  BellIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  InfoIcon,
  WarningCircleIcon,
  WarningIcon,
  XIcon,
  type Icon,
} from '@phosphor-icons/react'
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Link, useSearchParams } from 'react-router'
import { useSplitReveal } from '../lib/motion'

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

/* ---------------- Buttons ---------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-hover shadow-panel',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'bg-bad text-on-brand hover:opacity-90',
}

export function buttonClass(variant: Variant = 'primary', size: 'sm' | 'md' = 'md', extra?: string) {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition',
    'active:translate-y-px disabled:pointer-events-none disabled:opacity-55',
    size === 'md' ? 'h-10 px-4 text-[15px]' : 'h-8 px-3 text-sm',
    VARIANTS[variant],
    extra,
  )
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: Icon
  loading?: boolean
}

export function Button({ variant, size, icon: IconCmp, loading, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} {...rest}>
      {loading ? (
        <CircleNotchIcon className="size-4 animate-spin" aria-hidden />
      ) : (
        IconCmp && <IconCmp className="size-[18px]" weight="bold" aria-hidden />
      )}
      {children}
    </button>
  )
}

export function IconButton({
  icon: IconCmp,
  label,
  className,
  ...rest
}: { icon: Icon; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-2 transition hover:bg-surface-2 hover:text-ink',
        className,
      )}
      {...rest}
    >
      <IconCmp className="size-5" aria-hidden />
    </button>
  )
}

/* ---------------- Forms ---------------- */

export function Field({
  label,
  hint,
  error,
  children,
  className,
  optional,
}: {
  label: string
  hint?: string
  error?: string
  optional?: boolean
  className?: string
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode
}) {
  const id = useId()
  const describedBy = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {optional && <span className="ml-1 font-normal text-ink-3">(optional)</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[13px] text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="flex items-center gap-1 text-[13px] font-medium text-bad-ink">
          <WarningCircleIcon className="size-4 shrink-0" weight="fill" aria-hidden />
          {error}
        </p>
      )}
    </div>
  )
}

const control =
  'w-full rounded-lg border border-line-strong bg-surface px-3 text-[15px] text-ink placeholder:text-ink-3 transition ' +
  'focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 focus:border-brand aria-[invalid=true]:border-bad disabled:opacity-60'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, 'h-10', className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, 'h-10 pr-8', className)} {...rest}>
      {children}
    </select>
  )
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-20 py-2', className)} {...rest} />
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[15px] font-medium text-ink">
          {label}
        </label>
        {description && <p className="text-sm text-ink-3">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-2xl transition disabled:opacity-50',
          checked ? 'bg-brand' : 'bg-line-strong',
        )}
      >
        <span
          className={cn(
            'inline-block size-5 rounded-2xl bg-surface shadow-panel transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
        <span className="sr-only">{checked ? 'On' : 'Off'}</span>
      </button>
    </div>
  )
}

/* ---------------- Surfaces ---------------- */

export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClass,
  as: Tag = 'section',
  reveal,
}: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClass?: string
  as?: 'section' | 'div' | 'article'
  /** fade up when scrolled into view (see useBatchReveal) */
  reveal?: boolean
}) {
  const headingId = useId()
  return (
    <Tag
      aria-labelledby={title ? headingId : undefined}
      data-reveal={reveal || undefined}
      className={cn('rounded-xl border border-line bg-surface shadow-panel', className)}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
          <div className="min-w-0">
            {title && (
              <h2 id={headingId} className="text-lg font-semibold tracking-tight text-ink">
                {title}
              </h2>
            )}
            {description && <p className="mt-0.5 text-sm text-ink-3">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cn('px-4 pb-4 sm:px-5', title || action ? 'pt-3' : 'pt-4', bodyClass)}>{children}</div>
    </Tag>
  )
}

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  back?: { to: string; label: string }
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useSplitReveal(heading)
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-2 inline-flex text-sm font-medium link">
            {back.label}
          </Link>
        )}
        <h1 ref={heading} className="text-title font-semibold text-balance text-ink lg:text-display">
          {title}
        </h1>
        <span aria-hidden className="mt-3 block h-1 w-14 rounded-2xl bg-aqua" />
        {description && <p className="mt-1 max-w-[65ch] text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'bad' | 'info'
const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2 border-line',
  brand: 'bg-brand-soft text-brand-ink border-transparent',
  ok: 'bg-ok-soft text-ok-ink border-transparent',
  warn: 'bg-warn-soft text-warn-ink border-transparent',
  bad: 'bg-bad-soft text-bad-ink border-transparent',
  info: 'bg-info-soft text-info-ink border-transparent',
}
export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink-3',
  brand: 'text-brand',
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-info',
}
export const TONE_SOFT: Record<Tone, string> = {
  neutral: 'bg-surface-2',
  brand: 'bg-brand-soft',
  ok: 'bg-ok-soft',
  warn: 'bg-warn-soft',
  bad: 'bg-bad-soft',
  info: 'bg-info-soft',
}

export function Badge({
  tone = 'neutral',
  icon: IconCmp,
  children,
  className,
}: {
  tone?: Tone
  icon?: Icon
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-2xl border px-2 py-0.5 text-[13px] font-medium',
        TONES[tone],
        className,
      )}
    >
      {IconCmp && <IconCmp className="size-3.5" weight="bold" aria-hidden />}
      {children}
    </span>
  )
}

/* ---------------- States ---------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-surface-2', className)} aria-hidden />
}

export function LoadingBlock({ rows = 3, label = 'Loading…' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14" />
      ))}
    </div>
  )
}

export function EmptyState({
  icon: IconCmp,
  title,
  children,
  action,
  compact,
}: {
  icon: Icon
  title: string
  children?: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'py-6' : 'py-12')}>
      <span className="mb-3 inline-flex size-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
        <IconCmp className="size-6" aria-hidden />
      </span>
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-ink-3">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-bad/30 bg-bad-soft p-4 text-bad-ink sm:flex-row sm:items-center"
    >
      <WarningCircleIcon className="size-6 shrink-0" weight="fill" aria-hidden />
      <div className="flex-1">
        <p className="font-semibold">Could not load this section</p>
        <p className="text-sm">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function Callout({
  tone = 'info',
  icon: IconCmp,
  title,
  children,
  action,
}: {
  tone?: Tone
  icon: Icon
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-start', TONE_SOFT[tone])}>
      <IconCmp className={cn('size-6 shrink-0', TONE_TEXT[tone])} weight="fill" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">{title}</p>
        {children && <div className="mt-0.5 text-sm text-ink-2">{children}</div>}
      </div>
      {action}
    </div>
  )
}

/* ---------------- Dialog (native <dialog>: focus trap + Esc for free) ---------------- */

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        'm-0 mt-auto w-full max-w-none rounded-t-2xl border border-line bg-surface p-0 text-ink shadow-pop',
        'sm:m-auto sm:rounded-xl',
        wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        'max-h-[92dvh] backdrop:backdrop-blur-[1px] open:animate-rise',
      )}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-ink-3">{description}</p>}
            </div>
            <IconButton icon={XIcon} label="Close" onClick={onClose} className="-mr-2 -mt-1" />
          </header>
          <div className="overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3 pb-safe">{footer}</footer>}
        </div>
      )}
    </dialog>
  )
}

/* ---------------- Tabs bound to ?tab= ---------------- */

export function useTab<T extends string>(tabs: readonly T[], fallback: T): [T, (t: T) => void] {
  const [params, setParams] = useSearchParams()
  const current = (params.get('tab') as T) ?? fallback
  const value = tabs.includes(current) ? current : fallback
  const set = useCallback(
    (t: T) =>
      setParams(
        (p) => {
          p.set('tab', t)
          return p
        },
        { replace: true },
      ),
    [setParams],
  )
  return [value, set]
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: string; count?: number }[]
  value: T
  onChange: (t: T) => void
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[15px] font-medium transition',
            value === t.id ? 'border-brand text-brand-ink' : 'border-transparent text-ink-3 hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-ink-3 tabular">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

/* ---------------- Toasts ---------------- */

interface Toast {
  id: number
  tone: Tone
  title: string
  body?: string
  action?: { label: string; to: string }
}
const ToastContext = createContext<(t: Omit<Toast, 'id'>) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random()
    setToasts((all) => [...all.slice(-3), { ...t, id }])
    window.setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.tone === 'bad' ? 9000 : 5500)
  }, [])
  return (
    <ToastContext value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 bottom-20 z-40 flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:items-end lg:bottom-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'bad' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm animate-rise items-start gap-3 rounded-xl border border-line bg-surface p-3 shadow-pop',
            )}
          >
            <ToneIcon tone={t.tone} />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">{t.title}</p>
              {t.body && <p className="whitespace-pre-line text-sm text-ink-2">{t.body}</p>}
              {t.action && (
                <Link to={t.action.to} className="mt-1 inline-block text-sm font-medium link">
                  {t.action.label}
                </Link>
              )}
            </div>
            <IconButton
              icon={XIcon}
              label="Dismiss"
              className="-m-1 size-8"
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
            />
          </div>
        ))}
      </div>
    </ToastContext>
  )
}

const TONE_ICON: Record<Tone, Icon> = {
  neutral: BellIcon,
  brand: BellIcon,
  ok: CheckCircleIcon,
  warn: WarningIcon,
  bad: WarningCircleIcon,
  info: InfoIcon,
}

function ToneIcon({ tone }: { tone: Tone }) {
  const IconCmp = TONE_ICON[tone]
  return <IconCmp className={cn('mt-0.5 size-5 shrink-0', TONE_TEXT[tone])} weight="fill" aria-hidden />
}

export function useToast() {
  return use(ToastContext)
}

/* ---------------- Numbers ---------------- */

/** Counts to the new value (transform-free, text only). Instant under reduced motion. */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const from = useRef(value)
  useEffect(() => {
    const el = ref.current
    const start = from.current
    from.current = value
    if (!el || start === value || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (el) el.textContent = String(value)
      return
    }
    let frame = 0
    const t0 = performance.now()
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 450)
      el.textContent = String(Math.round(start + (value - start) * (1 - (1 - p) ** 3)))
      if (p < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return (
    <span ref={ref} className={className}>
      {value}
    </span>
  )
}

export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
