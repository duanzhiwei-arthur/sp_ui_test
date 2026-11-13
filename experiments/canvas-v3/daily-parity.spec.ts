import { test, expect } from './board.js';

test.describe('新增实验组：同步定时TC-01～TC-05业务功能 @manual-daily-parity', () => {
  test('EXP-TC-01：首页Create进入新画板且增信同时命中', async ({ page, board }) => {
    const response = await page.goto('/', { waitUntil: 'commit' }); expect(response?.ok()).toBe(true);
    await expect(page.locator('header.site-header')).toBeVisible({ timeout: 60_000 }); await board.dismiss();
    const create = page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link', { name: 'Create', exact: true }); await expect(create).toHaveCount(1); await create.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/products/customize-your-own');
    await board.ready();
    await expect(board.root.locator('.jjb-v3-steps')).toContainText('3D Preview');
    board.note('对应对照TC-01', '首页真实Create跳转，新画板与增信可见');
  });

  test('EXP-TC-02：模板、Prompt、Solo/Duo和增信交互', async ({ page, board }) => {
    await board.open();
    await test.step('Free Style → TRPG → Free Style', async () => {
      await page.getByRole('button', { name: 'Choose template: Free Style', exact: true }).click();
      await page.getByRole('menuitemradio', { name: 'TRPG', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Choose template: TRPG', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Choose template: TRPG', exact: true }).click();
      await page.getByRole('menuitemradio', { name: 'Free Style', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Choose template: Free Style', exact: true })).toBeVisible();
    });
    await test.step('Solo → Duo → Solo', async () => {
      await page.getByRole('button', { name: 'Settings: SOLO', exact: true }).click();
      await page.getByRole('menuitemradio', { name: 'DUO', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Settings: DUO', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Settings: DUO', exact: true }).click();
      await page.getByRole('menuitemradio', { name: 'SOLO', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Settings: SOLO', exact: true })).toBeVisible();
    });
    await test.step('新画板内联Prompt替代旧Prompt弹窗', async () => {
      await board.upload(); const input = page.getByPlaceholder('Add your prompt (Optional)', { exact: true });
      await expect(input).toBeEditable(); await input.fill('Two friendly dogs.'); await expect(input).toHaveValue('Two friendly dogs.');
      await input.fill(''); await expect(input).toHaveValue('');
    });
    await test.step('增信三个入口可打开并关闭', async () => {
      for (const name of ['Digital Crafting', 'Ship Policy', 'Quality & Guarantee']) {
        await page.getByRole('button', { name, exact: true }).click();
        const dialog = page.locator('dialog[open]'); await expect(dialog).toBeVisible();
        await dialog.locator('.canvas-trust__close').click(); await expect(dialog).toHaveCount(0);
      }
    });
    board.note('对应对照TC-02差异', '新画板内联Prompt、Settings菜单；旧Pro/Basic工具模式为UI改版移除项，未宣称该旧子检查通过');
  });

  test('EXP-TC-03：真实生成2D/3D、旋转、加购及Checkout', async ({ board }) => {
    await board.open(); await board.upload();
    await test.step('真实生成并加载2D', async () => { await board.generate(); await board.wait2D(); });
    await test.step('真实3D完成并拖动两秒', () => board.wait3DAndRotate());
    await test.step('真实加购、购物车及Checkout订单摘要，不付款', () => board.addAndCheckout());
  });

  // 保留与定时流程相同的风险排序：先验证完整生成/History，再执行留后台任务场景。
  test('EXP-TC-05：图片加Prompt生成后History新增并删除本次记录', async ({ page, board }) => {
    await board.open(); await board.upload();
    const input = page.getByPlaceholder('Add your prompt (Optional)', { exact: true });
    await input.fill('Two friendly dogs.'); await expect(input).toHaveValue('Two friendly dogs.');
    await board.generate(); await board.wait2D(); await board.wait3DAndRotate();
    await test.step('History新增且只删除本次记录', () => board.deleteOwnRecord());
  });

  test('EXP-TC-04：生成中返回Create后Generate可用', async ({ board }) => {
    await board.open(); await board.upload();
    await test.step('提交生成后直接返回 Create，不等待 2D/3D 完成', async () => {
      await board.generate();
      await board.create();
    });
    await test.step('仅断言 Generate 可用，不重新上传或提交第二次生成', async () => {
      const generate = board.root.getByRole('button', { name: 'Generate', exact: true });
      await expect(generate).toBeVisible({ timeout: 10_000 });
      await expect(generate).toBeEnabled({ timeout: 10_000 });
    });
    board.note('对应对照TC-04', '生成中直接返回Create后Generate可用；不重新上传、不等待2D/3D、不提交第二次任务。首任务可能继续执行');
  });
});
