import { setTimeout as delay } from 'node:timers/promises';
import { test, type Page } from '@playwright/test';

export interface ReadAttempt { attempt: number; elapsedMs: number; outcome: 'returned' | 'transport-error'; status?: number; reason?: string; retried: boolean }

export function retryableTransportError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error);
  if (/\[(?:GENERATION|SITE|ASSET|CART|EXPERIMENT)_|Target .*closed|browser has been closed/i.test(message)) return false;
  return /ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|ERR_NETWORK_CHANGED|ERR_TIMED_OUT|ERR_EMPTY_RESPONSE|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed/i.test(message)
    || /^(?:apiRequestContext\.get|page\.goto): Timeout \d+ms exceeded/i.test(message);
}

export function retryableReadStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

export async function readOnlyWithRetry<T>(operation: () => Promise<T>, shouldRetry: (value: T) => boolean,
  options: { attempts?: number; delayMs?: number; label?: string; status?: (value: T) => number; release?: (value: T) => Promise<void>; onAttempt?: (attempt: ReadAttempt) => void } = {}): Promise<T> {
  const attempts = options.attempts ?? 2;
  const delayMs = options.delayMs ?? 1_000;
  if (![1, 2].includes(attempts) || !Number.isInteger(delayMs) || delayMs < 0 || delayMs > 5_000) throw new Error('只读重试最多2次尝试，间隔0～5000毫秒');
  const records: ReadAttempt[] = [];
  const record = (row: ReadAttempt) => { records.push(row); options.onAttempt?.(row); };
  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const started = Date.now();
      let value: T;
      try { value = await operation(); }
      catch (error) {
        const retry = attempt < attempts && retryableTransportError(error);
        // Never save request headers, cookie values, or raw exception call logs.
        record({ attempt, elapsedMs: Date.now() - started, outcome: 'transport-error', retried: retry,
          reason: retryableTransportError(error) ? '连接中断或GET/导航超时' : '不可重试错误' });
        if (!retry) throw error;
        await delay(delayMs); continue;
      }
      const retry = attempt < attempts && shouldRetry(value);
      record({ attempt, elapsedMs: Date.now() - started, outcome: 'returned', status: options.status?.(value), retried: retry });
      if (!retry) return value;
      await options.release?.(value);
      await delay(delayMs);
    }
    throw new Error('只读请求没有结果');
  } finally {
    if (options.label) {
      try {
        await test.info().attach('read-only-diagnostics', { contentType: 'application/json', body: JSON.stringify({ label: options.label, attempts: records }) });
        if (records.some(r => r.retried)) test.info().annotations.push({ type: 'read-only-retry', description: `${options.label}首次失败，最多重试一次；记录保留于read-only-diagnostics` });
      } catch { /* diagnostic failures must never change the original outcome */ }
    }
  }
}

export async function readCartJson(page: Page, label: string, timeout = 30_000) {
  const origin = new URL(page.url()).origin;
  // Read through the same browser connection path as the storefront. Node's
  // APIRequestContext may use different proxy/TLS routing from browser fetch.
  // This is only GET /cart.js; it never invokes an application's cart writer.
  let result: { status: number; body: unknown; invalidJson?: boolean };
  try {
    result = await readOnlyWithRetry(
      async () => {
        const value = await page.evaluate(async ({ origin, timeout }) => {
          if (location.origin !== origin) return { status: 0, body: null, error: 'origin-changed' };
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeout);
          try {
            const response = await fetch('/cart.js', { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
            if (!response.ok) { await response.body?.cancel(); return { status: response.status, body: null }; }
            // Bound body reading too; headers alone do not finish a GET.
            const text = await response.text();
            try { return { status: response.status, body: JSON.parse(text) as unknown }; }
            catch { return { status: response.status, body: null, invalidJson: true }; }
          } catch {
            return { status: 0, body: null, error: controller.signal.aborted ? 'timeout' : 'transport' };
          } finally { clearTimeout(timer); }
        }, { origin, timeout });
        if (value.error === 'origin-changed') throw new Error('[READ_CONTEXT] 购物车读取期间页面切换了站点，不读取其他域名');
        if (value.error) throw new Error(value.error === 'timeout' ? 'fetch failed: browser cart GET exceeded timeout' : 'fetch failed: browser cart GET transport error');
        return value;
      },
      value => retryableReadStatus(value.status),
      { label, status: value => value.status }
    );
  } catch (error) {
    if (retryableTransportError(error)) throw new Error(`[READ_TRANSPORT] ${label}：购物车只读GET两次尝试后仍未完成；见read-only-diagnostics，不重发加购`);
    throw error;
  }
  if (result.status < 200 || result.status >= 300) throw new Error(`[READ_HTTP] ${label}：购物车只读GET HTTP ${result.status}，403/429不重试；不重发加购`);
  if (result.invalidJson) throw new Error(`[READ_PAYLOAD] ${label}：购物车HTTP成功但响应不是有效JSON，不重发加购`);
  return result.body as { item_count: number; total_price: number; currency: string; items: Array<{ key: string; variant_id: number; quantity: number; product_title: string; final_line_price: number; properties: Record<string, unknown> }> };
}
