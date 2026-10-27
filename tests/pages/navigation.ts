import { test, type Page, type Response } from '@playwright/test';
import { bounded, monitorPage, redactDiagnostic } from '../fixtures/runtime-diagnostics.js';

export interface NavigationOptions { commitTimeout?: number; readyTimeout?: number; probeTimeout?: number }

// Separate document response, DOM readiness and renderer responsiveness.
// No refresh/retry and no silent passing of missing DOMContentLoaded.
export async function gotoWithDiagnostics(page: Page, url: string, options: NavigationOptions = {}): Promise<Response> {
  const monitor = monitorPage(page);
  let phase = 'commit';
  try {
    const response = await page.goto(url, { waitUntil: 'commit', timeout: options.commitTimeout ?? 90_000 });
    if (!response || response.status() < 200 || response.status() >= 400) {
      throw new Error(`[NAV_HTTP] 页面HTTP状态异常：${response?.status() ?? '无响应'}`);
    }
    monitor.record('navigation-commit', { status: response.status() });
    phase = 'domcontentloaded';
    await page.waitForLoadState('domcontentloaded', { timeout: options.readyTimeout ?? 120_000 });
    phase = 'renderer';
    try {
      await bounded(page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 100))), options.probeTimeout ?? 3_000, '主页面事件循环响应');
    } catch (error) {
      // A renderer probe is observability, not a business assertion. DOM ready,
      // main content and the following page assertions remain the hard gates.
      // This avoids turning transient runner/main-thread pressure into a false
      // product failure while retaining the warning in navigation diagnostics.
      monitor.record('renderer-probe-timeout', { error: redactDiagnostic(String(error)) });
      try { test.info().annotations.push({ type: 'navigation-warning', description: '主页面事件循环探测超时；继续由页面业务断言决定结果。' }); } catch { /* outside a test */ }
    }
    return response;
  } catch (error) {
    const snapshot = await monitor.snapshot(options.probeTimeout ?? 2_000);
    try {
      await test.info().attach('navigation-diagnostics', { body: JSON.stringify({ phase, ...snapshot }, null, 2), contentType: 'application/json' });
    } catch { /* Caller may be outside Playwright; the error summary still survives. */ }
    const reason = error instanceof Error ? error.message : String(error);
    const code = phase === 'commit' ? 'NAV_RESPONSE' : phase === 'domcontentloaded' ? 'NAV_DOM_READY' : 'NAV_RENDERER';
    throw new Error(`[${code}] 页面导航失败，阶段=${phase}；${redactDiagnostic(reason).slice(0, 800)}。主页面状态=${JSON.stringify(snapshot.state)}；未完成请求=${snapshot.pendingRequests.length}；详情见navigation-diagnostics附件。`);
  } finally { monitor.dispose(); }
}
