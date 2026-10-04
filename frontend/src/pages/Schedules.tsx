import { useState } from 'react'
import { ScheduleBoard } from '../components/ScheduleBoard'
import { Field, PageHeader, Select } from '../components/ui'
import { usePatients } from '../lib/queries'

export default function Schedules() {
  const patients = usePatients().data ?? []
  const [patientId, setPatientId] = useState<number | undefined>()
  return (
    <>
      <PageHeader title="Schedules" description="Each day at a glance. Select a schedule to change its time, dose or days." />
      {patients.length > 1 && (
        <div className="mb-4 max-w-xs">
          <Field label="Patient">
            {(p) => (
              <Select {...p} value={patientId ?? ''} onChange={(e) => setPatientId(e.target.value ? Number(e.target.value) : undefined)}>
                <option value="">All patients</option>
                {patients.map((pt) => (
                  <option key={pt.id} value={pt.id}>
                    {pt.full_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      )}
      <ScheduleBoard key={patientId ?? 'all'} patientId={patientId} showPatient={!patientId && patients.length > 1} />
    </>
  )
}
