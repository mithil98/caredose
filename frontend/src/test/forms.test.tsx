import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MedicineDialog, PatientDialog, ScheduleDialog } from '../components/forms'
import type { Medicine, Patient } from '../types/api'
import { mockApi, renderApp, signedIn } from './utils'

beforeEach(() => vi.unstubAllGlobals())

const patient: Patient = {
  id: 7,
  full_name: 'Rahul',
  date_of_birth: null,
  contact_phone: null,
  notes: null,
  timezone: 'Asia/Kolkata',
  is_active: true,
  created_at: '2026-10-01T00:00:00Z',
  caretaker: { id: 1, full_name: 'Asha Verma' },
  devices: [],
  medicine_count: 1,
  today: { scheduled: 0, taken: 0, missed: 0, late: 0, pending: 0, total: 0, adherence: null },
}

const medicine: Medicine = {
  id: 2,
  patient_id: 7,
  patient_name: 'Rahul',
  name: 'Medicine C',
  generic_name: null,
  dose_quantity: '1.00',
  dose_unit: 'tablet',
  instructions: null,
  is_active: true,
  schedule_count: 0,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
}

describe('Patient management', () => {
  it('creates a patient with only basic details', async () => {
    const calls = mockApi({ ...signedIn, 'POST /patients': (body) => ({ status: 201, json: { ...patient, ...(body as object) } }) })
    const onClose = vi.fn()
    renderApp(<PatientDialog open onClose={onClose} />)
    await userEvent.type(await screen.findByLabelText('Full name'), 'Rahul')
    await userEvent.type(screen.getByLabelText(/Contact phone/), '+91 98765 43210')
    await userEvent.click(screen.getByRole('button', { name: 'Add patient' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const body = calls.find((c) => c.method === 'POST' && c.path === '/patients')!.body as Record<string, unknown>
    expect(body).toMatchObject({ full_name: 'Rahul', contact_phone: '+91 98765 43210', date_of_birth: null, notes: null })
    expect(body.timezone).toBe('Asia/Kolkata')
  })
})

describe('Medicine creation', () => {
  it('posts the medicine for the patient', async () => {
    const calls = mockApi({ ...signedIn, 'GET /patients': [patient], 'POST /patients/7/medicines': { status: 201, json: medicine } })
    const onClose = vi.fn()
    renderApp(<MedicineDialog open onClose={onClose} patientId={7} />)
    await userEvent.type(await screen.findByLabelText('Medicine name'), 'Medicine C')
    await userEvent.type(screen.getByLabelText(/Instructions/), 'After food')
    await userEvent.click(screen.getByRole('button', { name: 'Add medicine' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(calls.find((c) => c.path === '/patients/7/medicines')!.body).toEqual({
      name: 'Medicine C',
      generic_name: null,
      dose_quantity: '1',
      dose_unit: 'tablet',
      instructions: 'After food',
      is_active: true,
    })
  })

  it('shows validation errors next to the field', async () => {
    mockApi({
      ...signedIn,
      'POST /patients/7/medicines': {
        status: 422,
        json: { detail: [{ loc: ['body', 'name'], msg: 'Value error, This field is required' }] },
      },
    })
    renderApp(<MedicineDialog open onClose={() => {}} patientId={7} />)
    await userEvent.type(await screen.findByLabelText('Medicine name'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Add medicine' }))
    expect(await screen.findByText('This field is required')).toBeInTheDocument()
    expect(screen.getByLabelText('Medicine name')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('Schedule creation', () => {
  it('suggests the part of day from the time and sends the chosen days', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /patients': [patient],
      'GET /medicines': [medicine],
      'POST /patients/7/schedules': (body) => ({
        status: 201,
        json: { id: 1, patient_name: 'Rahul', medicine_name: 'Medicine C', ...(body as object) },
      }),
    })
    const onClose = vi.fn()
    renderApp(<ScheduleDialog open onClose={onClose} patientId={7} />)
    await waitFor(() => expect(screen.getByLabelText('Medicine')).toHaveValue('2'))

    const time = screen.getByLabelText('Time')
    await userEvent.clear(time)
    await userEvent.type(time, '20:00')
    expect(screen.getByRole('radio', { name: 'Night' })).toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: 'Weekdays' }))
    expect(screen.getByRole('button', { name: /Sat/ })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Create schedule' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(calls.find((c) => c.path === '/patients/7/schedules')!.body).toMatchObject({
      medicine_id: 2,
      time_of_day: '20:00',
      period: 'night',
      days_of_week: [1, 2, 3, 4, 5],
      is_active: true,
    })
  })

  it('cannot be saved without any day selected', async () => {
    mockApi({ ...signedIn, 'GET /patients': [patient], 'GET /medicines': [medicine] })
    renderApp(<ScheduleDialog open onClose={() => {}} patientId={7} />)
    await waitFor(() => expect(screen.getByLabelText('Medicine')).toHaveValue('2'))
    for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
      await userEvent.click(screen.getByRole('button', { name: new RegExp(d) }))
    expect(screen.getByText('Choose at least one day.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create schedule' })).toBeDisabled()
  })
})
