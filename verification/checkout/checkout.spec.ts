import { expect, test } from '@playwright/test';
import { CheckoutPage } from '../../tests/pages/checkout.page.js';

const row = (description = 'JuJuBit Customized Figurine') =>
  `<tr><td>Quantity 1</td><td>${description}</td><td>1</td><td>$59.50</td></tr>`;
const table = (rows: string) => `<table aria-label="Shopping cart"><thead><tr>
  <th>Product image</th><th>Description</th><th>Quantity</th><th>Price</th>
  </tr></thead><tbody>${rows}</tbody></table>`;

for (const scenario of [
  { name: '普通文本商品，无超链接', rows: row('<p>JuJuBit Customized Figurine</p>'), valid: true },
  { name: '商品含链接也兼容', rows: row('<a href="/products/example">Figurine</a>'), valid: true },
  { name: '多个商品行', rows: row() + row('Another product'), valid: true },
  { name: '忽略隐藏表格副本', rows: row(), extra: `<div hidden>${table(row())}</div>`, valid: true },
  { name: '表格只有表头且外围有商品链接', rows: '', extra: '<a href="/products/example">Figurine</a>', valid: false },
  { name: '商品描述为空', rows: row(' '), valid: false },
  { name: '支付入口缺失', rows: row(), noPayment: true, valid: false },
  { name: '支付入口隐藏', rows: row(), hiddenPayment: true, valid: false },
  { name: '订单摘要缺失', rows: row(), noSummary: true, valid: false },
  { name: '未进入Checkout', rows: row(), wrongRoute: true, valid: false }
]) {
  test(scenario.name, async ({ page, context }) => {
    const url = `https://checkout-fixture.invalid/${scenario.wrongRoute ? 'cart' : 'checkouts/test'}`;
    await context.route('**/*', route => route.request().url() === url
      ? route.fulfill({ contentType: 'text/html', body: `
        ${scenario.noSummary ? '' : '<h2>Order summary</h2>'}
        ${table(scenario.rows)}${scenario.extra ?? ''}
        ${scenario.noPayment ? '' : `<button ${scenario.hiddenPayment ? 'hidden' : ''}>Pay now $59.50</button>`}
        <script>window.paymentClicks=0;document.querySelector('button')?.addEventListener('click',()=>window.paymentClicks++);</script>` })
      : route.abort());
    await page.goto(url);
    const checkout = new CheckoutPage(page);
    if (scenario.valid) await checkout.expectVisible();
    else await expect(checkout.expectVisible()).rejects.toThrow();
    expect(await page.evaluate(() => Reflect.get(window, 'paymentClicks')), '断言不能点击支付').toBe(0);
  });
}
