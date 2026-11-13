import { test, expect } from '@playwright/test';
import { readOnlyWithRetry, readCartJson, retryableReadStatus, retryableTransportError } from '../../tests/fixtures/read-only-retry.js';

test('read-only retry is bounded to one retry and only retries transport/5xx', async () => {
  let calls = 0;
  const response = await readOnlyWithRetry(async () => { calls += 1; return { status: () => calls === 1 ? 503 : 200 }; }, r => retryableReadStatus(r.status()), { delayMs: 1 });
  expect(response.status()).toBe(200); expect(calls).toBe(2);
  calls = 0;
  await expect(readOnlyWithRetry(async () => { calls += 1; throw new Error('ERR_CONNECTION_CLOSED'); }, () => true, { delayMs: 1 })).rejects.toThrow('ERR_CONNECTION_CLOSED');
  expect(calls).toBe(2);
  expect(retryableTransportError(new Error('ERR_CONNECTION_RESET'))).toBe(true);
  expect(retryableTransportError(new Error('[GENERATION_FAILED] Failed to fetch'))).toBe(false);
  expect(retryableReadStatus(429)).toBe(false);
});

test('GET timeout retries once, observations are sanitized, failed response is disposed', async ({}, info) => {
  let calls = 0, disposed = 0;
  await readOnlyWithRetry(async () => ({ status: ++calls === 1 ? 503 : 200 }), r => r.status >= 500,
    { label: 'controlled cart GET', status: r => r.status, release: async () => { disposed++; }, delayMs: 1 });
  expect(calls).toBe(2); expect(disposed).toBe(1);
  const attachment = info.attachments.find(a => a.name === 'read-only-diagnostics');
  expect(JSON.parse(attachment!.body!.toString()).attempts).toMatchObject([{ attempt: 1, status: 503, retried: true }, { attempt: 2, status: 200, retried: false }]);
  calls = 0;
  await expect(readOnlyWithRetry(async () => { calls++; throw new Error('apiRequestContext.get: Timeout 30000ms exceeded.\ncookie: private'); }, () => false,
    { label: 'controlled timeout', delayMs: 1 })).rejects.toThrow('Timeout');
  expect(calls).toBe(2);
  expect(info.attachments.filter(a => a.name === 'read-only-diagnostics').map(a => a.body!.toString()).join('')).not.toContain('private');
  expect(retryableTransportError(new Error('locator.click: Timeout 30000ms exceeded.'))).toBe(false);
  await expect(readOnlyWithRetry(async () => 1, () => true, { attempts: 3 })).rejects.toThrow('最多2次');
});

test('cart HTTP429 is not retried and cannot issue a mutation', async ({ page, context }) => {
  let calls = 0;
  await context.route('**/*', route => {
    if (new URL(route.request().url()).pathname === '/cart.js') {
      calls++; expect(route.request().method()).toBe('GET');
      return route.fulfill({ status: 429, body: 'limited' });
    }
    return route.fulfill({ body: '<main>Controlled</main>', contentType: 'text/html' });
  });
  await page.goto('https://jujubit.ai/');
  await expect(readCartJson(page, '受控限流')).rejects.toThrow('[READ_HTTP]');
  expect(calls).toBe(1);
});

test('browser cart GET recovers once from 503 with same-session cookie; malformed JSON fails without retry', async ({ page, context }) => {
  let calls = 0, broken = false;
  await context.addCookies([{ name: 'test-session', value: 'isolated', url: 'https://jujubit.ai' }]);
  await context.route('**/*', route => {
    if (new URL(route.request().url()).pathname !== '/cart.js') return route.fulfill({ body: '<main>Controlled</main>', contentType: 'text/html' });
    calls++; expect(route.request().method()).toBe('GET');
    expect(route.request().headers()['cookie']).toContain('test-session=isolated');
    return route.fulfill({ status: !broken && calls === 1 ? 503 : 200, contentType: 'application/json', body: broken ? 'invalid' : JSON.stringify({ item_count: 0, items: [] }) });
  });
  await page.goto('https://jujubit.ai');
  expect(await readCartJson(page, '受控恢复')).toMatchObject({ item_count: 0 }); expect(calls).toBe(2);
  broken = true; calls = 0;
  await expect(readCartJson(page, '受控坏JSON')).rejects.toThrow('READ_PAYLOAD'); expect(calls).toBe(1);
});

test('browser GET body timeout aborts each attempt without an extra cart mutation', async ({ page, context }) => {
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main>Controlled</main>' }));
  await page.goto('https://jujubit.ai');
  await page.evaluate(() => {
    Object.assign(window, { testCartReads: 0 });
    window.fetch = async (_input, init) => {
      Reflect.set(window, 'testCartReads', Reflect.get(window, 'testCartReads') + 1);
      return { ok: true, status: 200, text: () => new Promise<string>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }) } as Response;
    };
  });
  await expect(readCartJson(page, '受控body超时', 40)).rejects.toThrow('READ_TRANSPORT');
  expect(await page.evaluate(() => Reflect.get(window, 'testCartReads'))).toBe(2);
});
