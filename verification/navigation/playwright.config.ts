import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'navigation.spec.ts',
  outputDir: '../../test-results/navigation-verification', workers: 1, retries: 0,
  timeout: 15_000, reporter: 'list', use: { channel: 'chromium', headless: true }, expect: { timeout: 1_000 } });
