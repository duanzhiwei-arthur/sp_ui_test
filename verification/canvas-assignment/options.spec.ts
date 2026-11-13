import { test, expect } from '@playwright/test';
import { canvasRunOptions } from '../../experiments/canvas-v3/run-options.js';

test('headed local defaults to 1.5s demonstration speed; CI/headless remain fast and serial', () => {
  expect(canvasRunOptions({}, ['playwright','--headed'])).toEqual({ slowMo: 1500, workers: 1 });
  expect(canvasRunOptions({}, ['playwright'])).toEqual({ slowMo: 0, workers: 1 });
  expect(canvasRunOptions({ CI: 'true' }, ['playwright','--headed'])).toEqual({ slowMo: 0, workers: 1 });
  expect(canvasRunOptions({ UI_ACTION_DELAY_MS: '0' }, ['playwright','--headed'])).toEqual({ slowMo: 0, workers: 1 });
});
test('two-group parallelism is opt-in and invalid options fail early', () => {
  expect(canvasRunOptions({ CANVAS_PARALLEL_GROUPS: 'true', UI_ACTION_DELAY_MS: '2000' }, [])).toEqual({ slowMo: 2000, workers: 2 });
  expect(canvasRunOptions({ CANVAS_PARALLEL_GROUPS: 'false' }, [])).toEqual({ slowMo: 0, workers: 1 });
  for (const value of ['-1','NaN','1.5','5001']) expect(() => canvasRunOptions({ UI_ACTION_DELAY_MS: value }, [])).toThrow('UI_ACTION_DELAY_MS');
  expect(() => canvasRunOptions({ CANVAS_PARALLEL_GROUPS: 'yes' }, [])).toThrow('CANVAS_PARALLEL_GROUPS');
  expect(() => canvasRunOptions({ CI: 'true', CANVAS_PARALLEL_GROUPS: 'true' }, [])).toThrow('远端/CI保持串行');
});
