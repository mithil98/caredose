import { PencilSimpleIcon, PlusIcon, UserGearIcon } from '@phosphor-icons/react'
import { useState, type FormEvent } from 'react'
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Panel,
  Select,
  Switch,
  useToast,
} from '../../components/ui'
import { post, put } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { fmtDate, TIMEZONES } from '../../lib/format'
import { useAdminUsers, useSave } from '../../lib/queries'
import type { AdminUser } from '../../types/api'

function UserDialog({ open, onClose, user }: { open: boolean; onClose: () => void; user?: AdminUser }) {
  const toast = useToast()
  const { user: me } = useAuth()
  const [active, setActive] = useState(user?.is_active ?? true)
  const save = useSave(
    (body: Record<string, unknown>) => (user ? put<AdminUser>(`/admin/users/${user.id}`, body) : post<AdminUser>('/admin/users', body)),
    {
      invalidate: [['admin', 'users']],
      onSuccess: (u) => {
        toast({ tone: 'ok', title: user ? 'Account updated' : 'Account created', body: u.email })
        onClose()
      },
    },
  )
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const password = String(f.get('password') ?? '')
    save.mutate(
      user
        ? { full_name: f.get('full_name'), role: f.get('role'), is_active: active, password: password || null }
        : { full_name: f.get('full_name'), email: f.get('email'), role: f.get('role'), password, timezone: f.get('timezone') },
    )
  }
  const self = user?.id === me?.id
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={user ? `Edit ${user.full_name}` : 'Create account'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" loading={save.isPending}>
            {user ? 'Save changes' : 'Create account'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} className="flex flex-col gap-4" onReset={() => setActive(user?.is_active ?? true)}>
        {save.formError && (
          <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm font-medium text-bad-ink">
            {save.formError}
          </p>
        )}
        <Field label="Full name" error={save.fields.full_name}>
          {(p) => <Input {...p} name="full_name" defaultValue={user?.full_name} required />}
        </Field>
        {!user && (
          <Field label="Email" error={save.fields.email}>
            {(p) => <Input {...p} name="email" type="email" required autoComplete="off" spellCheck={false} />}
          </Field>
        )}
        <Field label="Role">
          {(p) => (
            <Select {...p} name="role" defaultValue={user?.role ?? 'caretaker'} disabled={self}>
              <option value="caretaker">Caretaker</option>
              <option value="admin">Administrator</option>
            </Select>
          )}
        </Field>
        <Field
          label={user ? 'New password' : 'Temporary password'}
          optional={!!user}
          hint="At least 8 characters. Share it securely."
          error={save.fields.password}
        >
          {(p) => <Input {...p} name="password" type="password" minLength={8} required={!user} autoComplete="new-password" />}
        </Field>
        {!user && (
          <Field label="Timezone">
            {(p) => (
              <Select {...p} name="timezone" defaultValue="Asia/Kolkata">
                {TIMEZONES.map((tz) => (
                  <option key={tz}>{tz}</option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {user && !self && <Switch checked={active} onChange={setActive} label="Active" description="Inactive accounts cannot sign in." />}
      </form>
    </Dialog>
  )
}

export default function AdminUsers() {
  const { data, error, isPending, refetch } = useAdminUsers(true)
  const [editing, setEditing] = useState<AdminUser | undefined>()
  const [open, setOpen] = useState(false)
  return (
    <>
      <PageHeader
        title="Accounts"
        description="Caretaker and administrator accounts."
        actions={
          <Button icon={PlusIcon} onClick={() => (setEditing(undefined), setOpen(true))}>
            Create account
          </Button>
        }
      />
      <Panel bodyClass="px-0 sm:px-0 pb-0 pt-0">
        {isPending ? (
          <div className="p-4">
            <LoadingBlock />
          </div>
        ) : error ? (
          <div className="p-4">
            <ErrorState error={error} onRetry={refetch} />
          </div>
        ) : !data.length ? (
          <EmptyState icon={UserGearIcon} title="No accounts" />
        ) : (
          <ul className="divide-y divide-line">
            {data.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <span
                  className="inline-flex size-9 items-center justify-center rounded-2xl bg-brand-soft font-semibold text-brand-ink"
                  aria-hidden
                >
                  {u.full_name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {u.full_name} {!u.is_active && <Badge>Inactive</Badge>}
                  </p>
                  <p className="truncate text-sm text-ink-3">{u.email}</p>
                </div>
                <Badge tone={u.role === 'admin' ? 'info' : 'neutral'}>{u.role === 'admin' ? 'Administrator' : 'Caretaker'}</Badge>
                <span className="hidden w-40 text-sm text-ink-2 sm:block">
                  {u.patient_count} patient{u.patient_count === 1 ? '' : 's'}, {u.device_count} device{u.device_count === 1 ? '' : 's'}
                </span>
                <span className="hidden w-32 text-sm text-ink-3 lg:block">
                  {u.last_login_at ? `Seen ${fmtDate(u.last_login_at)}` : 'Never signed in'}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={PencilSimpleIcon}
                  onClick={() => (setEditing(u), setOpen(true))}
                  aria-label={`Edit ${u.full_name}`}
                >
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <UserDialog key={editing?.id ?? 'new'} open={open} onClose={() => setOpen(false)} user={editing} />
    </>
  )
}
