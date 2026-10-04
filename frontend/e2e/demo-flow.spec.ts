import { expect, test, type Page } from '@playwright/test'

/**
 * PRD section 41 "Definition of Done", end to end with a real browser and a real push service:
 * caretaker sets everything up, enables push, closes the app; a device event sent over the
 * hardware HTTP contract produces a stored event, a notification and an actual Web Push that
 * the closed app's service worker displays. Opening its URL lands on the patient + dose.
 */

const API = 'http://127.0.0.1:8000/api/v1'
const run = Date.now().toString(36).toUpperCase()
const email = `e2e-${run.toLowerCase()}@example.com`
const password = 'e2e-password-1'
const deviceUid = `MED-E2E-${run}`.slice(0, 32)

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard')
}

test('caretaker demo flow: setup, closed-app push notification, deep link', async ({ browser }) => {
  const caretaker = await browser.newContext()
  const page = await caretaker.newPage()

  // 1. Caretaker registers and lands on the dashboard
  await page.goto('/register')
  await page.getByLabel('Your name').fill('Asha Verma')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByLabel('Your timezone').selectOption('Asia/Kolkata')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Asha/ })).toBeVisible()
  await expect(page.getByText("Let's set things up")).toBeVisible()

  // 2. Create patient
  await page.goto('/patients')
  await page.getByRole('button', { name: 'Add patient' }).first().click()
  const patientDialog = page.getByRole('dialog', { name: 'Add a patient' })
  await patientDialog.getByLabel('Full name').fill('Rahul')
  await patientDialog.getByLabel('Timezone').selectOption('Asia/Kolkata')
  await patientDialog.getByRole('button', { name: 'Add patient' }).click()
  await page.getByRole('link', { name: 'Rahul' }).first().click()
  await expect(page.getByRole('heading', { name: 'Rahul', level: 1 })).toBeVisible()
  const patientId = page.url().match(/patients\/(\d+)/)![1]

  // 3. Add medicine
  await page.getByRole('tab', { name: /Medicines/ }).click()
  await page.getByRole('button', { name: 'Add medicine' }).click()
  const medDialog = page.getByRole('dialog', { name: 'Add a medicine' })
  await medDialog.getByLabel('Medicine name').fill('Medicine C')
  await medDialog.getByLabel('Dose per intake').fill('1')
  await medDialog.getByLabel('Instructions').fill('After dinner')
  await medDialog.getByRole('button', { name: 'Add medicine' }).click()
  await expect(page.getByText('Medicine C').first()).toBeVisible()

  // 4. Create the 8:00 PM schedule
  await page.getByRole('tab', { name: /Schedule/ }).click()
  await page.getByRole('button', { name: 'Create schedule' }).click()
  const schedDialog = page.getByRole('dialog', { name: 'New schedule' })
  await schedDialog.getByLabel('Medicine').selectOption({ label: 'Medicine C' })
  await schedDialog.getByLabel('Time').fill('20:00')
  await expect(schedDialog.getByRole('radio', { name: 'Night' })).toBeChecked()
  await schedDialog.getByRole('button', { name: 'Create schedule' }).click()
  await expect(page.getByRole('button', { name: /Edit Medicine C at 8:00/ })).toBeVisible()

  // 5. Register MED device; the key is shown exactly once
  await page.getByRole('tab', { name: 'Device' }).click()
  await page.getByRole('button', { name: 'Register dispenser' }).click()
  const devDialog = page.getByRole('dialog', { name: 'Register a dispenser' })
  await devDialog.getByLabel('Device ID').fill(deviceUid)
  await devDialog.getByRole('button', { name: 'Register device' }).click()
  const deviceKey = (await page.getByRole('dialog', { name: 'Device registered' }).locator('code').textContent())!.trim()
  expect(deviceKey).toMatch(/^dk_/)
  await page.getByRole('button', { name: 'Done' }).click()

  // 6. Enable browser notifications (real Web Push subscription with Mozilla's push service)
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Turn on alerts' }).click()
  await expect(page.getByText('Alerts turned on for this device')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('1 browser is registered for your alerts.')).toBeVisible()

  // 7. Caretaker closes the web app (no CareDose page open; the browser keeps running)
  await page.close()

  // 8-9. The "device" (CLI simulator / future SIM800L) posts events over the hardware contract
  const http = caretaker.request
  const scheduleId = await (async () => {
    const cfg = await http.get(`${API}/devices/${deviceUid}/config`, { headers: { 'X-Device-Key': deviceKey } })
    expect(cfg.ok()).toBeTruthy()
    return (await cfg.json()).schedules[0].schedule_id as number
  })()
  const event = {
    event_id: `e2e-${run}-dispense`,
    device_id: deviceUid,
    event_type: 'medicine_dispensed',
    schedule_id: scheduleId,
    event_time: new Date().toISOString(),
    metadata: { slot: 'night' },
  }
  const sent = await http.post(`${API}/device-events`, { headers: { 'X-Device-Key': deviceKey }, data: event })
  expect(sent.status()).toBe(201)
  const body = await sent.json()
  expect(body.result).toBe('applied')
  expect(body.dose_status).toBe('dispensed')

  // SIM800L-style retry with the same event_id is stored once
  const retry = await http.post(`${API}/device-events`, { headers: { 'X-Device-Key': deviceKey }, data: event })
  expect(retry.status()).toBe(200)
  expect((await retry.json()).duplicate).toBe(true)

  // 10-12. Backend stored the event and generated + pushed the notification
  const login = await http.post(`${API}/auth/login`, { data: { email, password } })
  const token = (await login.json()).access_token
  await expect
    .poll(
      async () => {
        const r = await http.get(`${API}/notifications`, { headers: { Authorization: `Bearer ${token}` } })
        const n = (await r.json()).items.find((x: { type: string }) => x.type === 'medicine_dispensed')
        return n ? { sent: n.push_sent, error: n.push_error } : null
      },
      { timeout: 30_000 },
    )
    .toEqual({ sent: 1, error: null })

  // 13. The closed app's service worker received the push and showed an OS notification
  const check = await caretaker.newPage()
  await check.goto('/notifications')
  // The push travels through Mozilla's public push service, so allow it a few seconds to land.
  const readShown = () =>
    check.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready
      return (await reg.getNotifications()).map((n) => ({ title: n.title, body: n.body, url: (n.data as { url: string }).url }))
    })
  await expect.poll(async () => (await readShown()).some((n) => n.title.includes('Medicine Dispensed')), { timeout: 30_000 }).toBe(true)
  const shown = await readShown()
  const dispensed = shown.find((n) => n.title.includes('Medicine Dispensed'))
  expect(dispensed, `notifications shown: ${JSON.stringify(shown)}`).toBeTruthy()
  expect(dispensed!.body).toContain("Rahul's night medicine was dispensed")
  expect(dispensed!.url).toMatch(new RegExp(`^/patients/${patientId}\\?dose=\\d+$`))

  // 14. Opening the notification target (what notificationclick does) shows the patient + dose
  await check.goto(dispensed!.url)
  await expect(check.getByRole('heading', { name: 'Rahul', level: 1 })).toBeVisible()
  await expect(check.getByText(/Medicine C, 1 tablet at 8:00 PM/)).toBeVisible()
  await expect(check.locator('#dose-' + dispensed!.url.split('dose=')[1])).toBeVisible()

  // Live dashboard reflects the next event over WebSocket, without a reload
  const doseRow = check.locator('#dose-' + dispensed!.url.split('dose=')[1])
  await check.goto('/dashboard')
  await expect(check.getByText('Live updates: Live')).toBeVisible()
  await expect(doseRow).toContainText('Dispensed')
  await http.post(`${API}/device-events`, {
    headers: { 'X-Device-Key': deviceKey },
    data: { ...event, event_id: `e2e-${run}-taken`, event_type: 'medicine_taken' },
  })
  await expect(doseRow).toContainText('Taken')
  await expect(check.getByText('Dose confirmed').first()).toBeVisible()

  await caretaker.close()
})
