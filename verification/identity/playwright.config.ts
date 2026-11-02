import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'identity.spec.ts',
  outputDir: '../../test-results/identity-verification', retries: 0, workers: 1,
  timeout: 30_000, reporter: 'list', use: { baseURL: 'https://jujubit.ai', channel: 'chromium', headless: true },
  expect: { timeout: 2_000 } });
