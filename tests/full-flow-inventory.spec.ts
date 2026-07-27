import { test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { assetPath, canRunGeneration, testData } from './fixtures/test-data.js';
import { CartDrawer } from './pages/cart-drawer.page.js';
import { CreatePage } from './pages/create.page.js';
import { CheckoutPage } from './pages/checkout.page.js';

function inventoryScript() {
  const scope = document;
  return {
    buttons: [...scope.querySelectorAll('button')].map((element) => ({
      name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '',
      disabled: (element as HTMLButtonElement).disabled,
      ariaPressed: element.getAttribute('aria-pressed')
    })),
    inputs: [...scope.querySelectorAll('input')].map((element) => ({
      type: (element as HTMLInputElement).type,
      placeholder: (element as HTMLInputElement).placeholder,
      ariaLabel: element.getAttribute('aria-label')
    })),
    links: [...scope.querySelectorAll('a')].map((element) => ({
      name: element.textContent?.trim() ?? '',
      href: element.getAttribute('href')
    }))
  };
}

const skipCoreSmoke = !canRunGeneration() || !existsSync(assetPath(testData.soloImage));

test.describe('核心生成链路 @core-smoke', () => {
  test.skip(skipCoreSmoke, '需配置测试素材并显式允许线上生成及加购。');

  test('TC-20: 上传图片并生成后可加购进入 Checkout', async ({ page }) => {
    test.setTimeout(900_000);
    const create = new CreatePage(page);

    await test.step('打开自定义器并上传测试图片', async () => {
      await create.gotoProductPage();
      await create.waitForCustomizer(300_000);
      await create.uploadImage(assetPath(testData.soloImage));
    });

    await test.step('生成并验证 2D 图片', async () => {
      await create.startGeneration();
      await create.waitForTwoDGeneration();
    });

    await test.step('等待 3D 完成并横向拖动 2 秒', async () => {
      await create.waitForThreeDGeneration();
      await create.rotateThreeDPreview();
      await writeFile('generation-elements.json', JSON.stringify(await page.evaluate(inventoryScript), null, 2));
    });

    const cart = new CartDrawer(page);
    await test.step('加入购物车并确认商品存在', async () => {
      await create.click(create.addToCartButton);
      await page.goto('/cart', { waitUntil: 'domcontentloaded' });
      await cart.expectHasItems();
      await writeFile('cart-elements.json', JSON.stringify(await page.evaluate(inventoryScript), null, 2));
    });

    await test.step('进入 Checkout 并验证结账页', async () => {
      await cart.checkout();
      await new CheckoutPage(page).expectVisible();
      await writeFile('checkout-elements.json', JSON.stringify(await page.evaluate(inventoryScript), null, 2));
    });
  });
});
