import { errors, type Page, type Locator } from '@playwright/test';
import { waitForGenerationState } from './generation-wait.js';

// Only selects a display tab. Never generates, refreshes or replays purchases.
export async function selectCanvasView(page: Page, button: Locator, ready: () => Promise<boolean>, timeout = 45_000) {
  let pointerTimeouts = 0, keyboardUsed = false, keyboardAttempts = 0, directPointerAttempts = 0;
  let lastState: unknown = null;
  const started = Date.now();
  try {
    await waitForGenerationState(page, async () => {
      if (await ready()) return true;
      const count = await button.count();
      const visible = count === 1 && await button.isVisible();
      const enabled = visible && await button.isEnabled();
      lastState = { count, visible, enabled };
      if (!enabled) return false;
      try {
        if (pointerTimeouts < 2) await button.scrollIntoViewIfNeeded({ timeout: 1500 });
        const target = await button.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
          const hit = document.elementFromPoint(x, y);
          return { x, y, unobstructed: hit === element || Boolean(hit && element.contains(hit)) };
        });
        const { unobstructed } = target;
        lastState = { count, visible, enabled, unobstructed };
        if (!unobstructed) return false;
        if (pointerTimeouts < 2) await button.click({ timeout: 1500 });
        else if (directPointerAttempts < 2) {
          // Real mouse input at a freshly hit-tested visible target. Avoid
          // repeated locator focus/scroll waits on an animated viewer.
          directPointerAttempts++;
          await page.mouse.click(target.x, target.y);
        } else {
          if (keyboardAttempts >= 2) return false;
          // Native keyboard activation avoids animation-induced mouse instability.
          // Re-resolve the labelled target and verify focus; no force/DOM click.
          await button.focus({ timeout: 1000 });
          if (!await button.evaluate(element => document.activeElement === element)) return false;
          keyboardAttempts++;
          await button.press('Enter', { timeout: 1000 });
          keyboardUsed = true;
        }
      } catch (error) {
        if (!(error instanceof errors.TimeoutError)) throw error;
        pointerTimeouts++;
      }
      return ready();
    }, timeout, '画板视图切换');
  } catch (error) {
    if (/\[(?:GENERATION_FAILED|SITE_[A-Z_]+)\]/u.test(String(error))) throw error;
    throw new Error(`[UI_VIEW_TIMEOUT] 画板视图切换未完成；预算=${timeout}ms，实际=${Date.now() - started}ms，鼠标超时=${pointerTimeouts}次，落点点击=${directPointerAttempts}次，键盘尝试=${keyboardAttempts}；按钮状态=${JSON.stringify(lastState)}；${error instanceof Error ? error.message : String(error)}`);
  }
  return { pointerTimeouts, directPointerAttempts, keyboardUsed, elapsedMs: Date.now() - started };
}
