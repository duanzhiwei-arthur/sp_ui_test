import { test, expect } from '../../tests/fixtures/runtime-diagnostics.js';
import { installCanvasAssignment, assertCanvasAssignment } from '../../tests/fixtures/canvas-assignment.js';
import { statsigStableIdStorageKey } from '../../tests/experiments/experiment-registry.js';

for (const variant of ['control', 'treatment'] as const) {
  test(`${variant}: SDK first read gets stable_id, actual assignment is checked, analytics identity survives`, async ({ page, context }, info) => {
    const assignment = { stableId: `test-${variant}`, variant };
    await installCanvasAssignment(context, 'https://jujubit.ai', assignment);
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<script>
      const stableID = JSON.parse(localStorage.getItem('${statsigStableIdStorageKey()}'));
      window.statsigClient = { getContext: () => ({stableID}), getExperiment: () => ({get: () => ${variant === 'treatment'}}) };
      window.__jjbCanvasV3Enabled = ${variant === 'treatment'};
      window.identityAtBoot = localStorage.getItem('sdk_anonymous_id');
    </script>` }));
    await page.goto('/');
    await assertCanvasAssignment(page, info, assignment);
    expect(await page.evaluate(() => Reflect.get(window, 'identityAtBoot'))).toBe('test');
    await page.evaluate(() => localStorage.setItem('_statsig_override', '{"canvas_v3_109":{"enable":true}}'));
    await page.reload();
    await assertCanvasAssignment(page, info, assignment);
    await page.goto('https://checkout.example');
    expect(await page.evaluate(() => localStorage.getItem('stable_id'))).toBeNull();
  });
}

test('wrong SDK stable_id cannot pass even when treatment UI and flags are true', async ({ context, page }, info) => {
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<script>
    window.statsigClient = { getContext: () => ({stableID: 'wrong'}), getExperiment: () => ({get: () => true}) };
    window.__jjbCanvasV3Enabled = true;
  </script>` }));
  await page.goto('/');
  await expect(assertCanvasAssignment(page, info, { stableId: 'expected', variant: 'treatment' })).rejects.toThrow('EXPERIMENT_ASSIGNMENT');
});

test('canvas treatment does not require the unrelated trust experiment', async ({ context, page }, info) => {
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<script>
    window.statsigClient = { getContext: () => ({stableID: 'expected'}), getExperiment: name => ({get: () => name === 'canvas_v3_109'}) };
    window.__jjbCanvasV3Enabled = true;
  </script>` }));
  await page.goto('/');
  await assertCanvasAssignment(page, info, { stableId: 'expected', variant: 'treatment' });
});
