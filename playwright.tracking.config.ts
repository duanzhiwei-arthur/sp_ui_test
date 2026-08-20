import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

export default defineConfig({
  testDir: './tests/tracking',
  outputDir: './test-results/tracking',
  fullyParallel: false,
  workers: 1,
  timeout: 900_000,
  expect: { timeout: 300_000 },
  reporter: [['html', { open: 'never', outputFolder: 'playwright-tracking-report' }], ['list']],
  use: {
    baseURL: process.env.TRACKING_BASE_URL,
    channel: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 300_000,
    navigationTimeout: 300_000
  },
  projects: [{ name: 'tracking-chromium', use: { ...devices['Desktop Chrome'] } }]
});
