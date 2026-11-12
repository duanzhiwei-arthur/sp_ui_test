import { test, expect, createAutomationContext, automationOrigins } from '../../tests/fixtures/automation-identity.js';
import { test as diagnosticTest } from '../../tests/fixtures/runtime-diagnostics.js';
import { test as experimentTest } from '../../tests/experiments/experiment.fixture.js';
import { test as parityTest } from '../../experiments/canvas-v3/board.js';
import { readGaCookie } from '../../tests/fixtures/ga-cookie.js';
import type { BrowserContext, Page } from '@playwright/test';

async function mockSite(context: BrowserContext) {
  // No real network, generation or analytics delivery. Earliest page script
  // snapshots storage to verify the SDK sees test on its first read.
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `
    <script>window.identityAtBoot = localStorage.getItem('sdk_anonymous_id');</script>
    <main>Identity fixture</main><a href="/popup" target="_blank">Open popup</a>` }));
}
const readBoot = (page: Page) => page.evaluate(() => Reflect.get(window, 'identityAtBoot'));

test('default page sees plain string test before its first script; fixture annotation is present', async ({ context, page }, info) => {
  await mockSite(context); await page.goto('/');
  expect(await readBoot(page)).toBe('test');
  expect(await page.evaluate(() => localStorage.getItem('sdk_anonymous_id'))).toBe('test');
  expect(info.annotations).toContainEqual({ type: 'sdk_anonymous_id', description: 'test' });
});

test('refresh and next document restore value and retain unrelated identities', async ({ context, page }) => {
  await mockSite(context); await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('sdk_anonymous_id', 'old-random');
    localStorage.setItem('_anonymous_id', 'existing-visitor');
    localStorage.setItem('stable_id', 'existing-experiment');
    localStorage.setItem('statsig.stable_id.3770913638', '"2"');
  });
  for (const navigate of [() => page.reload(), () => page.goto('/products/customize-your-own')]) {
    await navigate(); expect(await readBoot(page)).toBe('test');
    expect(await page.evaluate(() => [localStorage.getItem('_anonymous_id'), localStorage.getItem('stable_id'), localStorage.getItem('statsig.stable_id.3770913638')]))
      .toEqual(['existing-visitor', 'existing-experiment', '"2"']);
  }
});

test('fresh retry-like contexts and existing storageState both receive test', async ({ browser }) => {
  for (let i = 0; i < 2; i++) {
    const context = await createAutomationContext(browser, { baseURL: 'https://jujubit.ai', storageState: {
      cookies: [], origins: [{ origin: 'https://jujubit.ai', localStorage: [
        { name: 'sdk_anonymous_id', value: 'previous' }, { name: 'stable_id', value: 'control' }] }] } });
    try {
      await mockSite(context); const page = await context.newPage(); await page.goto('/');
      expect(await readBoot(page)).toBe('test');
      expect(await page.evaluate(() => localStorage.getItem('stable_id'))).toBe('control');
    } finally { await context.close(); }
  }
});

test('popup and additional pages inherit injection', async ({ context, page }) => {
  await mockSite(context); await page.goto('/');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('link').click()]);
  await popup.waitForLoadState(); expect(await readBoot(popup)).toBe('test');
  const extra = await context.newPage(); await extra.goto('/second'); expect(await readBoot(extra)).toBe('test');
});

test('third-party pages retain their own ID; returning to storefront still sets test', async ({ browser }) => {
  const context = await createAutomationContext(browser, { baseURL: 'https://jujubit.ai', storageState: {
    cookies: [], origins: [{ origin: 'https://checkout.example', localStorage: [{ name: 'sdk_anonymous_id', value: 'provider-id' }] }] } });
  try {
    await mockSite(context); const page = await context.newPage();
    await page.goto('https://checkout.example'); expect(await readBoot(page)).toBe('provider-id');
    await page.goto('https://other.example'); expect(await readBoot(page)).toBeNull();
    await page.goto('https://www.jujubit.ai'); expect(await readBoot(page)).toBe('test');
  } finally { await context.close(); }
});

test('configured preview origin is supported without assigning test to production', async ({ browser }) => {
  const context = await createAutomationContext(browser, { baseURL: 'https://preview.example' });
  try {
    await mockSite(context); const page = await context.newPage();
    await page.goto('/'); expect(await readBoot(page)).toBe('test');
    await page.goto('https://jujubit.ai'); expect(await readBoot(page)).toBeNull();
  } finally { await context.close(); }
  expect(() => automationOrigins('file:///tmp/test')).toThrow('HTTP(S)');
});

diagnosticTest('daily runtime-diagnostics fixture inherits identity', async ({ context, page }) => {
  await mockSite(context); await page.goto('/'); expect(await readBoot(page)).toBe('test');
});

experimentTest('experiment fixture inherits identity without changing its configured stable ID', async ({ context, page, experiment }) => {
  await mockSite(context); await page.goto('/'); expect(await readBoot(page)).toBe('test');
  if (experiment.variant.stableId) expect(await page.evaluate(() => localStorage.getItem('stable_id'))).toBe(experiment.variant.stableId);
});

parityTest('新画板同业务链路继承sdk_anonymous_id=test，实验覆盖配置独立保留', async ({ context, page, board }) => {
  void board;
  await mockSite(context);await page.goto('/');expect(await readBoot(page)).toBe('test');
  const overrides=await page.evaluate(()=>JSON.parse(localStorage.getItem('_statsig_override')!));
  expect(overrides).toEqual({canvas_v3_109:{enable:true},canvas_trust_info:{enable:true}});
  expect(await page.evaluate(()=>localStorage.getItem('sak_anonymous_id'))).toBeNull();
});

diagnosticTest('GA Cookie按指定正则只读解析，缺失或无效时不改变Cookie',async({context,page})=>{
 await mockSite(context);await page.goto('/');expect(await readGaCookie(page)).toEqual({cookieValue:null,cookieClientId:null});
 await context.addCookies([{name:'_ga',value:'GA1.1.12345.67890',url:'https://jujubit.ai'}]);
 expect(await readGaCookie(page)).toEqual({cookieValue:'GA1.1.12345.67890',cookieClientId:'12345.67890'});
 await context.addCookies([{name:'_ga',value:'invalid-value',url:'https://jujubit.ai'}]);
 expect(await readGaCookie(page)).toEqual({cookieValue:'invalid-value',cookieClientId:null});
 expect((await context.cookies()).find(c=>c.name==='_ga')?.value).toBe('invalid-value');
});

test('live storefront storage check @live', async ({ page }) => {
  test.skip(process.env.IDENTITY_LIVE_CHECK !== 'true', 'Only explicitly run the read-only real-site check');
  test.setTimeout(150_000);
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  expect(await page.evaluate(() => localStorage.getItem('sdk_anonymous_id'))).toBe('test');
  // Allow site SDK initialization; do not click/upload/generate or collect cookies.
  await page.waitForTimeout(5_000);
  expect(await page.evaluate(() => localStorage.getItem('sdk_anonymous_id'))).toBe('test');
});
