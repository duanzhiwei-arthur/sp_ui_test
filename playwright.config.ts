import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

export default defineConfig({
  testDir: './tests',
  testIgnore: process.env.TRACKING_TEST_ENABLED === 'true' ? [] : '**/tracking/**',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // Production generation is not retried: a failed attempt may already have
  // created a billable task. Safe checks may still retry in CI.
  retries: process.env.CI && process.env.ALLOW_PRODUCTION_GENERATION !== 'true' ? 1 : 0,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 120_000 },
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }]
  ],
  use: {
    baseURL: process.env.BASE_URL ?? 'https://jujubit.ai',
    // The installed Chromium bundle is used directly; it avoids a separate
    // headless-shell download in scheduled macOS runs.
    channel: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 120_000,
    navigationTimeout: 300_000
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
