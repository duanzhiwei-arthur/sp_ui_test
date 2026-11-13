import { defineConfig } from '@playwright/test';
import path from 'node:path';
import stable from './stable.config.js';

// Manual full inventory. The hourly suite continues to use stable.config.ts.
export default defineConfig(stable, {
  projects: [...(stable.projects ?? []), {
    name: 'other-cases', workers: 1,
    testDir: path.resolve(__dirname, '../../tests'),
    testMatch: ['home-clickable.spec.ts', 'zz-experiments/membership-banner.spec.ts'],
  }],
});
