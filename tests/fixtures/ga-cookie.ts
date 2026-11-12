import { type Page } from '@playwright/test';
import { test as base, expect } from './automation-identity.js';

export async function readGaCookie(page: Page) {
  return page.evaluate(() => {
    const cookieValue = document.cookie.match(/(?:^|;\s*)_ga=([^;]*)/)?.[1] ?? null;
    const cookieClientId = cookieValue?.match(/^GA\d+\.\d+\.(.+)$/)?.[1] ?? null;
    return { cookieValue, cookieClientId };
  });
}

// 所有远端suite共用；独立诊断，不依赖截图/模型审计成功，不改变case结果。
export const test = base.extend<{ gaCookieDiagnostics: void }>({
  gaCookieDiagnostics: [async ({ page }, use, info) => {
    try { await use(); } finally {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const values = await Promise.race([
        readGaCookie(page).then(v => ({ ...v, gap: null })),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('timeout')), 2000); })
      ]).catch(() => ({ cookieValue: null, cookieClientId: null, gap: '当前页面不可读取、已关闭或超时；未借用其他case的Cookie' }))
        .finally(() => clearTimeout(timer));
      console.log(`[ga-cookie] case=${info.title} cookieValue=${values.cookieValue ?? '未采集'} cookieClientId=${values.cookieClientId ?? '未采集'}`);
      try { await info.attach('ga-cookie-diagnostics', { body: JSON.stringify({ version: 1, case: info.title, retry: info.retry, ...values }), contentType: 'application/json' }); }
      catch { info.annotations.push({ type: 'diagnostic-gap', description: 'GA Cookie附件不可用，保留原case结果' }); }
    }
  }, { auto: true, timeout: 5000 }]
});
export { expect };
