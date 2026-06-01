import { defineConfig } from '@playwright/test'

// Electron end-to-end tests. These launch the *built* app (out/) via Electron's
// own Chromium, so no separate browser download is needed. Run with:
//   npm run test:e2e   (builds first, then runs)
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']]
})
