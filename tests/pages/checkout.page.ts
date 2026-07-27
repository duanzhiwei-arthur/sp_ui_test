import { expect, Locator, Page } from '@playwright/test';

export class CheckoutPage {
  readonly orderSummary: Locator;
  readonly emailInput: Locator;
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly addressInput: Locator;
  readonly cityInput: Locator;
  readonly postalCodeInput: Locator;
  readonly phoneInput: Locator;
  readonly discountButton: Locator;
  readonly payNowButton: Locator;

  constructor(readonly page: Page) {
    this.orderSummary = page.getByText('Order summary', { exact: true }).filter({ visible: true }).first();
    this.emailInput = page.getByPlaceholder('Email');
    this.firstNameInput = page.getByPlaceholder('First name');
    this.lastNameInput = page.getByPlaceholder('Last name');
    this.addressInput = page.getByPlaceholder('Address', { exact: true });
    this.cityInput = page.getByPlaceholder('City');
    this.postalCodeInput = page.getByPlaceholder('ZIP code');
    this.phoneInput = page.getByPlaceholder('Phone');
    this.discountButton = page.getByRole('button', { name: 'Add discount', exact: true });
    this.payNowButton = page.getByRole('button', { name: 'Pay now', exact: true });
  }

  async expectVisible(): Promise<void> {
    await expect(this.orderSummary).toBeVisible();
    await expect(this.emailInput).toBeVisible();
    await expect(this.firstNameInput).toBeVisible();
    await expect(this.lastNameInput).toBeVisible();
    await expect(this.addressInput).toBeVisible();
    await expect(this.cityInput).toBeVisible();
    await expect(this.postalCodeInput).toBeVisible();
    await expect(this.phoneInput).toBeVisible();
    await expect(this.discountButton).toBeVisible();
    await expect(this.payNowButton).toBeDisabled();
  }
}
