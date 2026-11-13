import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: '*.spec.ts', workers: 1, retries: 0,
  outputDir: '../../test-results/canvas-assignment-verification', reporter: 'list', timeout: 65_000,
  use: { baseURL: 'https://jujubit.ai', channel: 'chromium', headless: true } });
