import { test, expect } from './board.js';

test.describe('新画板实验组：完整生成与购买入口 @normal-experiment', () => {
  test('EXP-TC-01：新画板Duo＋TRPG生成、3D旋转缩放及Checkout', async ({ board }) => {
    await test.step('进入新画板并确认3D Preview步骤出现', async () => {
      await board.open();
      await expect(board.root.locator('.jjb-v3-steps')).toContainText('3D Preview');
    });
    await test.step('上传图片→选择Duo→选择TRPG', async () => {
      await board.upload();
      await board.selectDuoAndTrpg();
    });
    await test.step('点击Generate并等待真实2D与3D完成', async () => {
      await board.generate();
      await board.wait2D();
      await board.wait3DAndRotate();
    });
    await test.step('验证3D放大与缩小', () => board.zoomThreeD());
    await test.step('本轮资产加购→购物车→Checkout商品及支付入口，不支付', () => board.addAndCheckout());
  });
});
