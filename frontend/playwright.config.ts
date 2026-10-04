import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests. Needs the backend on :8000 (with VAPID keys) and Postgres running;
 * the Vite dev server is started automatically.
 *
 * Push delivery is tested in Firefox: automated Chrome/Edge profiles cannot register with
 * FCM/WNS, while Firefox talks to Mozilla's public push service.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'firefox-push',
      testMatch: /demo-flow/,
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            'dom.push.enabled': true,
            'dom.push.connection.enabled': true,
            'dom.push.serverURL': 'wss://push.services.mozilla.com/',
            'permissions.default.desktop-notification': 1,
          },
        },
      },
    },
    {
      name: 'chrome-responsive',
      testMatch: /responsive/,
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
})
