import { expect, test } from '@playwright/test';
import { CheckoutPage } from '../../tests/pages/checkout.page.js';

function fixture(country: string, inputs: string) {
  return `<main><label>Country/Region<select><option selected>${country}</option></select></label>
    <div id="shippingAddressForm"><input placeholder="Address">${inputs}</div>
    <section aria-label="Billing"><input name="postalCode" placeholder="ZIP code"></section></main>`;
}

test.beforeEach(async ({ context }) => {
  // These tests use only setContent, and external network is denied.
  await context.route('**/*', route => route.abort());
});

for (const [country, label] of [['United States', 'ZIP code'], ['Mexico', 'Postal code'], ['United Kingdom', 'Postcode']]) {
  test(`${country}: ${label} + hidden autofill + billing duplicate`, async ({ page }) => {
    await page.setContent(fixture(country, `<input name="postalCode" autocomplete="shipping postal-code" placeholder="${label}">
      <input style="display:none" name="postalCode" autocomplete="shipping postal-code" aria-label="${label}">`));
    const checkout = new CheckoutPage(page);
    await checkout.expectPostalCodeVisible();
    await expect(checkout.postalCodeInput).toHaveAttribute('placeholder', label);
  });
}

for (const label of ['ZIP code', 'Postal code', 'Postcode']) {
  test(`fallback with only placeholder: ${label}`, async ({ page }) => {
    await page.setContent(fixture('Example', `<input placeholder="${label}">`));
    await new CheckoutPage(page).expectPostalCodeVisible();
  });
}

test('stable autocomplete works independently of localized copy', async ({ page }) => {
  await page.setContent(fixture('Example', '<input autocomplete="shipping postal-code" placeholder="邮政编码">'));
  await new CheckoutPage(page).expectPostalCodeVisible();
});

test('accessible label without placeholder is supported', async ({ page }) => {
  await page.setContent(fixture('Mexico', '<label>Postal code<input></label>'));
  await new CheckoutPage(page).expectPostalCodeVisible();
});

for (const label of ['ZIP code', 'Postal code', 'Postcode']) {
  test(`complete Checkout assertions: ${label}`, async ({ page }) => {
    const html = fixture('Example', `<input name="postalCode" placeholder="${label}">`) +
      '<h2>Order summary</h2><input placeholder="Email"><input placeholder="First name">' +
      '<input placeholder="Last name"><input placeholder="City"><input placeholder="Phone">' +
      '<button>Add discount</button>';
    await page.route('https://checkout-fixture.invalid/checkouts/test', route =>
      route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('https://checkout-fixture.invalid/checkouts/test');
    await new CheckoutPage(page).expectVisible();
  });
}

test('switching country replaces the input without rebuilding Page Object', async ({ page }) => {
  await page.setContent(fixture('United States', '<input name="postalCode" placeholder="ZIP code">'));
  const checkout = new CheckoutPage(page);
  await checkout.expectPostalCodeVisible();
  await page.evaluate(() => {
    document.querySelector('option')!.textContent = 'Mexico';
    document.querySelector('#shippingAddressForm')!.innerHTML = '<input name="postalCode" placeholder="Postal code">';
  });
  await checkout.expectPostalCodeVisible();
  await expect(checkout.postalCodeInput).toHaveAttribute('placeholder', 'Postal code');
});

for (const [name, html] of [
  ['missing', ''],
  ['hidden only', '<input name="postalCode" style="display:none">'],
  ['ambiguous visible copies', '<input name="postalCode"><input name="postalCode">'],
  ['unrelated field', '<input placeholder="Postal code lookup">']
]) {
  test(`reject ${name}; billing input must not rescue it`, async ({ page }) => {
    await page.setContent(fixture('Mexico', html));
    await expect(new CheckoutPage(page).expectPostalCodeVisible()).rejects.toThrow(/国家\/地区：Mexico/);
  });
}
