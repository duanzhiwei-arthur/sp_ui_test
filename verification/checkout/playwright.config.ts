import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'checkout.spec.ts',
  outputDir: '../../test-results/checkout-verification',
  workers: 1,
  retries: 0,
  timeout: 10_000,
  expect: { timeout: 500 },
  reporter: 'list',
  use: { channel: 'chromium', headless: true }
});
