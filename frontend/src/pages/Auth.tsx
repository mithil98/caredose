import { BellRingingIcon, CalendarCheckIcon, WarningCircleIcon, WifiHighIcon } from '@phosphor-icons/react'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Scene3D } from '../components/three/Scene3D'
import { Button, Field, Input, Select } from '../components/ui'
import { ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { browserTimezone, TIMEZONES } from '../lib/format'
import { dsEases, gsap, MOTION_OK, useGSAP, useParallax, useSplitReveal } from '../lib/motion'

const FEATURES = [
  { icon: CalendarCheckIcon, text: 'Morning, afternoon and night schedules in one calm view.' },
  { icon: BellRingingIcon, text: 'Alerts on your phone or computer when a dose is due or missed, even with the app closed.' },
  { icon: WifiHighIcon, text: 'See at a glance whether the dispenser at home is online.' },
]

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLElement>(null)
  const headline = useRef<HTMLParagraphElement>(null)
  useSplitReveal(headline, [], 0.15)
  useParallax(stage)
  useGSAP(
    () => {
      dsEases()
      gsap.matchMedia().add(MOTION_OK, () => {
        gsap.from('[data-auth-card]', { y: 36, autoAlpha: 0, duration: 1, ease: 'ds-emphasis', delay: 0.1 })
        gsap.from('[data-feature]', { x: -24, autoAlpha: 0, duration: 0.8, ease: 'ds-emphasis', stagger: 0.1, delay: 0.7 })
      })
    },
    { scope: root },
  )

  return (
    <div ref={root} className="grid min-h-[100dvh] bg-night lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <section
        ref={stage}
        className="relative isolate flex min-h-[19rem] flex-col justify-between gap-8 overflow-hidden bg-stage p-6 text-night-ink sm:p-10 lg:min-h-0 lg:pr-16"
      >
        <Scene3D variant="hero" className="absolute inset-0 -z-10" />
        {/* depth layers: soft glows drift with the pointer and scroll */}
        <div
          data-depth="0.5"
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-28 -z-10 size-[28rem] bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--g3)_45%,transparent),transparent)]"
        />
        <div
          data-depth="0.25"
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 -z-10 size-[26rem] bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--g1)_40%,transparent),transparent)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-r from-night/85 via-night/40 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-night/80 via-transparent to-transparent lg:hidden"
        />

        <div className="flex items-center gap-2.5">
          <img src="/icons/icon-192.png" alt="" width={36} height={36} className="size-9 rounded-lg ring-1 ring-white/20" />
          <span translate="no" className="text-lg font-semibold tracking-tight">
            Care<span className="text-aqua">Dose</span>
          </span>
        </div>
        <div className="max-w-xl">
          <p ref={headline} className="text-title font-semibold text-balance sm:text-display xl:text-[56px] xl:leading-[1.02]">
            Know each dose is taken, <span className="text-aqua">even when you are not in the room.</span>
          </p>
          <ul className="mt-8 hidden flex-col gap-4 text-[15px] text-night-ink-2 sm:flex">
            {FEATURES.map(({ icon: IconCmp, text }) => (
              <li key={text} data-feature className="flex items-start gap-3">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-g2 ring-1 ring-white/10">
                  <IconCmp className="size-[18px]" aria-hidden />
                </span>
                <span className="pt-1">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="hidden text-sm text-night-ink-2 lg:block">
          Medication information is entered by caretakers. CareDose does not give medical advice.
        </p>
      </section>
      <main className="relative z-10 flex items-center justify-center bg-canvas px-5 py-10 sm:px-10 lg:-ml-6 lg:rounded-l-2xl lg:shadow-pop">
        <div data-auth-card className="w-full max-w-sm">
          <h1 className="text-title font-semibold text-balance">{title}</h1>
          <p className="mt-1 text-ink-2">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  )
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg bg-bad-soft px-3 py-2.5 text-sm font-medium text-bad-ink">
      <WarningCircleIcon className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden />
      {error}
    </p>
  )
}

function useAfterAuth() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const next = params.get('next')
  return () => navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard', { replace: true })
}

export function LoginPage() {
  const { login } = useAuth()
  const done = useAfterAuth()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    try {
      await login(String(form.get('email')), String(form.get('password')))
      done()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle={
        <>
          New here?{' '}
          <Link to="/register" className="font-medium link">
            Create a caretaker account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate={false}>
        <FormError error={error} />
        <Field label="Email">{(p) => <Input {...p} name="email" type="email" autoComplete="email" spellCheck={false} required />}</Field>
        <Field label="Password">{(p) => <Input {...p} name="password" type="password" autoComplete="current-password" required />}</Field>
        <Button type="submit" loading={busy} className="mt-2 w-full">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  )
}

export function RegisterPage() {
  const { register } = useAuth()
  const done = useAfterAuth()
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const defaultTz = browserTimezone()

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    setFields({})
    try {
      await register({
        full_name: String(form.get('full_name')),
        email: String(form.get('email')),
        password: String(form.get('password')),
        timezone: String(form.get('timezone')),
      })
      done()
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        setFields(err.fields)
      } else setError('Could not create the account.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle={
        <>
          Already registered?{' '}
          <Link to="/login" className="font-medium link">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FormError error={error} />
        <Field label="Your name" error={fields.full_name}>
          {(p) => <Input {...p} name="full_name" autoComplete="name" required maxLength={120} />}
        </Field>
        <Field label="Email" error={fields.email}>
          {(p) => <Input {...p} name="email" type="email" autoComplete="email" spellCheck={false} required />}
        </Field>
        <Field label="Password" hint="At least 8 characters." error={fields.password}>
          {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />}
        </Field>
        <Field label="Your timezone" error={fields.timezone}>
          {(p) => (
            <Select {...p} name="timezone" defaultValue={TIMEZONES.includes(defaultTz) ? defaultTz : 'Asia/Kolkata'}>
              {TIMEZONES.map((tz) => (
                <option key={tz}>{tz}</option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" loading={busy} className="mt-2 w-full">
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}
