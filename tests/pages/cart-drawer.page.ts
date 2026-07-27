import { expect, Locator, Page } from '@playwright/test';

const actionPause = 2_000;

export class CartDrawer {
  readonly cartPageRoot: Locator;
  readonly cartButton: Locator;
  readonly checkoutButton: Locator;
  readonly checkoutWithItemsButton: Locator;

  constructor(readonly page: Page) {
    this.cartPageRoot = page.locator('#custom-cart-page-root');
    this.cartButton = page.getByRole('button', { name: 'Cart', exact: true });
    this.checkoutButton = this.cartPageRoot.getByRole('button', { name: /Check\s*out/i });
    this.checkoutWithItemsButton = this.cartPageRoot.getByRole('button', {
      name: /Check\s*out\s*\([1-9]\d*\)/i
    });
  }

  async open(): Promise<void> {
    await this.click(this.cartButton);
    await expect(this.checkoutButton).toBeVisible();
  }

  async checkout(): Promise<void> {
    await this.page.waitForTimeout(actionPause);
    await Promise.all([
      this.page.waitForURL(/\/checkouts\//, { timeout: 300_000, waitUntil: 'domcontentloaded' }),
      this.checkoutButton.click({ noWaitAfter: true })
    ]);
    await this.page.waitForTimeout(actionPause);
  }

  async expectHasItems(): Promise<void> {
    await expect(this.cartPageRoot).toBeVisible();
    await expect(this.checkoutWithItemsButton).toBeVisible();
    await expect(this.checkoutWithItemsButton).toBeEnabled();
  }

  private async click(target: Locator): Promise<void> {
    await this.page.waitForTimeout(actionPause);
    await target.click();
    await this.page.waitForTimeout(actionPause);
  }
}
