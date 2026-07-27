import { expect, test } from '@playwright/test';
import { CreatePage } from './pages/create.page.js';

test.describe('非生成顺序用例 @smoke', () => {
  test('TC-01: 首页 Create 可以进入创作页面', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const create = new CreatePage(page);
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
    const create = new CreatePage(page);
    await create.gotoProductPage();
    await create.waitForCustomizer(300_000);

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
