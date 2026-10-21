import { expect, Locator, Page } from '@playwright/test';

export class CheckoutPage {
  readonly orderSummary: Locator;
  readonly emailInput: Locator;
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly addressInput: Locator;
  readonly cityInput: Locator;
  readonly shippingAddressForm: Locator;
  readonly postalCodeInput: Locator;
  readonly phoneInput: Locator;
  readonly discountButton: Locator;

  constructor(readonly page: Page) {
    this.orderSummary = page.getByText('Order summary', { exact: true }).filter({ visible: true }).first();
    this.emailInput = page.getByPlaceholder('Email');
    this.firstNameInput = page.getByPlaceholder('First name');
    this.lastNameInput = page.getByPlaceholder('Last name');
    this.addressInput = page.getByPlaceholder('Address', { exact: true });
    this.cityInput = page.getByPlaceholder('City');
    this.shippingAddressForm = page.locator('#shippingAddressForm');
    // Verified in the failed Checkout trace: Mexico uses "Postal code" and
    // Shopify also renders a hidden autofill copy. Never match billing fields.
    const postalLabel = /^(?:ZIP code|Postal code|Postcode)$/i;
    this.postalCodeInput = this.shippingAddressForm
      .locator('input[name="postalCode"], input[autocomplete~="postal-code"]')
      .or(this.shippingAddressForm.getByRole('textbox', { name: postalLabel }))
      .or(this.shippingAddressForm.getByPlaceholder(postalLabel))
      .filter({ visible: true });
    this.phoneInput = page.getByPlaceholder('Phone');
    this.discountButton = page.getByRole('button', { name: 'Add discount', exact: true });
  }

  async expectVisible(): Promise<void> {
    await expect(this.page).toHaveURL(/\/checkouts\//);
    await expect(this.orderSummary).toBeVisible();
    await expect(this.emailInput).toBeVisible();
    await expect(this.firstNameInput).toBeVisible();
    await expect(this.lastNameInput).toBeVisible();
    await expect(this.addressInput).toBeVisible();
    await expect(this.cityInput).toBeVisible();
    await this.expectPostalCodeVisible();
    await expect(this.phoneInput).toBeVisible();
    await expect(this.discountButton).toBeVisible();
  }

  async expectPostalCodeVisible(): Promise<void> {
    await expect(this.shippingAddressForm, 'Checkout 配送地址表单应可见').toBeVisible();
    const countries = await this.page.getByRole('combobox', { name: /^Country(?:\/Region)?$/i })
      .evaluateAll(elements => elements.filter((element): element is HTMLSelectElement => element instanceof HTMLSelectElement)
        .map(element => element.selectedOptions[0]?.textContent?.trim()).filter(Boolean));
    const diagnostic = `Checkout 配送邮编字段应唯一且可见（国家/地区：${countries.join(' / ') || '未读取到'}）`;
    await expect(this.postalCodeInput, diagnostic).toHaveCount(1);
    await expect(this.postalCodeInput, diagnostic).toBeVisible();
  }
}
