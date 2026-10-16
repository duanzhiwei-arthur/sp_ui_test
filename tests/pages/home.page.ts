import { expect, Locator, Page } from '@playwright/test';

export class HomePage {
  readonly announcementBar: Locator;
  readonly header: Locator;
  readonly logo: Locator;
  readonly desktopNavigation: Locator;
  readonly hero: Locator;
  readonly templateEntry: Locator;
  readonly howItWorks: Locator;
  readonly categories: Locator;
  readonly trendingProducts: Locator;
  readonly showcase: Locator;
  readonly customerReviews: Locator;
  readonly socialMedia: Locator;
  readonly faq: Locator;
  readonly footer: Locator;

  constructor(readonly page: Page) {
    this.announcementBar = page.locator('.jjb-announcement-bar');
    this.header = page.locator('header.site-header.jjb-header__shell');
    this.logo = this.header.locator('.jjb-header__logo');
    this.desktopNavigation = this.header.locator('.jjb-header__menu');
    this.hero = page.locator('main > .jjb-banner-section');
    this.templateEntry = page.locator('main > .jjb-template-entry-section');
    this.howItWorks = page.locator('main .jjb-how-it-works').first();
    this.categories = page.locator('main .jjb-category-section').first();
    this.trendingProducts = page.locator('main .jjb-products-section').first();
    this.showcase = page.locator('main .jjb-showcase').first();
    this.customerReviews = page.locator('main .jjb-comment-section').first();
    this.socialMedia = page.locator('main .jjb-social-media').first();
    this.faq = page.locator('main .jjb-faq').first();
    this.footer = page.locator('footer.site-footer');
  }

  async goto(): Promise<void> {
    const response = await this.page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response, '首页导航应返回 HTTP 响应').not.toBeNull();
    expect(response?.status() ?? 500, '首页 HTTP 状态应小于 400').toBeLessThan(400);
    await expect(this.page).toHaveTitle(/JuJuBit/i);
    await expect(this.page.locator('main#MainContent')).toBeVisible();
  }

  async dismissBlockingPopup(): Promise<void> {
    const popup = this.page.locator('div[id$="__newsletter-popup"]').first();
    const closeButton = popup.getByRole('button', { name: 'Close', exact: true });
    if (await closeButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await closeButton.click();
      await expect(popup).toBeHidden();
    }
  }

  async expectHeaderHealthy(): Promise<void> {
    await expect(this.announcementBar).toBeVisible();
    await expect(this.header).toBeVisible();
    await expect(this.logo).toBeVisible();
    await expect(this.desktopNavigation).toBeVisible();
    for (const item of ['Create', 'Templates', 'Categories', 'How It Works', 'About Us']) {
      const link = this.desktopNavigation.getByRole('link', { name: item, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', /\S+/u);
    }
  }

  async expectModuleHealthy(section: Locator, heading: RegExp, label: string): Promise<void> {
    await section.scrollIntoViewIfNeeded();
    await expect(section, `${label} 模块应展示`).toBeVisible();
    await expect(section.getByRole('heading', { name: heading }).first(), `${label} 标题应展示`).toBeVisible();
    const size = await section.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height
    }));
    expect(size.width, `${label} 模块宽度应大于 0`).toBeGreaterThan(0);
    expect(size.height, `${label} 模块高度应大于 0`).toBeGreaterThan(0);
  }

  async expectFooterHealthy(): Promise<void> {
    await this.footer.scrollIntoViewIfNeeded();
    await expect(this.footer).toBeVisible();
    await expect(this.footer.getByText('Company', { exact: true }).first()).toBeVisible();
    await expect(this.footer.getByText('Policies', { exact: true }).first()).toBeVisible();
    await expect(this.footer.getByText('Support', { exact: true }).first()).toBeVisible();
  }
}
