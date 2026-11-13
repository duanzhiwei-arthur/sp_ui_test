import { expect, Locator, Page } from '@playwright/test';
import type { RunAssets } from '../fixtures/run-assets.js';
import { readCartJson } from '../fixtures/read-only-retry.js';

export class CartDrawer {
  readonly cartPageRoot: Locator;
  readonly cartButton: Locator;
  readonly checkoutButton: Locator;
  readonly cartItemQuantities: Locator;

  constructor(readonly page: Page) {
    this.cartPageRoot = page.locator('#custom-cart-page-root');
    this.cartButton = page.getByRole('button', { name: 'Cart', exact: true });
    this.checkoutButton = this.cartPageRoot.getByRole('button', { name: /^Check\s*out$/i });
    this.cartItemQuantities = this.cartPageRoot.getByRole('spinbutton');
  }

  async open(): Promise<void> {
    await this.click(this.cartButton);
    await expect(this.checkoutButton).toBeVisible();
  }

  async checkout(): Promise<void> {
    await expect(this.checkoutButton).toBeVisible();
    await expect(this.checkoutButton).toBeEnabled();
    await Promise.all([
      this.page.waitForURL(/\/checkouts\//, { timeout: 300_000, waitUntil: 'domcontentloaded' }),
      this.checkoutButton.click({ noWaitAfter: true })
    ]);
  }

  async expectHasItems(): Promise<void> {
    await expect(this.cartPageRoot).toBeVisible();
    await expect(this.cartItemQuantities.first()).toBeVisible();
    await expect.poll(
      async () => Number(await this.cartItemQuantities.first().inputValue()),
      { message: '购物车商品数量应大于 0' }
    ).toBeGreaterThan(0);
    await expect(this.checkoutButton).toBeVisible();
    await expect(this.checkoutButton).toBeEnabled();
  }

  async addCurrentAsset(click: () => Promise<void>, assets: RunAssets): Promise<void> {
    const asset = await assets.requireSingleAsset();
    const origin = new URL(this.page.url()).origin;
    const [response] = await Promise.all([
      this.page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).origin === origin
        && /\/cart\/add\.js$/.test(new URL(r.url()).pathname), { timeout: 30_000 }), click()
    ]);
    expect(response.ok(), '[CART_ASSET] 本次加购接口应成功').toBe(true);
    const body = await response.json();
    const rows = Array.isArray(body.items) ? body.items : [body];
    const item = rows.find((r: { properties?: Record<string, unknown> }) => String(r.properties?.['_Record ID']) === asset.assetId);
    expect(item, '[CART_ASSET] 加购响应必须属于本轮Asset ID').toBeTruthy();
    expect(typeof item.key, '[CART_ASSET] 加购响应应有精确购物车行键').toBe('string');
    expect(Number(item.quantity)).toBeGreaterThan(0);
    // 独立GET核对持久化；不重发加购、不用任意旧商品抵充本次结果。
    const contents = await readCartJson(this.page, '加购后本轮资产持久化查询');
    expect(contents.items?.some((r: { key?: string; quantity?: number; properties?: Record<string, unknown> }) =>
      r.key === item.key && String(r.properties?.['_Record ID']) === asset.assetId && Number(r.quantity) > 0), '[CART_ASSET] 本轮资产应实际存在于购物车').toBe(true);
    assets.recordCart(asset.assetId, item.key);
  }

  private async click(target: Locator): Promise<void> {
    await expect(target).toBeVisible();
    await expect(target).toBeEnabled();
    await target.click();
  }
}
