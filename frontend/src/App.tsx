import { CompassIcon } from '@phosphor-icons/react'
import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router'
import AppShell, { SIMULATOR_ENABLED } from './components/AppShell'
import { buttonClass, EmptyState, LoadingBlock, ToastProvider } from './components/ui'
import { useAuth } from './lib/auth'
import { LiveProvider } from './lib/realtime'
import Dashboard from './pages/Dashboard'
import { LoginPage, RegisterPage } from './pages/Auth'

const Patients = lazy(() => import('./pages/Patients'))
const PatientDetail = lazy(() => import('./pages/PatientDetail'))
const Medicines = lazy(() => import('./pages/Medicines'))
const Schedules = lazy(() => import('./pages/Schedules'))
const Devices = lazy(() => import('./pages/Devices'))
const DeviceDetail = lazy(() => import('./pages/DeviceDetail'))
const History = lazy(() => import('./pages/History'))
const Notifications = lazy(() => import('./pages/Notifications'))
const Settings = lazy(() => import('./pages/Settings'))
const Simulator = lazy(() => import('./pages/Simulator'))
const AdminSystem = lazy(() => import('./pages/admin/System'))
const AdminUsers = lazy(() => import('./pages/admin/Users'))
const AdminAudit = lazy(() => import('./pages/admin/Audit'))

function Splash() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center" role="status">
      <img src="/favicon.svg" alt="" width={40} height={40} className="size-10 animate-pulse" />
      <span className="sr-only">Loading CareDose…</span>
    </div>
  )
}

function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { user, ready } = useAuth()
  const location = useLocation()
  if (!ready) return <Splash />
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (admin && user.role !== 'admin') return <Navigate to="/dashboard" replace />
  return children
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  if (!ready) return <Splash />
  return user ? <Navigate to="/dashboard" replace /> : children
}

function NotFound() {
  return (
    <EmptyState
      icon={CompassIcon}
      title="Page not found"
      action={
        <Link to="/dashboard" className={buttonClass()}>
          Go to today's overview
        </Link>
      }
    >
      The page you were looking for does not exist or has moved.
    </EmptyState>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route
            path="/login"
            element={
              <PublicOnly>
                <LoginPage />
              </PublicOnly>
            }
          />
          <Route
            path="/register"
            element={
              <PublicOnly>
                <RegisterPage />
              </PublicOnly>
            }
          />
          <Route
            element={
              <RequireAuth>
                <LiveProvider>
                  <AppShell />
                </LiveProvider>
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="*" element={<Lazy />} />
          </Route>
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  )
}

/** Code-split pages, rendered inside the shell. */
function Lazy() {
  return (
    <Suspense fallback={<LoadingBlock rows={4} label="Loading page" />}>
      <Routes>
        <Route path="patients" element={<Patients />} />
        <Route path="patients/:id" element={<PatientDetail />} />
        <Route path="medicines" element={<Medicines />} />
        <Route path="schedules" element={<Schedules />} />
        <Route path="devices" element={<Devices />} />
        <Route path="devices/:uid" element={<DeviceDetail />} />
        <Route path="history" element={<History />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="settings" element={<Settings />} />
        {SIMULATOR_ENABLED && <Route path="dev/simulator" element={<Simulator />} />}
        <Route
          path="admin"
          element={
            <RequireAuth admin>
              <AdminSystem />
            </RequireAuth>
          }
        />
        <Route
          path="admin/users"
          element={
            <RequireAuth admin>
              <AdminUsers />
            </RequireAuth>
          }
        />
        <Route
          path="admin/audit"
          element={
            <RequireAuth admin>
              <AdminAudit />
            </RequireAuth>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
