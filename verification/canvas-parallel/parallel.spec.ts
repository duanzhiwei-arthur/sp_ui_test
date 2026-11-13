import { test, expect } from '../../tests/fixtures/automation-identity.js';
import { installCanvasAssignment } from '../../tests/fixtures/canvas-assignment.js';

for (const item of [1, 2]) {
  test(`isolated group work ${item} (controlled network, no generation)`, async ({ context, page }, info) => {
    const treatment = info.project.name === 'canvas-treatment';
    const stableId = treatment ? '2' : '1';
    await installCanvasAssignment(context, 'https://jujubit.ai', { stableId, variant: treatment ? 'treatment' : 'control' });
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main>Controlled concurrency fixture</main>' }));
    const started = Date.now();
    await page.goto('https://jujubit.ai/');
    expect(await page.evaluate(() => localStorage.getItem('stable_id'))).toBe(stableId);
    expect(await page.evaluate(() => localStorage.getItem('sdk_anonymous_id'))).toBe('test');
    await page.waitForTimeout(1_000); // create measurable overlap, not a business wait
    await info.attach('controlled-group-window', { contentType: 'application/json', body: JSON.stringify({ group: info.project.name, item, started, ended: Date.now(), network: 'mocked' }) });
  });
}
