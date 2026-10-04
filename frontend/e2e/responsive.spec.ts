import { expect, test } from '@playwright/test'

/** Layout checks per breakpoint: right navigation pattern, no sideways scrolling, key content visible. */

const API = 'http://127.0.0.1:8000/api/v1'
const email = `resp-${Date.now().toString(36)}@example.com`
const password = 'responsive-pass-1'

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844, nav: 'bottom' },
  { name: 'tablet', width: 820, height: 1180, nav: 'rail' },
  { name: 'laptop', width: 1280, height: 800, nav: 'sidebar' },
  { name: 'desktop', width: 1920, height: 1080, nav: 'sidebar' },
] as const

const PAGES = ['/dashboard', '/patients', '/schedules', '/devices', '/history', '/notifications', '/settings']

test.beforeAll(async ({ request }) => {
  const r = await request.post(`${API}/auth/register`, { data: { email, password, full_name: 'Meera Iyer', timezone: 'Asia/Kolkata' } })
  const token = (await r.json()).access_token
  const headers = { Authorization: `Bearer ${token}` }
  const patient = await (
    await request.post(`${API}/patients`, { headers, data: { full_name: 'Gopal Iyer With A Rather Long Name' } })
  ).json()
  const med = await (
    await request.post(`${API}/patients/${patient.id}/medicines`, {
      headers,
      data: { name: 'Long-named evening medicine 500', dose_quantity: 2, dose_unit: 'tablet' },
    })
  ).json()
  await request.post(`${API}/patients/${patient.id}/schedules`, {
    headers,
    data: { medicine_id: med.id, time_of_day: '23:30', period: 'night', days_of_week: [1, 2, 3, 4, 5, 6, 7] },
  })
})

for (const vp of VIEWPORTS) {
  test(`${vp.name} layout`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL('**/dashboard')

    for (const path of PAGES) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0)
    }

    const bottomNav = page.locator('nav.fixed[aria-label="Main"]')
    const sidebar = page.locator('aside')
    if (vp.nav === 'bottom') {
      await expect(bottomNav).toBeVisible()
      await expect(sidebar).toBeHidden()
      await bottomNav.getByRole('button', { name: 'More' }).click()
      await expect(page.getByRole('dialog', { name: 'More' }).getByRole('link', { name: 'Devices' })).toBeVisible()
    } else {
      await expect(bottomNav).toBeHidden()
      await expect(sidebar).toBeVisible()
      const width = (await sidebar.boundingBox())!.width
      expect(vp.nav === 'rail' ? width < 120 : width > 200).toBe(true)
    }
  })
}

test('dark mode uses dark surfaces', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/login')
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).toBe('rgb(10, 26, 48)') // dark canvas
})
