import { defineConfig } from '@playwright/test';
import path from 'node:path';

const target = process.env.CANVAS_PARITY_BASE_URL;
if (!target) throw new Error('设置CANVAS_PARITY_BASE_URL；真实分组模式不默认访问生产');
const url = new URL(target);
if (url.protocol !== 'https:' || url.username || url.password || !['jujubit.ai', 'www.jujubit.ai', 'jujubit-dev.myshopify.com'].includes(url.hostname)) throw new Error('真实分组模式仅支持明确的JuJuBit线上/开发店HTTPS地址');
const control = process.env.CANVAS_CONTROL_STABLE_ID?.trim();
const treatment = process.env.CANVAS_TREATMENT_STABLE_ID?.trim();
if (!control && !treatment) throw new Error('至少设置CANVAS_CONTROL_STABLE_ID或CANVAS_TREATMENT_STABLE_ID，不复用其他实验ID');
if (control && control === treatment) throw new Error('对照组与实验组stable_id不能相同');
export default defineConfig({
  workers: 1, fullyParallel: false, retries: 0, forbidOnly: true,
  timeout: 900_000, expect: { timeout: 120_000 },
  outputDir: path.resolve(__dirname, '../../test-results/canvas-stable'),
  reporter: [['list'], ['html', { outputFolder: process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ?? path.resolve(__dirname, '../../playwright-report/canvas-stable'), open: 'never' }],
    ['json', { outputFile: process.env.PLAYWRIGHT_RESULTS_FILE ?? path.resolve(__dirname, '../../test-results/canvas-stable-results.json') }]],
  use: { baseURL: url.origin, channel: 'chromium', headless: true,
    viewport: { width: 1440, height: 1000 }, storageState: { cookies: [], origins: [] },
    navigationTimeout: 60_000, actionTimeout: 30_000,
    screenshot: 'only-on-failure', trace: 'retain-on-failure', video: 'retain-on-failure' },
  projects: [
    ...(control ? [{ name: 'canvas-control', testDir: path.resolve(__dirname, '../../tests'),
      testMatch: ['00-safe-cases.spec.ts', 'full-flow-inventory.spec.ts', 'generation.spec.ts'],
      grep: /\bTC-0[0-5]:/, metadata: { canvasAssignment: { stableId: control, variant: 'control' } } }] : []),
    ...(treatment ? [{ name: 'canvas-treatment', testDir: __dirname, testMatch: 'daily-parity.spec.ts',
      metadata: { canvasAssignment: { stableId: treatment, variant: 'treatment' } } }] : []),
  ],
});
