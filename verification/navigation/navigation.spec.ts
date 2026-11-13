import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { gotoWithDiagnostics } from '../../tests/pages/navigation.js';
import { monitorPage, bounded, redactDiagnostic } from '../../tests/fixtures/runtime-diagnostics.js';
import { expectVisibleWithAccessCheck, watchSiteAccess } from '../../tests/pages/site-access.js';
import { CreatePage } from '../../tests/pages/create.page.js';

let server: Server;
let origin: string;

test('首页三个Create入口仅选择Primary主导航，保持真实点击跳转', async ({ page }) => {
  await page.goto(origin + '/healthy');
  await page.setContent(`<a href="/other">Create</a><nav aria-label="Primary"><a href="/products/customize-your-own?variant=123">Create</a></nav><footer><a href="/footer">Create</a></footer>`);
  expect(await page.getByRole('link', { name: 'Create', exact: true }).count()).toBe(3);
  const create = new CreatePage(page);
  await create.expectHomeCreateEntry(500);
  await create.homeCreateLink.click();
  await expect(page).toHaveURL(origin + '/products/customize-your-own?variant=123');
});

test('主导航缺失或重复不回退到其他Create链接', async ({ page }) => {
  await page.goto(origin + '/healthy');
  const create = new CreatePage(page);
  for (const html of [
    '<footer><a href="/products/customize-your-own">Create</a></footer>',
    '<nav aria-label="Primary"><a href="/products/customize-your-own">Create</a><a href="/products/customize-your-own">Create</a></nav>'
  ]) {
    await page.setContent(html);
    await expect(create.expectHomeCreateEntry(100)).rejects.toThrow(/主导航应有且仅有一个/);
  }
});

test('主导航地址错误或跨站时不能通过，隐藏入口仍失败', async ({ page }) => {
  await page.goto(origin + '/healthy');
  const create = new CreatePage(page);
  for (const href of ['/collections/all', 'https://external.invalid/products/customize-your-own']) {
    await page.setContent(`<nav aria-label="Primary"><a href="${href}">Create</a></nav>`);
    await expect(create.expectHomeCreateEntry(100)).rejects.toThrow();
  }
  await page.setContent('<nav aria-label="Primary" hidden><a href="/products/customize-your-own">Create</a></nav>');
  await expect(create.expectHomeCreateEntry(100)).rejects.toThrow();
});
test.beforeAll(async () => {
  server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (['/verify-200','/verify-403','/verify-failed','/deny','/limited'].includes(request.url ?? '')) {
      response.writeHead(request.url === '/verify-403' || request.url === '/deny' ? 403 : request.url === '/limited' ? 429 : 200,
        { 'Content-Type': 'text/html', 'cf-ray':'a5513fa7cdf23747-ATL', 'x-request-id':'5fba6bd1-0212-4e41-b3bb-8c723497c28f-1793770456', 'Retry-After':'60' });
      response.end(request.url === '/verify-failed' ? 'Verification failed.' : request.url === '/deny' ? '<main>Access denied</main>' : request.url === '/limited' ? '<main>Too many requests</main>' : '<title>Browser verification</title><main><h1>Verifying your browser</h1><p>One quick check before you continue.</p><button>Verify browser</button></main>'); return;
    }
    if (request.url === '/late-verify') { response.end('<main>Loading</main><script>setTimeout(()=>document.body.innerHTML="Verification failed.",200)</script>'); return; }
    if (request.url === '/late-429') { response.end('<main>Loading</main><script>setTimeout(()=>location.href="/limited",200)</script>'); return; }
    if (request.url === '/business') { response.end('<main><h1>Product help</h1><p>Verify your browser if required.</p><div id="jjb-create-canvas"><button>Create</button></div><script>fetch("/deny");fetch("/limited")</script><iframe src="/verify-403"></iframe></main>'); return; }
    if (request.url === '/verification-recovers') { response.end('<main><h1>Verifying your browser</h1><p>One quick check before you continue.</p></main><script>setTimeout(()=>document.body.innerHTML="<main><div id=jjb-create-canvas><button>Create</button></div></main>",500)</script>'); return; }
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

test('HTTP200验证页不能伪装成正常页面，保留状态及真实请求标识', async ({ page }, testInfo) => {
  const before = page.listenerCount('response');
  await gotoWithDiagnostics(page, origin + '/verify-200');
  await expect(expectVisibleWithAccessCheck(page,page.getByRole('button',{name:'Create',exact:true}),500)).rejects.toThrow(/SITE_VERIFICATION/);
  const attachment = testInfo.attachments.find(a => a.name === 'site-access-diagnostics');
  expect(attachment?.body).toBeTruthy();
  const evidence = JSON.parse(attachment!.body!.toString());
  expect(evidence.status).toBe(200);
  expect(evidence.cfRay).toBe('a5513fa7cdf23747-ATL');
  expect(evidence.requestId).toBe('5fba6bd1-0212-4e41-b3bb-8c723497c28f-1793770456');
  expect(page.listenerCount('response')).toBe(before);
});

test('HTTP200进行中验证自行恢复时继续原case，不提前失败或消耗复核', async ({ page }, testInfo) => {
  await gotoWithDiagnostics(page,origin+'/verification-recovers');
  await expectVisibleWithAccessCheck(page,page.getByRole('button',{name:'Create',exact:true}),3000);
  expect(testInfo.attachments.some(a=>a.name==='site-access-diagnostics')).toBe(false);
  await page.getByRole('button',{name:'Create',exact:true}).click();
});

test('403验证页、普通403与429分别分类，均保持失败而非跳过', async ({ page }) => {
  await expect(gotoWithDiagnostics(page, origin + '/verify-403')).rejects.toThrow(/SITE_(VERIFICATION|ACCESS_DENIED)/);
  await expect(gotoWithDiagnostics(page, origin + '/deny')).rejects.toThrow(/SITE_ACCESS_DENIED/);
  await expect(gotoWithDiagnostics(page, origin + '/limited')).rejects.toThrow(/SITE_RATE_LIMITED/);
  await expect(gotoWithDiagnostics(page, origin + '/verify-failed')).rejects.toThrow(/SITE_VERIFICATION/);
});

test('等待Create期间才出现验证失败可及时识别，不刷新或清Cookie', async ({ page }) => {
  await page.context().addCookies([{ name:'fixture-session',value:'preserve',url:origin }]);
  let mainRequests = 0;
  page.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===page.mainFrame())mainRequests++;});
  await gotoWithDiagnostics(page, origin + '/late-verify');
  const start=Date.now();
  await expect(expectVisibleWithAccessCheck(page,page.getByRole('button',{name:'Create',exact:true}),4000)).rejects.toThrow(/SITE_VERIFICATION/);
  expect(Date.now()-start).toBeLessThan(2500);
  expect(mainRequests).toBe(1);
  expect((await page.context().cookies()).some(c=>c.name==='fixture-session'&&c.value==='preserve')).toBe(true);
});

test('异步主文档429被捕获，正常新导航不会沿用旧的403/429状态', async ({ page }) => {
  const watcher=watchSiteAccess(page);
  try {
    await gotoWithDiagnostics(page,origin+'/late-429');
    await expect(expectVisibleWithAccessCheck(page,page.locator('#absent'),4000)).rejects.toThrow(/SITE_RATE_LIMITED/);
    await gotoWithDiagnostics(page,origin+'/healthy');
    await expectVisibleWithAccessCheck(page,page.locator('main'),1000);
  } finally {watcher.dispose();}
});

test('正常页面、接口403/429、验证iframe和普通提示文案不改变业务执行', async ({ page }) => {
  const watcher=watchSiteAccess(page);
  try {
    await gotoWithDiagnostics(page,origin+'/business');
    const create=page.getByRole('button',{name:'Create',exact:true});
    await expectVisibleWithAccessCheck(page,create,1000);
    await create.click();
    await expect(create).toBeVisible();
    await expect(expectVisibleWithAccessCheck(page,page.locator('#missing'),200)).rejects.toThrow(/toBeVisible/);
  } finally {watcher.dispose();}
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

test('safe storefront GET recovers from one 503 and records both attempts', async ({ page }, info) => {
  let hits = 0;
  await page.route(origin + '/products/customize-your-own', route => {
    hits++;
    return route.fulfill({ status: hits === 1 ? 503 : 200, contentType: 'text/html', body: '<main>Ready</main>' });
  });
  await gotoWithDiagnostics(page, origin + '/products/customize-your-own');
  expect(hits).toBe(2);
  expect(info.annotations.some(a => a.type === 'read-only-retry')).toBe(true);
});

test('429, malformed DOM readiness and checkout document are not replayed', async ({ page }) => {
  for (const [pathname, status] of [['/cart', 429], ['/checkouts/private', 503]] as const) {
    let hits = 0;
    await page.route(origin + pathname, route => { hits++; return route.fulfill({ status, body: '<main>blocked</main>' }); });
    await expect(gotoWithDiagnostics(page, origin + pathname)).rejects.toThrow();
    expect(hits).toBe(1);
  }
});

test('short renderer probe is a warning but downstream business assertion still runs', async ({ page }, testInfo) => {
  const response = await gotoWithDiagnostics(page, origin + '/healthy', { probeTimeout: 1 });
  expect(response.status()).toBe(200);
  expect(testInfo.annotations.some(item => item.type === 'navigation-warning')).toBe(true);
  await expect(page.locator('main')).toBeVisible();
  await expect(expect(page.locator('#missing-business-element')).toBeVisible({ timeout: 100 })).rejects.toThrow();
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
