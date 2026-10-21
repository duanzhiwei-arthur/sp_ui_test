import { expect, Locator, Page } from '@playwright/test';

export class CheckoutPage {
  readonly orderSummary: Locator;
  readonly productRows: Locator;
  readonly payNowButton: Locator;

  constructor(readonly page: Page) {
    this.orderSummary = page.getByText('Order summary', { exact: true }).filter({ visible: true }).first();
    // Checkout renders the product description as text, not necessarily a link.
    // Scope to the actual cart table and exclude its column-header row.
    this.productRows = page.getByRole('table', { name: 'Shopping cart', exact: true })
      .filter({ visible: true }).getByRole('row')
      .filter({ has: page.getByRole('cell') }).filter({ visible: true });
    this.payNowButton = page.getByRole('button', { name: /Pay now/i }).or(
      page.getByRole('button', { name: /Complete order|Place order|Submit order/i })
    ).filter({ visible: true }).first();
  }

  async expectVisible(): Promise<void> {
    await expect(this.page).toHaveURL(/\/checkouts\//);
    await expect(this.orderSummary).toBeVisible();
    const product = this.productRows.first();
    await expect(product, 'Checkout 订单摘要应包含实际商品行').toBeVisible();
    await expect(product.getByRole('cell').nth(1), 'Checkout 商品描述应可见且非空').toBeVisible();
    await expect(product.getByRole('cell').nth(1), 'Checkout 商品描述不能为空').toContainText(/\S/u);
    await expect(this.payNowButton, 'Checkout 应展示 Pay now 或等价支付入口，但测试不会点击').toBeVisible();
  }
}
