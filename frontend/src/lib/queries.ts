import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { AdminUser, Device, Medicine, Patient, Schedule } from '../types/api'
import { ApiError, get } from './api'

export const usePatients = () => useQuery({ queryKey: ['patients'], queryFn: () => get<Patient[]>('/patients') })

export const useMedicines = (patientId?: number) =>
  useQuery({
    queryKey: ['medicines', patientId ?? 'all'],
    queryFn: () => get<Medicine[]>('/medicines', { patient_id: patientId }),
  })

export const useSchedules = (patientId?: number) =>
  useQuery({
    queryKey: ['schedules', patientId ?? 'all'],
    queryFn: () => get<Schedule[]>('/schedules', { patient_id: patientId }),
  })

export const useDevices = () => useQuery({ queryKey: ['devices'], queryFn: () => get<Device[]>('/devices') })

export const useAdminUsers = (enabled: boolean) =>
  useQuery({ queryKey: ['admin', 'users'], queryFn: () => get<AdminUser[]>('/admin/users'), enabled })

/** Mutation that exposes field-level validation errors from the API. */
export function useSave<TIn, TOut>(
  fn: (input: TIn) => Promise<TOut>,
  opts: { onSuccess?: (out: TOut) => void; invalidate?: string[][] } = {},
) {
  const qc = useQueryClient()
  const [fields, setFields] = useState<Record<string, string>>({})
  const m = useMutation({
    mutationFn: fn,
    onMutate: () => setFields({}),
    onSuccess: (out) => {
      for (const key of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      opts.onSuccess?.(out)
    },
    onError: (e) => {
      if (!(e instanceof ApiError)) return
      setFields(e.fields)
      // Move focus to the first invalid field once it re-renders.
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('dialog[open] [aria-invalid="true"], main [aria-invalid="true"]')?.focus(),
      )
    },
  })
  const formError =
    m.error && !(m.error instanceof ApiError && Object.keys(m.error.fields).length)
      ? m.error.message
      : m.error
        ? 'Please check the highlighted fields.'
        : null
  return { ...m, fields, formError, reset: () => (setFields({}), m.reset()) }
}
