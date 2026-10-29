import { test, expect } from '@playwright/test';
import { CreatePage } from '../../tests/pages/create.page.js';
import { generationFailure, waitForGenerationState } from '../../tests/pages/generation-wait.js';

const error = 'runtime run failed: internal LLM service image response must be one trusted stable URL';
const panel = `<div><p>${error}</p><button>Retry</button></div>`;
const preview = (body: string) => `<div class="product-image-container"><div class="jjb-app">${body}</div></div>`;

test('recorded business failure aborts 2D image wait without waiting five minutes', async ({ page }) => {
  await page.setContent(preview(panel));
  const started = Date.now();
  await expect(new CreatePage(page).waitForTwoDGeneration()).rejects.toThrow(`[GENERATION_FAILED] 等待生成图片节点；生成页面明确报错：${error}`);
  expect(Date.now() - started).toBeLessThan(3000);
});

test('business failure interrupts 3D wait too', async ({ page }) => {
  await page.setContent(preview(panel));
  await expect(new CreatePage(page).waitForThreeDGeneration()).rejects.toThrow('[GENERATION_FAILED]');
});

test('completed 3D with enabled cart still passes without submitting a purchase', async ({ page }) => {
  await page.setContent(preview('<button>3D</button><div data-view-name="3d">model</div>') + '<button>Add to Cart</button>');
  await new CreatePage(page).waitForThreeDGeneration();
});

test('an error appearing during a wait is detected; no automatic Retry click', async ({ page }) => {
  await page.setContent(preview('<div id="result"></div>'));
  await page.evaluate(html => { setTimeout(() => { document.querySelector('#result')!.innerHTML = html; }, 150); }, panel);
  await expect(waitForGenerationState(page, async () => false, 5000, '2D')).rejects.toThrow(error);
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('hidden errors and history or unrelated alerts do not fail current generation', async ({ page }) => {
  await page.setContent(panel + preview(`<div hidden>${panel}</div><div>Generating...</div>`) + `<section id="history">${panel}</section>`);
  expect(await generationFailure(page)).toBeUndefined();
  await waitForGenerationState(page, async () => true, 1000, 'ready');
});

test('Retry alone interrupts the wait without inventing an underlying cause', async ({ page }) => {
  await page.setContent(preview('<button>Retry</button>'));
  expect(await generationFailure(page)).toContain('未取得错误详情');
  await expect(waitForGenerationState(page, async () => true, 1000, '2D')).rejects.toThrow('[GENERATION_FAILED]');
});

test('error text alone interrupts 2D wait and preserves its message', async ({ page }) => {
  await page.setContent(preview(`<p>${error}</p>`));
  expect(await generationFailure(page)).toBe(error);
  await expect(new CreatePage(page).waitForTwoDGeneration()).rejects.toThrow(error);
});

test('error-only and Retry-only signals are independently ignored when hidden or outside preview', async ({ page }) => {
  await page.setContent(`<p>${error}</p><button>Retry</button>` + preview(`<p hidden>${error}</p><button style="display:none">Retry</button><p>Generating...</p>`));
  expect(await generationFailure(page)).toBeUndefined();
  await waitForGenerationState(page, async () => true, 1000, 'ready');
});

test('ordinary progress text is not an error and a Chinese error without Retry is detected', async ({ page }) => {
  await page.setContent(preview('<p>Generating image, please wait...</p>'));
  expect(await generationFailure(page)).toBeUndefined();
  await page.setContent(preview('<div>生成失败，请稍后再试</div>'));
  expect(await generationFailure(page)).toBe('生成失败，请稍后再试');
});

test('a Retry-only signal appearing during the wait interrupts without being clicked', async ({ page }) => {
  await page.setContent(preview('<div id="result"></div>'));
  await page.evaluate(() => { setTimeout(() => {
    document.querySelector('#result')!.innerHTML = '<button onclick="this.remove()">Retry</button>';
  }, 150); });
  await expect(waitForGenerationState(page, async () => false, 5000, '3D')).rejects.toThrow('未取得错误详情');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('valid loaded image still passes, even in hidden completed 2D view', async ({ page }) => {
  await page.setContent(preview('<div data-view-name="2d" hidden><img alt="Generated Toy Result"></div>'));
  await page.locator('img').evaluate((img: HTMLImageElement) => { const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;img.src=canvas.toDataURL(); });
  const create = new CreatePage(page);
  await create.expectImageResourceLoaded(create.twoDResultImage, 2000);
});

test('missing or broken image still fails, no false success', async ({ page }) => {
  for (const body of ['', '<div data-view-name="2d"><img alt="Generated Toy Result" src="data:image/png;base64,broken"></div>']) {
    await page.setContent(preview(body));
    const create = new CreatePage(page);
    await expect(create.expectImageResourceLoaded(create.twoDResultImage, 350)).rejects.toThrow('生成图片未完成加载');
  }
});

test('raw error is redacted before reporting', async ({ page }) => {
  await page.setContent(preview('<div><p>failed token=private123 user@example.com https://private.invalid/file</p><button>Retry</button></div>'));
  const message = await generationFailure(page);
  expect(message).toContain('failed');
  expect(message).not.toMatch(/private123|user@example|private.invalid/);
});

test('unresponsive readiness callback is bounded', async ({ page }) => {
  await page.setContent(preview(''));
  await expect(waitForGenerationState(page, () => new Promise(() => {}), 150, 'probe')).rejects.toThrow('probe 超过');
});
