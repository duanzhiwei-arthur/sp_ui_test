import type { Page } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
import { bounded, redactDiagnostic } from '../fixtures/runtime-diagnostics.js';
import { assertSiteAccess } from './site-access.js';

// Either a visible explicit error or Retry in the active preview is terminal.
// A historical failed item, hidden panel or unrelated alert is not a new failure.
export async function generationFailure(page: Page): Promise<string | undefined> {
  const preview = page.locator('.product-image-container .jjb-app, #jjb-create-canvas .jjb-v3-viewer').filter({ visible: true });
  const errors = preview.getByText(/\b(?:error|failed|failure)\b|something went wrong|unable to generate|生成失败|生成出错|生成异常|无法生成|服务异常/i)
    .and(page.locator(':visible'));
  const messages = await errors.allTextContents();
  const message = messages.map(text => text.replace(/\s+/g, ' ').trim()).find(Boolean);
  if (message) return redactDiagnostic(message).slice(0, 1000);
  const retry = preview.getByRole('button', { name: /^Retry$/i }).and(page.locator(':visible'));
  if (await retry.count()) return '当前生成预览区出现 Retry 按钮；未取得错误详情，具体原因需结合生成任务诊断。';
  return undefined;
}

export async function waitForGenerationState(page: Page, ready: () => Promise<boolean>,
  timeout: number, label: string): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + timeout;
  let polls = 0;
  const timings = (page as Page & { __qaPhaseTimings?: unknown[] });
  const rows = timings.__qaPhaseTimings ??= [];
  let passed = false;
  const timeoutError = () => new Error(`[GENERATION_TIMEOUT] ${label} 超过阶段预算 ${timeout}ms；实际耗时 ${Date.now() - startedAt}ms；检查 ${polls} 次，未观察到成功条件。`);
  try {
    while (Date.now() < deadline) {
      polls++;
      const remaining = () => Math.max(1, deadline - Date.now());
      const probe = async <T>(operation: Promise<T>): Promise<T> => {
        try { return await bounded(operation, remaining(), label); }
        catch (error) { if (Date.now() >= deadline) throw timeoutError(); throw error; }
      };
      await probe(assertSiteAccess(page, true));
      const failure = await probe(generationFailure(page));
      if (failure) throw new Error(`[GENERATION_FAILED] ${label}；生成页面明确报错：${failure}`);
      if (await probe(ready())) { passed = true; return; }
      await delay(Math.min(1_000, remaining()));
    }
    throw timeoutError();
  } finally {
    if (rows.length < 100) rows.push({ label, budgetMs: timeout, elapsedMs: Date.now() - startedAt, polls, passed });
  }
}
