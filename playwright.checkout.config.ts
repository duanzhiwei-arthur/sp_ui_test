import { defineConfig, devices } from '@playwright/test';

// Local fixture checks only: never part of production UI or generation suites.
export default defineConfig({
  testDir: './verification/checkout',
  workers: 1,
  retries: 0,
  timeout: 15_000,
  expect: { timeout: 1_000 },
  outputDir: 'test-results/checkout-locators',
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], channel: 'chromium' }
});
