import { test as base, expect, type Page, type Request, type ConsoleMessage } from '@playwright/test';

export function redactDiagnostic(value: string): string {
  return value.replace(/\b(?:sk-|gh[pousr]_|github_pat_)[\w-]+/gu, '[SECRET]')
    .replace(/(authorization|cookie|token|secret|password|api[_-]?key)["']?\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|(?:Bearer\s+)?[^\s,;]+)/giu, '$1=[REDACTED]')
    .replace(/\bBearer\s+[\w.+/=-]+/giu, 'Bearer [SECRET]')
    .replace(/https?:\/\/[^\s"'<>]+/gu, '[URL]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, '[EMAIL]');
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    // No query, credentials, checkout/session IDs or upload resource URLs.
    const path = /^\/(?:en-us\/?|products\/customize-your-own|cart\/?)$/.test(url.pathname) || url.pathname === '/'
      ? url.pathname : url.pathname.includes('/assets/') ? `/assets/${url.pathname.split('/').at(-1)}` : '/[path-redacted]';
    return `${url.origin}${path}`;
  } catch { return '[invalid-url]'; }
}

export async function bounded<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超过 ${timeoutMs}ms`)), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export function monitorPage(page: Page) {
  const startedAt = new Date().toISOString();
  const events: Array<Record<string, unknown>> = [];
  const requests = new Map<Request, { url: string; method: string; type: string; startedAt: number; status?: number }>();
  let droppedEvents = 0;
  let droppedRequests = 0;
  const record = (kind: string, details: Record<string, unknown> = {}) => {
    if (events.length === 100) { events.shift(); droppedEvents++; }
    events.push({ at: new Date().toISOString(), kind, ...details });
  };
  const onRequest = (request: Request) => {
    if (requests.size >= 200) { droppedRequests++; return; }
    requests.set(request, { url: safeUrl(request.url()), method: request.method(), type: request.resourceType(), startedAt: Date.now() });
  };
  const onResponse = (response: import('@playwright/test').Response) => {
    const item = requests.get(response.request());
    if (item) item.status = response.status();
    if (response.status() >= 400) record('http-error', { url: safeUrl(response.url()), status: response.status() });
  };
  const onFinished = (request: Request) => { requests.delete(request); };
  const onFailed = (request: Request) => {
    record('request-failed', { url: safeUrl(request.url()), type: request.resourceType(), error: redactDiagnostic(request.failure()?.errorText ?? 'unknown') });
    requests.delete(request);
  };
  const onPageError = (error: Error) => record('page-error', { error: redactDiagnostic(error.message).slice(0, 600) });
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === 'error') record('console-error', { error: redactDiagnostic(message.text()).slice(0, 600) });
  };
  const onDom = () => record('domcontentloaded');
  const onLoad = () => record('load');
  const onCrash = () => record('crash');
  const onClose = () => record('close');
  page.on('request', onRequest); page.on('response', onResponse);
  page.on('requestfinished', onFinished); page.on('requestfailed', onFailed);
  page.on('pageerror', onPageError); page.on('console', onConsole);
  page.on('domcontentloaded', onDom); page.on('load', onLoad); page.on('crash', onCrash); page.on('close', onClose);
  return {
    record,
    async snapshot(probeTimeoutMs = 2_000) {
      const state = await bounded(page.evaluate(() => ({ readyState: document.readyState,
        mainPresent: Boolean(document.querySelector('main')), visibility: document.visibilityState,
        navigation: performance.getEntriesByType('navigation').slice(0, 1).map(entry => {
          const timing = entry as PerformanceNavigationTiming;
          return { responseEnd: timing.responseEnd, domInteractive: timing.domInteractive,
            domContentLoadedEventStart: timing.domContentLoadedEventStart, domContentLoadedEventEnd: timing.domContentLoadedEventEnd };
        }) })), probeTimeoutMs, '主页面状态探测')
        .catch((error: unknown) => ({ unavailable: true, reason: redactDiagnostic(String(error)) }));
      return { version: 1, startedAt, capturedAt: new Date().toISOString(), url: safeUrl(page.url()), state,
        events: [...events], pendingRequests: [...requests.values()].map(item => ({ ...item, ageMs: Date.now() - item.startedAt })),
        droppedEvents, droppedRequests,
        caveat: '未完成请求不等于HTTP失败；页面脚本报错和挂起请求不单独证明根因。' };
    },
    dispose() {
      page.off('request', onRequest); page.off('response', onResponse); page.off('requestfinished', onFinished);
      page.off('requestfailed', onFailed); page.off('pageerror', onPageError); page.off('console', onConsole);
      page.off('domcontentloaded', onDom); page.off('load', onLoad); page.off('crash', onCrash); page.off('close', onClose);
    }
  };
}

export const test = base.extend<{ runtimeDiagnostics: void }>({
  runtimeDiagnostics: [async ({ page }, use, testInfo) => {
    const monitor = monitorPage(page);
    try { await use(); } finally {
      try {
        const snapshot = await monitor.snapshot();
        await testInfo.attach('runtime-diagnostics', { body: JSON.stringify(snapshot, null, 2), contentType: 'application/json' });
        if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) {
          try {
            const image = await bounded(page.screenshot({ timeout: 3_000 }), 4_000, '失败截图');
            await testInfo.attach('runtime-failure-screenshot', { body: image, contentType: 'image/png' });
          } catch { testInfo.annotations.push({ type: 'diagnostic-gap', description: '失败截图不可用，保留录像并由通知层抽帧兜底。' }); }
        }
      } catch { testInfo.annotations.push({ type: 'diagnostic-gap', description: '运行时诊断采集失败，保留原始测试结果和Trace。' }); }
      finally { monitor.dispose(); }
    }
  }, { auto: true, timeout: 12_000 }]
});
export { expect };
