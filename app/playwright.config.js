/* Real-browser tier, for the one thing the Node/jsdom tests (roundtrip.mjs,
   sanitize-probe.mjs, tests/unit) structurally cannot cover: the pagination
   engine (measurePages in App.svelte) reads real layout — offsetTop,
   getBoundingClientRect, CSS transitions — none of which jsdom implements.
   Session 35 shipped a pagination bug (page measured mid-transition, so
   breaks were computed at the wrong width) that only a real browser could
   have caught. See tests/e2e/pagination.spec.js.

   Chromium only: the app ships on Windows via WebView2 (Chromium-based), so
   one real engine is the one that matters here — not cross-browser coverage. */
import { defineConfig, devices } from '@playwright/test'

const PORT = 5173 // vite.config.js's fixed dev port (Tauri expects it fixed)

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${PORT}`,
    // Reuse a dev server the author already has running locally (fast
    // iteration); CI always starts clean so a stale/wedged server can't
    // silently pass a run.
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
