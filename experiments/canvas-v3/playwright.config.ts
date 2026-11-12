import { defineConfig } from '@playwright/test';
import path from 'node:path';
const target = process.env.CANVAS_PARITY_BASE_URL;
if (!target) throw new Error('显式设置 CANVAS_PARITY_BASE_URL；不默认测试生产');
const url = new URL(target);
if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname.endsWith('.shopifypreview.com') || url.hostname === 'jujubit-dev.myshopify.com')) throw new Error('仅允许Preview或授权开发店');
export default defineConfig({
  testDir: '.', testMatch: 'daily-parity.spec.ts', workers: 1, fullyParallel: false,
  retries: 0, forbidOnly: true, timeout: 900_000, expect: { timeout: 20_000 },
  outputDir: path.resolve(__dirname, '../../test-results/canvas-v3'),
  reporter: [['list'], ['json', { outputFile: process.env.PLAYWRIGHT_RESULTS_FILE ?? path.resolve(__dirname, '../../test-results/canvas-v3-results.json') }]],
  use: { baseURL: url.origin, headless: true, viewport: { width: 1440, height: 1000 },
    navigationTimeout: 60_000, actionTimeout: 20_000, trace: 'off', video: 'off', screenshot: 'only-on-failure' },
  projects: [{ name: 'canvas-v3-109-with-trust', metadata: { baseline: 'scheduled TC-01..TC-05', canvas_v3_109: true, canvas_trust_info: true } }],
});
