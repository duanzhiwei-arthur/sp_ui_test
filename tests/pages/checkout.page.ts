import { expect, Locator, Page } from '@playwright/test';

export class CheckoutPage {
  readonly orderSummary: Locator;
  readonly productLinks: Locator;
  readonly payNowButton: Locator;

  constructor(readonly page: Page) {
    this.orderSummary = page.getByText('Order summary', { exact: true }).filter({ visible: true }).first();
    this.productLinks = page.locator('a[href*="/products/"]:visible');
    this.payNowButton = page.getByRole('button', { name: /Pay now/i }).or(
      page.getByRole('button', { name: /Complete order|Place order|Submit order/i })
    ).filter({ visible: true }).first();
  }

  async expectVisible(): Promise<void> {
    await expect(this.page).toHaveURL(/\/checkouts\//);
    await expect(this.orderSummary).toBeVisible();
    await expect(this.productLinks.first(), 'Checkout 订单摘要应包含商品链接').toBeVisible();
    await expect(this.payNowButton, 'Checkout 应展示 Pay now 或等价支付入口，但测试不会点击').toBeVisible();
  }
}
