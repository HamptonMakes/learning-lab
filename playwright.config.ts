import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
const BROWSERS = (process.env.PW_BROWSERS ?? 'chromium,firefox,webkit').split(',')
const baseURL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  },
  webServer: {
    command: `pnpm preview --host 127.0.0.1 --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    // PW_BROWSERS=chromium,webkit narrows the behaviour projects (Firefox cannot launch on some
    // locked-down macOS setups); the default runs all three.
    ...(['chromium', 'firefox', 'webkit'] as const)
      .filter((b) => BROWSERS.includes(b))
      .map((b) => ({
        name: b,
        testIgnore: /verify\//,
        use: {
          ...devices[
            b === 'chromium'
              ? 'Desktop Chrome'
              : b === 'firefox'
                ? 'Desktop Firefox'
                : 'Desktop Safari'
          ],
        },
      })),
    {
      name: 'verify',
      testMatch: /verify\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
})
