import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { ADMIN, API, BUSINESS, STAGE, WEB } from './fixtures';

// Browser tests for the reviewer app, the business dashboard, the stage and the admin console, run in the Microsoft
// Edge already on the machine (no browser download):  pnpm test:e2e
// They run their own copy of the stack on other ports (API 8799, apps 3100-3103), so `pnpm dev` can keep running:
// the API on e2e/test.env (in-memory chain and database, no model, no outside services), each app in its own build
// folder (.next/e2e), and the stage's demo agents scripted. A run is free and starts from the same data every time.

const app = (name: string, url: string, env: Record<string, string> = {}) => ({
  command: `pnpm --filter @receipts/${name} exec next dev --port ${new URL(url).port}`,
  url,
  env: { NEXT_DIST_DIR: '.next/e2e', NEXT_PUBLIC_API_URL: API, NEXT_PUBLIC_WEB_URL: WEB, NEXT_PUBLIC_MERCHANT_URL: BUSINESS, ...env },
  reuseExistingServer: true,
  timeout: 240_000,
});

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  outputDir: 'results',
  use: {
    channel: 'msedge',
    navigationTimeout: 120_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 860 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], channel: 'msedge' }, testMatch: /pages\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'pnpm --filter @receipts/api start',
      url: `${API}/health`,
      env: { ENV_FILE: fileURLToPath(new URL('test.env', import.meta.url)) },
      reuseExistingServer: true,
      timeout: 240_000,
    },
    app('web', WEB, { BUSINESS_ZONE_URL: 'http://localhost:3101' }),
    app('merchant', 'http://localhost:3101/business'),
    app('demo', STAGE, { RECEIPTS_API_URL: API, AGENT_LLM: 'offline' }),
    app('admin', ADMIN, { NEXT_PUBLIC_DEMO_URL: STAGE }),
  ],
});
