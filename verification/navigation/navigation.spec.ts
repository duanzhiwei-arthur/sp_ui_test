import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { gotoWithDiagnostics } from '../../tests/pages/navigation.js';
import { monitorPage, bounded, redactDiagnostic } from '../../tests/fixtures/runtime-diagnostics.js';

let server: Server;
let origin: string;
test.beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/never.js' || request.url === '/never-document') return;
    if (request.url === '/stream') { response.writeHead(200, { 'Content-Type': 'text/plain' }); response.write('partial'); return; }
    if (request.url === '/error') { response.writeHead(503); response.end('unavailable'); return; }
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/healthy' }); response.end(); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<title>JuJuBit fixture</title><main id="MainContent">Healthy visible content</main>${
      request.url === '/module' ? '<script type="module" src="/never.js"></script>' :
      request.url === '/async' ? '<script async src="/never.js"></script>' :
      request.url === '/errors' ? '<script>throw new Error("token=topsecret user@example.com https://example.com?secret=x")</script>' : ''}`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

test('healthy document and locale-like redirect pass without changing HTTP validation', async ({ page }) => {
  const listeners = page.listenerCount('request');
  const response = await gotoWithDiagnostics(page, origin + '/redirect');
  expect(response.status()).toBe(200);
  await expect(page.locator('main')).toBeVisible();
  expect(page.listenerCount('request')).toBe(listeners);
});

test('visible main with stalled module still fails, not silently passed on commit', async ({ page }, testInfo) => {
  const start = Date.now();
  await expect(gotoWithDiagnostics(page, origin + '/module', { readyTimeout: 300, probeTimeout: 300 })).rejects.toThrow(/NAV_DOM_READY/);
  expect(Date.now() - start).toBeLessThan(4_000);
  const evidence = testInfo.attachments.find(a => a.name === 'navigation-diagnostics');
  expect(evidence).toBeTruthy();
  expect(page.listenerCount('request')).toBe(0);
});

test('hanging async analytics script does not falsely block DOM ready', async ({ page }) => {
  const response = await gotoWithDiagnostics(page, origin + '/async', { readyTimeout: 500 });
  expect(response.status()).toBe(200);
  await expect(page.locator('main')).toBeVisible();
});

test('server error cannot pass with visible text', async ({ page }) => {
  await expect(gotoWithDiagnostics(page, origin + '/error')).rejects.toThrow(/NAV_HTTP.*503/);
});

test('uncommitted document is timed out independently', async ({ page }) => {
  const start = Date.now();
  await expect(gotoWithDiagnostics(page, origin + '/never-document', { commitTimeout: 200, probeTimeout: 200 })).rejects.toThrow(/NAV_RESPONSE/);
  expect(Date.now() - start).toBeLessThan(3_000);
});

test('response headers do not falsely mark a streaming request completed', async ({ page }) => {
  const monitor = monitorPage(page);
  try {
    await page.goto(origin + '/healthy');
    await page.evaluate(() => { void fetch('/stream'); });
    await page.waitForResponse(response => response.url().endsWith('/stream'));
    const snapshot = await monitor.snapshot();
    expect(snapshot.pendingRequests.some(r => r.type === 'fetch' && r.status === 200)).toBe(true);
  } finally { monitor.dispose(); }
});

test('same-URL simultaneous requests are tracked separately', async ({ page }) => {
  const monitor = monitorPage(page);
  try {
    await page.goto(origin + '/healthy');
    await page.evaluate(() => { void fetch('/stream'); void fetch('/stream'); });
    await expect.poll(async () => (await monitor.snapshot()).pendingRequests.filter(r => r.type === 'fetch').length).toBe(2);
  } finally { monitor.dispose(); }
});

test('page errors are recorded and secrets are redacted', async ({ page }) => {
  const monitor = monitorPage(page);
  try {
    await page.goto(origin + '/errors');
    const snapshot = await monitor.snapshot();
    expect(snapshot.events.some(e => e.kind === 'page-error')).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('topsecret');
    expect(JSON.stringify(snapshot)).not.toContain('user@example.com');
  } finally { monitor.dispose(); }
});

test('bounded diagnostics never await an unresponsive probe forever', async () => {
  await expect(bounded(new Promise(() => {}), 40, 'probe')).rejects.toThrow(/probe 超过 40ms/);
  expect(redactDiagnostic('Authorization: Bearer abc123 ghp_secret123')).not.toMatch(/abc123|ghp_secret123/);
});
