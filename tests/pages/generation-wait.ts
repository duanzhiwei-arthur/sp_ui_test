import type { Page } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
import { bounded, redactDiagnostic } from '../fixtures/runtime-diagnostics.js';

// Either a visible explicit error or Retry in the active preview is terminal.
// A historical failed item, hidden panel or unrelated alert is not a new failure.
export async function generationFailure(page: Page): Promise<string | undefined> {
  const preview = page.locator('.product-image-container .jjb-app').first();
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
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const remaining = () => Math.max(1, deadline - Date.now());
    const failure = await bounded(generationFailure(page), remaining(), label);
    if (failure) throw new Error(`[GENERATION_FAILED] ${label}；生成页面明确报错：${failure}`);
    if (await bounded(ready(), remaining(), label)) return;
    await delay(Math.min(250, remaining()));
  }
  throw new Error(`[GENERATION_TIMEOUT] ${label} 超过 ${timeout}ms；未观察到成功条件或明确生成错误。`);
}
