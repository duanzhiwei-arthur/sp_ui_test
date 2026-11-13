import { defineConfig } from '@playwright/test';
import stable from '../../experiments/canvas-v3/stable.config.js';
import path from 'node:path';

// Reuse the actual project's worker limits; browser traffic is entirely mocked.
export default defineConfig({
  ...stable, timeout: 30_000, outputDir: '../../test-results/canvas-parallel-verification',
  reporter: [['list'], ['json', { outputFile: path.resolve(__dirname, '../../test-results/canvas-parallel-verification.json') }]],
  use: { ...stable.use, headless: true, launchOptions: { slowMo: 0 }, trace: 'off', video: 'off' },
  projects: stable.projects?.map(project => ({ ...project, testDir: __dirname, testMatch: 'parallel.spec.ts', grep: undefined, metadata: {} })),
});
