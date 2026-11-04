import { expect, test, type Locator, type Page, type Request, type Response } from '@playwright/test';

type AccessCode = 'SITE_VERIFICATION' | 'SITE_RATE_LIMITED' | 'SITE_ACCESS_DENIED';
interface DocumentEvidence {
  at: string; url: string; status: number; cfRay?: string; requestId?: string; retryAfter?: string;
}
interface State {
  users: number; request?: Request; document?: DocumentEvidence;
  onRequest: (request: Request) => void; onResponse: (response: Response) => void;
}
const states = new WeakMap<Page, State>();
const identifier = (value?: string) => value && /^[a-zA-Z0-9_-]{1,160}$/.test(value) ? value : undefined;
function safeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const pathname = /^\/(?:products\/[a-zA-Z0-9_-]+|cart)?\/?$/.test(u.pathname) ? u.pathname : '/[path-redacted]';
    return `${u.origin}${pathname}`;
  } catch { return '[invalid-url]'; }
}

// 只观察当前主框架文档，不将资源/iframe/API 的403归为整站访问阻断。
export function watchSiteAccess(page: Page): { dispose: () => void } {
  let state = states.get(page);
  if (!state) {
    state = { users: 0, onRequest: () => {}, onResponse: () => {} };
    const current = state;
    const mainDocument = (request: Request) => {
      try { return request.isNavigationRequest() && request.frame() === page.mainFrame(); } catch { return false; }
    };
    current.onRequest = request => {
      if (!mainDocument(request)) return;
      current.request = request; current.document = undefined;
    };
    current.onResponse = response => {
      const request = response.request();
      if (!mainDocument(request) || (current.request && current.request !== request)) return;
      const headers = response.headers();
      current.document = { at: new Date().toISOString(), url: safeUrl(response.url()), status: response.status(),
        cfRay: identifier(headers['cf-ray']), requestId: identifier(headers['x-request-id']),
        retryAfter: /^\d{1,6}$/.test(headers['retry-after'] ?? '') ? headers['retry-after'] : undefined };
    };
    states.set(page, current);
  }
  if (state.users++ === 0) { page.on('request', state.onRequest); page.on('response', state.onResponse); }
  let disposed = false;
  return { dispose() {
    if (disposed) return; disposed = true;
    if (--state.users === 0) { page.off('request', state.onRequest); page.off('response', state.onResponse); }
  } };
}

export class SiteAccessError extends Error {
  constructor(readonly evidence: DocumentEvidence & { code: AccessCode; signal: string }) {
    const label = evidence.code === 'SITE_VERIFICATION' ? '浏览器验证阻断' : evidence.code === 'SITE_RATE_LIMITED' ? '主文档访问限流' : '主文档访问被拒绝（原因待查）';
    const pathname = (() => { try { return new URL(evidence.url).pathname; } catch { return '[unknown]'; } })();
    super(`[${evidence.code}] ${label}；HTTP ${evidence.status || '未知'}；时间=${evidence.at}；路径=${pathname}；CF-Ray=${evidence.cfRay ?? '未采集'}；Request ID=${evidence.requestId ?? '未采集'}。本阶段业务未验证；按现有规则最多单独复核一次，不自动刷新或清Cookie。`);
    this.name = 'SiteAccessError';
  }
}

async function verificationSignal(page: Page): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([page.evaluate(() => {
      const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
      const body = normalize(document.body?.innerText ?? '');
      const heading = normalize(document.querySelector('h1')?.textContent ?? '');
      const title = normalize(document.title);
      // 不读取隐藏脚本/任意iframe文本，不把有完整业务界面的说明文案当成验证页。
      if (document.querySelector('#jjb-create-canvas button')) return '';
      if (/^verification failed\.?$/.test(body)) return 'Verification failed.';
      if (/^(verify your browser|verifying your browser|browser verification)$/.test(heading)
        && /one quick check before you continue|please complete the verification to continue|verify browser/.test(body)
        && body.length < 4000) return 'Browser verification';
      if (/^(verify your browser|checking your browser[.…]*|just a moment[.…]*)$/.test(title)
        && body.length < 4000 && document.querySelector('iframe[src*="challenges.cloudflare.com"], .cf-turnstile, #challenge-form')) return 'Challenge page';
      return '';
    }), new Promise<string>(resolve => { timer = setTimeout(() => resolve(''), 500); })]);
  } catch { return ''; } // 探测不可用不改变原有业务断言或把页面判通过。
  finally { clearTimeout(timer); }
}

export async function assertSiteAccess(page: Page, allowPendingVerification = false): Promise<void> {
  const state = states.get(page);
  const request = state?.request;
  const signal = await verificationSignal(page);
  if (request !== state?.request) return; // 探测期间发生新导航，下轮重新判断。
  const document = state?.document;
  const status = document?.status ?? 0;
  // HTTP200的进行中验证可能自行完成；沿用原业务等待预算，不提前消耗复核机会。
  if (allowPendingVerification && signal && signal !== 'Verification failed.' && ![403, 429].includes(status)) return;
  const code: AccessCode | undefined = signal ? 'SITE_VERIFICATION' : status === 429 ? 'SITE_RATE_LIMITED' : status === 403 ? 'SITE_ACCESS_DENIED' : undefined;
  if (!code) return;
  const error = new SiteAccessError({ at: new Date().toISOString(), url: safeUrl(page.url()), status, ...document, code, signal });
  try {
    await test.info().attach('site-access-diagnostics', { body: JSON.stringify(error.evidence), contentType: 'application/json' });
    test.info().annotations.push({ type: 'environment-blocked', description: error.message });
  } catch { /* 诊断失败不覆盖已确认的访问阻断。 */ }
  throw error;
}

// 保留原断言与等待预算；仅在等待期间增加有证据的验证页检查。
// 不在后台遗留assertion，不刷新、不点击验证码、不创建生成任务。
export async function expectVisibleWithAccessCheck(page: Page, locator: Locator, timeout = 120_000): Promise<void> {
  const watcher = watchSiteAccess(page);
  const deadline = Date.now() + timeout;
  try {
    while (Date.now() < deadline) {
      await assertSiteAccess(page, true);
      if (await locator.isVisible()) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))));
    }
    await assertSiteAccess(page);
    try {
      await expect(locator).toBeVisible({ timeout: Math.max(1, deadline - Date.now()) });
    } catch (error) {
      // 末次断言只使用剩余预算，报告仍说明累计等待时间，避免把1ms误读为配置回归。
      if (error instanceof Error) error.message = `页面业务元素在总等待预算 ${timeout}ms 内未就绪；验证页探测未确认阻断。${error.message}`;
      throw error;
    }
  } finally { watcher.dispose(); }
}
