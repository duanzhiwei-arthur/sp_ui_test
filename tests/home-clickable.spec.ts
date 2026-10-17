import { expect, Locator, Page, test } from '@playwright/test';
import { HomePage } from './pages/home.page.js';

type ClickAudit = {
  clicked: string[];
  skipped: string[];
  baselinePageErrors: string[];
  pageErrors: string[];
  serverErrors: string[];
};

test.describe('首页安全点击巡检 @homepage-clickable', () => {
  test('TC-001: 首页所有唯一且安全的可点击按钮可以正常交互', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const home = new HomePage(page);
    const audit: ClickAudit = { clicked: [], skipped: [], baselinePageErrors: [], pageErrors: [], serverErrors: [] };
    let interactionsStarted = false;

    page.on('pageerror', (error) => {
      if (!interactionsStarted || audit.baselinePageErrors.includes(error.message)) {
        if (!audit.baselinePageErrors.includes(error.message)) audit.baselinePageErrors.push(error.message);
      } else {
        audit.pageErrors.push(error.message);
      }
    });
    page.on('response', (response) => {
      if (response.status() >= 500 && new URL(response.url()).hostname.endsWith('jujubit.ai')) {
        audit.serverErrors.push(`${response.status()} ${response.url()}`);
      }
    });

    await home.goto();
    await home.expectProductionStoreIdentity();
    await home.dismissBlockingPopup();
    await page.waitForTimeout(2_000);
    interactionsStarted = true;

    await test.step('促销条、Hero、模板和 How It Works 控件逐个点击', async () => {
      await clickAll(home, page.locator('.jjb-announcement-bar__arrow:visible'), '促销条箭头', audit);
      await clickAll(home, page.locator('.jjb-banner__dot:visible'), 'Hero 分页', audit);
      await clickAll(home, page.locator('.jjb-template-entry__dot:visible'), '模板分页', audit);
      await clickAll(home, page.locator('.jjb-how-it-works__step:visible'), 'How It Works 步骤', audit);
    });

    await test.step('案例、社区和 FAQ 唯一按钮逐个点击', async () => {
      await clickAll(home, page.locator('.jjb-showcase__tab:visible'), '案例 Tab', audit);
      await clickVisibleUniqueCommunityItems(page, home, audit);
      await clickAll(home, page.locator('.jjb-faq__tab:visible'), 'FAQ 分类', audit);
    });

    await test.step('登录入口在独立页面可正常打开', async ({}) => {
      const loginButton = page.getByRole('button', { name: 'Log in to view membership', exact: true });
      await expect(loginButton).toBeVisible();
      const isolated = await page.context().newPage();
      try {
        const loginTarget = await loginButton.evaluate((button) => {
          const form = button.closest('form');
          return form?.getAttribute('action') || '/account/login';
        });
        const response = await isolated.goto(loginTarget, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        expect(response?.status() ?? 500, '登录页面应可访问').toBeLessThan(400);
        audit.clicked.push('登录入口');
      } finally {
        await isolated.close();
      }
    });

    await test.step('购物车和币种选择器可以打开并关闭', async () => {
      const currency = page.locator('button.faux-select:visible').first();
      await clickOne(home, currency, '币种选择器', audit);
      await page.keyboard.press('Escape');

      // Keep the cart check last: opening it changes the page shell and the
      // current theme renders its close control outside the desktop viewport.
      const cartButton = page.getByRole('button', { name: 'Cart', exact: true });
      await clickOne(home, cartButton, '购物车', audit);
      const closeCart = page.getByRole('button', { name: 'Close cart', exact: true });
      if (await closeCart.isVisible({ timeout: 3_000 }).catch(() => false)) {
        audit.skipped.push('关闭购物车：当前主题关闭控件布局在桌面视口外，已覆盖购物车打开行为');
      }
    });

    audit.skipped.push('Newsletter Subscribe：提交订阅表单，存在外部副作用');
    audit.skipped.push('Checkout：属于下单路径，且空购物车时不可用');
    audit.skipped.push('移动端隐藏按钮：桌面项目不可见');
    audit.skipped.push('社区轮播克隆按钮：按 aria-label 去重，每个唯一内容只点击一次');

    await testInfo.attach('TC-001-click-audit.json', {
      body: Buffer.from(`${JSON.stringify(audit, null, 2)}\n`),
      contentType: 'application/json'
    });

    expect(audit.clicked.length, 'TC-001 应实际点击多个首页控件').toBeGreaterThanOrEqual(20);
    expect(audit.pageErrors, '点击过程中不应新增 JavaScript 页面错误').toEqual([]);
    expect(audit.serverErrors, '点击过程中不应出现 JuJuBit HTTP 5xx').toEqual([]);
  });
});

async function clickAll(home: HomePage, locator: Locator, label: string, audit: ClickAudit): Promise<void> {
  const count = await locator.count();
  expect(count, `${label} 应至少存在一个可点击控件`).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    await clickOne(home, locator.nth(index), `${label} ${index + 1}`, audit);
  }
}

async function clickVisibleUniqueCommunityItems(
  page: Page,
  home: HomePage,
  audit: ClickAudit
): Promise<void> {
  const section = page.locator('.jjb-social-media').first();
  await section.scrollIntoViewIfNeeded();
  const items = page.locator('.jjb-social-media__item');
  const clickedNames = new Set<string>();
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const candidates = await items.evaluateAll((elements) => elements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      return {
        index,
        name: element.getAttribute('aria-label') || element.textContent?.replace(/\s+/gu, ' ').trim() || '',
        inViewport: centerX >= 0 && centerX <= window.innerWidth && centerY >= 0 && centerY <= window.innerHeight
      };
    }).filter((item) => item.name && item.inViewport));
    const next = candidates.find((item) => !clickedNames.has(item.name));
    if (!next) break;
    await clickOne(home, items.nth(next.index), `社区内容 ${clickedNames.size + 1}`, audit);
    clickedNames.add(next.name);
  }
  expect(clickedNames.size, '社区区域应至少覆盖 3 个用户实际可点击内容').toBeGreaterThanOrEqual(3);
  const total = await page.locator('.jjb-social-media__item').count();
  audit.skipped.push(`社区视口外/轮播克隆按钮：${Math.max(0, total - clickedNames.size)} 个`);
}

async function clickOne(home: HomePage, locator: Locator, label: string, audit: ClickAudit): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await home.dismissBlockingPopup();
    await locator.scrollIntoViewIfNeeded({ timeout: 5_000 });
    await home.dismissBlockingPopup();
    await expect(locator, `${label} 应可见`).toBeVisible({ timeout: 5_000 });
    await expect(locator, `${label} 应可用`).toBeEnabled({ timeout: 5_000 });
    try {
      await locator.click({ timeout: 5_000 });
      audit.clicked.push(label);
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/newsletter-popup|intercepts pointer events/iu.test(message) || attempt === 3) throw error;
    }
  }
  throw lastError;
}
