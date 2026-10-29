import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'generation.spec.ts',
  outputDir: '../../test-results/generation-verification', workers: 1, retries: 0,
  timeout: 15_000, reporter: 'list', use: { channel: 'chromium', headless: true }, expect: { timeout: 1_000 } });
