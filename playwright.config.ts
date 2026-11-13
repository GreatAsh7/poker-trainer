import { defineConfig } from '@playwright/test';

// Uses the locally installed Google Chrome (no browser download needed).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  use: { channel: 'chrome', baseURL: 'http://localhost:5199', viewport: { width: 1600, height: 900 } },
  webServer: { command: 'npm run dev', url: 'http://localhost:5199', reuseExistingServer: true, timeout: 60_000 },
  reporter: [['list']],
});
