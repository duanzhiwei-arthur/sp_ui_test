import { expect, Locator, Page } from '@playwright/test';
import { assetPath, testData } from '../fixtures/test-data.js';

/** Minimal page model used only by the standalone tracking suite. */
export class TrackingPage {
  readonly uploadButton: Locator;
  readonly promptButton: Locator;
  readonly cancelPromptEditingButton: Locator;
  readonly galleryTab: Locator;
  readonly createTab: Locator;
  readonly homeCreateLink: Locator;
  readonly modeToggleButton: Locator;
  readonly soloMode: Locator;
  readonly styleButton: Locator;
  readonly trpgStyleButton: Locator;
  readonly paintButton: Locator;
  readonly inspirationButtons: Locator;
  readonly deleteImageButton: Locator;
  readonly addToCartButton: Locator;
  readonly fileInput: Locator;
  readonly twoDButton: Locator;
  readonly threeDButton: Locator;
  readonly twoDResultImage: Locator;
  readonly threeDView: Locator;
  private readonly customizerLoading: Locator;
  private readonly generateButton: Locator;
  private readonly cookieBanner: Locator;
  private readonly cookieAcceptButton: Locator;
  private readonly cookieDeclineButton: Locator;
  private readonly marketingPopup: Locator;
  private readonly marketingPopupCloseButton: Locator;

  constructor(private readonly page: Page) {
    this.uploadButton = page.getByRole('button', { name: 'Upload your picture', exact: true });
    // POD_Canvas_Text_Click is emitted by the Pro toolbar's Text icon. The
    // canvas-level "Add Your Prompt" control opens the same editor but does not
    // execute that tracking call.
    this.promptButton = page.getByRole('button', { name: 'Text', exact: true });
    this.cancelPromptEditingButton = page.getByRole('button', { name: 'Cancel prompt editing', exact: true });
    this.galleryTab = page.getByRole('button', { name: 'Gallery', exact: true });
    this.createTab = page.getByRole('button', { name: 'Create', exact: true });
    // The desktop navigation is the stable, visible Create entry on the home
    // page. Do not use a product URL directly: tracking needs the actual
    // homepage-to-Create journey as well.
    this.homeCreateLink = page.locator('a.jjb-header__menu-link[href*="/products/customize-your-own"]');
    this.modeToggleButton = page.getByRole('button', { name: 'Upgrade', exact: true });
    this.soloMode = page.getByRole('button', { name: 'Solo', exact: true });
    this.styleButton = page.getByRole('button', { name: 'Free Style', exact: true }).first();
    this.trpgStyleButton = page.getByRole('button', { name: 'TRPG', exact: true });
    this.paintButton = page.getByRole('button', { name: 'Paint', exact: true });
    this.inspirationButtons = page.getByText('Need inspiration? Try these', { exact: true })
      .locator('xpath=../following-sibling::*[1]//button');
    this.deleteImageButton = page.getByRole('button', { name: 'Delete image', exact: true });
    this.addToCartButton = page.getByRole('button', { name: 'Add to Cart', exact: true });
    this.fileInput = page.locator('main input[type="file"]');
    this.twoDButton = page.getByRole('button', { name: '2D', exact: true });
    this.threeDButton = page.getByRole('button', { name: '3D', exact: true });
    const productPreview = page.locator('.product-image-container .jjb-app').first();
    this.twoDResultImage = productPreview.locator('[data-view-name="2d"] img[alt="Generated Toy Result"]');
    this.threeDView = productPreview.locator('[data-view-name="3d"]');
    this.customizerLoading = page.getByText('Loading customizer...', { exact: true });
    this.generateButton = page.getByRole('button', { name: 'Generate' });
    this.cookieBanner = page.locator('#shopify-pc__banner');
    this.cookieAcceptButton = this.cookieBanner.getByRole('button', { name: 'Accept', exact: true });
    this.cookieDeclineButton = this.cookieBanner.getByRole('button', { name: /decline|reject|拒绝/i }).first();
    this.marketingPopup = page.locator('div[id$="__newsletter-popup"]').first();
    this.marketingPopupCloseButton = page.getByRole('button', { name: /close (membership dialog|newsletter|popup)/i }).first();
  }

  async gotoHome(options: { consent?: 'accept' | 'decline' | 'none' } = {}): Promise<void> {
    const response = await this.page.goto(process.env.TRACKING_ENTRY_URL ?? '/', { waitUntil: 'domcontentloaded' });
    const status = response?.status();
    if (status === 410) {
      throw new Error(`测试环境已失效（HTTP 410）：${this.page.url()}。请更新 TRACKING_BASE_URL 后重试。`);
    }
    expect(status, '埋点测试首页应可访问').toBeLessThan(400);
    await this.handleCookieConsent(options.consent ?? 'accept');
    await this.dismissMarketingPopup();
  }

  /**
   * Enter the customizer through the site's Create navigation.  Keeping this
   * separate from gotoHome makes homepage and canvas events independently
   * attributable while exercising the real user path.
   */
  async gotoCustomizer(options: { requireCustomizer?: boolean; consent?: 'accept' | 'decline' | 'none' } = {}): Promise<void> {
    await this.gotoHome({ consent: options.consent });
    // The storefront can render the customizer from its cached/fallback config
    // while the legacy builder endpoint returns 500. UI readiness, not that
    // unrelated request's status, is the execution precondition.
    const builderResponse = this.page.waitForResponse(
      (response) => response.url().includes('/apps/builder/store/products/'),
      { timeout: 300_000 }
    ).catch(() => null);
    await Promise.all([
      this.page.waitForURL(/\/products\/customize-your-own(?:[/?#]|$)/, { timeout: 300_000 }),
      this.click(this.homeCreateLink)
    ]);
    if (options.requireCustomizer !== false) {
      await this.waitForCustomizer(builderResponse);
      await this.dismissMarketingPopup();
    }
  }

  /** Backward-compatible name for existing canvas-oriented tracking tests. */
  async goto(options: { requireCustomizer?: boolean; consent?: 'accept' | 'decline' | 'none' } = {}): Promise<void> {
    await this.gotoCustomizer(options);
  }

  async click(target: Locator, timeout = Number(process.env.TRACKING_CONTROL_TIMEOUT_MS ?? 10_000)): Promise<void> {
    await target.click({ timeout });
    // Allow SDKs that enqueue a microtask or short batch to submit its request.
    await this.page.waitForTimeout(300);
  }

  async uploadFixture(): Promise<void> {
    await expect(this.fileInput).toHaveCount(1, {
      timeout: Number(process.env.TRACKING_CONTROL_TIMEOUT_MS ?? 10_000)
    });
    await this.fileInput.setInputFiles(assetPath(testData.soloImage));
  }

  async startGeneration(): Promise<void> {
    await this.click(this.generateButton);
  }

  async waitForTwoDResult(): Promise<void> {
    await this.twoDResultImage.waitFor({ state: 'attached', timeout: 300_000 });
    await expect.poll(
      () => this.twoDResultImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      { timeout: 300_000, message: '2D 生成图片未完成加载' }
    ).toBe(true);
    await this.click(this.twoDButton);
    await expect(this.twoDResultImage).toBeVisible({ timeout: 300_000 });
  }

  async waitForThreeDResult(): Promise<void> {
    await this.threeDButton.waitFor({ state: 'visible', timeout: 300_000 });
    await this.click(this.threeDButton);
    await expect(this.threeDView).toBeVisible({ timeout: 300_000 });
  }

  async handleCookieConsent(mode: 'accept' | 'decline' | 'none'): Promise<void> {
    if (mode === 'none') return;
    const appeared = await this.cookieAcceptButton
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (!appeared) {
      return;
    }

    // Shopify Preview's toolbar can cover the storefront consent controls.
    await this.page.locator('#PBarNextFrameWrapper').evaluate((element) => element.remove()).catch(() => undefined);
    const control = mode === 'accept' ? this.cookieAcceptButton : this.cookieDeclineButton;
    if (!(await control.count())) return;
    await control.click({ force: true });
    await this.page.waitForTimeout(250);
    // Some Preview sessions persist consent but leave the injected dialog mounted.
    await this.cookieBanner.evaluate((element) => element.remove()).catch(() => undefined);
  }

  async dismissMarketingPopup(): Promise<void> {
    // The homepage currently serves either a newsletter popup or a membership
    // dialog from the same popup section. Both block the Create navigation.
    const appeared = await this.marketingPopupCloseButton
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    const closed = appeared && await this.marketingPopupCloseButton
      .click({ force: true, timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (!closed) {
      // A/B variants occasionally omit a labelled close button. Removing only
      // this non-product marketing layer keeps the user journey intact and
      // prevents it from masking the real Create control.
      await this.marketingPopup.evaluate((element) => element.remove()).catch(() => undefined);
    }
    await this.marketingPopup.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => undefined);
  }

  private async waitForCustomizer(builderResponse: Promise<import('@playwright/test').Response | null>): Promise<void> {
    await Promise.race([
      Promise.all([
        expect(this.customizerLoading).toBeHidden({ timeout: 300_000 }),
        expect(this.generateButton).toBeVisible({ timeout: 300_000 })
      ]),
      builderResponse.then(() => new Promise<never>(() => undefined))
    ]);
  }
}
