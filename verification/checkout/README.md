# Checkout 定位器回归

运行 `npm run test:checkout-locators`。

使用本地 HTML 和路由模拟，在真实 Chromium 中核验 Page Object，不访问线上，不生成、不加购、不下单。独立配置 `playwright.checkout.config.ts` 将这些验证与生产 `tests/` 用例隔离，不改变 daily 用例数量。

依据远端失败运行 `39560402513` 的 Trace：配送输入框位于 `#shippingAddressForm`，`name=postalCode`、`autocomplete=shipping postal-code`，Mexico 使用 `Postal code`；还有自动填充副本。

覆盖 ZIP code / Postal code / Postcode、语义标签和 autocomplete、隐藏副本、账单地址隔离、动态国家切换、字段缺失及匹配歧义，并调用完整 `CheckoutPage.expectVisible()` 验证兼容性。

不强制选择国家，也不把缺少邮编的地区自动豁免。若将来需要覆盖不要求邮编的地区，应另行根据明确业务要求建立地区规则，不能以定位失败为由直接跳过。

这些验证证明定位器修复，不等于重新执行了线上 TC-03 的生成/结账全流程。
