import { defineConfig, devices } from '@playwright/test'

const DEV = 'http://localhost:5173'
const PROD = 'http://localhost:4173'
const PAGES = 'http://localhost:4174'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  // Real models run on CPU in these tests; a run can take well over the 30 s default when
  // workers compete for cores. CI runners have 2 cores, so run serially there.
  timeout: 180_000,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? DEV,
    trace: 'on-first-retry',
  },
  webServer: [
    { command: 'pnpm dev', url: DEV, reuseExistingServer: true, timeout: 120000 },
    { command: 'pnpm build && pnpm preview --port 4173 --strictPort', url: PROD, reuseExistingServer: true, timeout: 300000 },
    {
      command: 'pnpm exec vite build --mode pages --outDir dist-pages && pnpm exec vite preview --mode pages --outDir dist-pages --port 4174 --strictPort',
      url: PAGES,
      reuseExistingServer: true,
      timeout: 300000,
    },
  ],
  projects: [
    { name: 'chromium', testIgnore: /(prod|pages)\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', testIgnore: /(prod|pages)\.spec\.ts/, use: { ...devices['Pixel 5'] } },
    { name: 'prod', testMatch: /prod\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: PROD } },
    { name: 'pages', testMatch: /pages\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: PAGES } },
  ],
})
