import { expect, test } from '@playwright/test';
import { experimentRegistry, statsigStableIdStorageKey } from './experiments/experiment-registry.js';
import { CreatePage } from './pages/create.page.js';

test.describe('非生成顺序用例 @smoke', () => {
  test('TC-01: 首页 Create 可以进入创作页面', async ({ page }) => {
    const create = new CreatePage(page);
    await create.gotoHomePage();
    await create.dismissMarketingPopup();
    const createLink = page.getByRole('link', { name: 'Create', exact: true });
    await expect(createLink).toHaveCount(1);
    await create.click(createLink);
    await expect(page).toHaveURL(/\/products\/customize-your-own/);
    await create.waitForCustomizer();
    await expect(create.galleryTab).toBeVisible();
  });

  test('TC-02: 自定义器基础交互可以正常切换', async ({ page }) => {
    test.setTimeout(360_000);
    const control = experimentRegistry.canvasTemplateDisplay.variants.control;
    await page.addInitScript(({ stableId, storageKey }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(stableId));
      window.localStorage.setItem('stable_id', stableId);
      window.localStorage.setItem('stableId', stableId);
    }, { stableId: control.stableId, storageKey: statsigStableIdStorageKey() });
    const create = new CreatePage(page);
    await create.gotoProductPage();
    await create.waitForCustomizer(300_000);

    await expect.poll(
      () => page.evaluate(async () => {
        const target = window as Window & {
          statsigReady?: Promise<void>;
          statsigClient?: {
            getContext(): { stableID?: string };
            getExperiment(name: string): { get(key: string, fallback: unknown): unknown };
          };
        };
        await target.statsigReady;
        return {
          stableId: target.statsigClient?.getContext().stableID,
          group: target.statsigClient?.getExperiment('canvas_template_display').get('group', null)
        };
      }),
      { message: 'TC-02 应固定命中画板实验 Control', timeout: 30_000 }
    ).toEqual({ stableId: control.stableId, group: control.expectedValue });

    await test.step('Free Style 菜单可以选择 TRPG 并切回 Free Style', async () => {
      await create.click(create.styleButton);
      await expect(create.trpgStyleButton).toBeVisible();
      await create.click(create.trpgStyleButton);
      await expect(create.trpgStyleButton).toBeVisible();

      await create.click(create.trpgStyleButton);
      await expect(create.styleButton).toBeVisible();
      await create.click(create.styleButton);
      await expect(create.styleButton).toBeVisible();
    });

    await test.step('Prompt 编辑框可以打开', async () => {
      await create.click(create.promptButton);
      await expect(create.promptInput).toBeVisible();
      await expect(create.promptInput).toBeEditable();
      await expect(create.cancelPromptEditingButton).toBeVisible();
      await expect(create.confirmPromptEditingButton).toBeVisible();
      await create.click(create.cancelPromptEditingButton);
    });

    await test.step('Solo 可以切换为 Duo 并恢复', async () => {
      await create.click(create.soloMode);
      await expect(create.duoMode).toBeVisible();
      await create.click(create.duoMode);
      await expect(create.soloMode).toBeVisible();
    });

    await test.step('Pro 和 Basic 模式展示对应的工具图标', async () => {
      await expect(create.modeToggleButton).toBeVisible();
      if ((await create.modeToggleButton.textContent())?.trim().toLowerCase() === 'basic') {
        await create.click(create.modeToggleButton);
      }
      await expect(create.modeToggleButton).toContainText(/pro/i);
      await expect(create.proToolButtons).toHaveCount(3);

      await create.click(create.modeToggleButton);
      await expect(create.modeToggleButton).toContainText(/basic/i);
      await expect(create.proToolButtons).toHaveCount(0);
    });
  });

});
