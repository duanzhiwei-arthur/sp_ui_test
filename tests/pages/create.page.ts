import { expect, Locator, Page } from '@playwright/test';

const customizerTimeout = 120_000;
const generationTimeout = 300_000;
const actionPause = 2_000;
const postThreeDRotationPause = 5_000;

export class CreatePage {
  readonly createTab: Locator;
  readonly galleryTab: Locator;
  readonly styleButton: Locator;
  readonly trpgStyleButton: Locator;
  readonly soloMode: Locator;
  readonly duoMode: Locator;
  readonly modeToggleButton: Locator;
  readonly proToolButtons: Locator;
  readonly upload: Locator;
  readonly promptButton: Locator;
  readonly promptInput: Locator;
  readonly uploadButton: Locator;
  readonly generateButton: Locator;
  readonly twoDButton: Locator;
  readonly threeDButton: Locator;
  readonly twoDResultImage: Locator;
  readonly threeDView: Locator;
  readonly threeDProcessingOverlay: Locator;
  readonly addToCartButton: Locator;
  readonly buyNowButton: Locator;
  readonly historyRecordDeleteButtons: Locator;
  readonly deleteImageButton: Locator;
  readonly cancelPromptEditingButton: Locator;
  readonly confirmPromptEditingButton: Locator;
  readonly customizerLoading: Locator;
  readonly marketingPopup: Locator;
  readonly marketingPopupCloseButton: Locator;
  readonly cookieBanner: Locator;
  readonly cookieAcceptButton: Locator;

  constructor(readonly page: Page) {
    this.createTab = page.getByRole('link', { name: 'Create', exact: true });
    this.galleryTab = page.getByRole('button', { name: 'Gallery', exact: true });
    this.styleButton = page.getByRole('button', { name: 'Free Style', exact: true }).first();
    this.trpgStyleButton = page.getByRole('button', { name: 'TRPG', exact: true });
    this.soloMode = page.getByRole('button', { name: 'Solo', exact: true });
    this.duoMode = page.getByRole('button', { name: 'Duo', exact: true });
    this.modeToggleButton = page.getByRole('button', { name: 'Upgrade', exact: true });
    this.upload = page.locator('main input[type="file"]');
    this.promptButton = page.getByRole('button', { name: 'Add Your Prompt', exact: true });
    this.promptInput = page.getByPlaceholder('Add Your Prompt', { exact: true });
    this.uploadButton = page.getByRole('button', { name: 'Upload your picture', exact: true });
    this.generateButton = page.getByRole('button', { name: 'Generate' });
    this.proToolButtons = this.generateButton.locator('xpath=preceding-sibling::button');
    this.twoDButton = page.getByRole('button', { name: '2D', exact: true });
    this.threeDButton = page.getByRole('button', { name: '3D', exact: true });
    const productPreview = page.locator('.product-image-container .jjb-app').first();
    this.twoDResultImage = productPreview.locator('[data-view-name="2d"] img[alt="Generated Toy Result"]');
    this.threeDView = productPreview.locator('[data-view-name="3d"]');
    this.threeDProcessingOverlay = this.threeDView.locator('[class*="bg-white/95"]').filter({
      has: page.locator('[class*="bg-linear-to-r"]')
    });
    this.addToCartButton = page.getByRole('button', { name: 'Add to Cart', exact: true });
    this.buyNowButton = page.getByRole('button', { name: /Buy Now/ });
    this.historyRecordDeleteButtons = page.getByRole('button', { name: 'delete record', exact: true });
    this.deleteImageButton = page.getByRole('button', { name: 'Delete image', exact: true });
    this.cancelPromptEditingButton = page.getByRole('button', { name: 'Cancel prompt editing', exact: true });
    this.confirmPromptEditingButton = page.getByRole('button', { name: 'Confirm prompt editing', exact: true });
    this.customizerLoading = page.getByText('Loading customizer...', { exact: true });
    this.marketingPopup = page.locator('div[id$="__newsletter-popup"]').first();
    this.marketingPopupCloseButton = this.marketingPopup.getByRole('button', { name: 'Close', exact: true });
    this.cookieBanner = page.locator('#shopify-pc__banner');
    this.cookieAcceptButton = this.cookieBanner.getByRole('button', { name: 'Accept', exact: true });
  }

  async goto(): Promise<void> {
    await this.gotoProductPage();
    await this.waitForCustomizer();
  }

  async gotoProductPage(): Promise<void> {
    // Keep an explicitly configured variant when a test environment needs one.
    await this.navigate(process.env.PRODUCT_URL ?? '/products/customize-your-own');
    await expect(this.createTab).toBeVisible();
  }

  async gotoHomePage(): Promise<void> {
    await this.navigate('/');
  }

  async navigate(path: string): Promise<void> {
    const response = await this.page.goto(path, { waitUntil: 'domcontentloaded' });
    await this.assertSiteAvailable(response?.status());
    await this.acceptCookieConsent();
  }

  async assertSiteAvailable(status?: number): Promise<void> {
    const bodyText = await this.page.locator('body').textContent({ timeout: 10_000 }).catch(() => '');
    const rateLimited = status === 429 || /legal-rate-limited/i.test(bodyText ?? '');

    if (rateLimited) {
      throw new Error(
        `站点拒绝当前运行环境（HTTP ${status ?? 'unknown'}，legal-rate-limited）：${this.page.url()}。` +
          'GitHub 托管 Runner 的共享出口可能被限流，请使用 self-hosted runner。'
      );
    }
    if (status !== undefined && (status < 200 || status >= 400)) {
      throw new Error(`页面加载失败（HTTP ${status}）：${this.page.url()}`);
    }
  }

  async waitForCustomizer(timeout = customizerTimeout): Promise<void> {
    await this.assertSiteAvailable();
    await expect(this.customizerLoading).toBeHidden({ timeout });
    await expect(this.generateButton).toBeVisible({ timeout });
    await this.dismissMarketingPopup();
  }

  async dismissMarketingPopup(timeout = 8_000): Promise<void> {
    const appeared = await this.marketingPopupCloseButton
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
    if (!appeared) {
      return;
    }

    await this.click(this.marketingPopupCloseButton);
    await expect(this.marketingPopup).toBeHidden({ timeout: 10_000 });
  }

  async acceptCookieConsent(timeout = 8_000): Promise<void> {
    const appeared = await this.cookieAcceptButton
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
    if (!appeared) {
      return;
    }

    // Shopify Preview's toolbar can overlap the storefront consent controls.
    await this.page.locator('#PBarNextFrameWrapper').evaluate((element) => element.remove()).catch(() => undefined);
    await this.cookieAcceptButton.click({ force: true });
    await this.page.waitForTimeout(250);
    await this.cookieBanner.evaluate((element) => element.remove()).catch(() => undefined);
  }

  async click(target: Locator): Promise<void> {
    // Keep interactions observable and let late UI transitions settle.
    await this.page.waitForTimeout(actionPause);
    await target.click();
    await this.page.waitForTimeout(actionPause);
  }

  async check(target: Locator): Promise<void> {
    await this.page.waitForTimeout(actionPause);
    await target.check();
    await this.page.waitForTimeout(actionPause);
  }

  async uploadImage(file: string): Promise<void> {
    await expect(this.upload).toHaveCount(1);
    await this.upload.setInputFiles(file);
    await expect(this.generateButton).toBeEnabled();
  }

  async enterPrompt(text: string): Promise<void> {
    await this.click(this.promptButton);
    await expect(this.promptInput).toBeVisible();
    await expect(this.promptInput).toBeEditable();
    await this.promptInput.fill(text);
  }

  async startGeneration(): Promise<void> {
    await expect(this.generateButton).toBeEnabled();
    await this.click(this.generateButton);
  }

  async expectImageResourceLoaded(image: Locator, timeout = customizerTimeout): Promise<void> {
    await image.waitFor({ state: 'attached', timeout });
    try {
      await expect.poll(
        () => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0),
        { message: '生成图片未完成加载', timeout }
      ).toBe(true);
    } catch (error) {
      const imageState = await image.evaluateAll((elements: HTMLImageElement[]) => elements.map((element) => ({
        complete: element.complete,
        naturalWidth: element.naturalWidth,
        srcPath: element.currentSrc ? new URL(element.currentSrc).pathname : ''
      }))).catch(() => []);
      const visibleErrors = await this.page.locator('[role="alert"], [class*="error" i]')
        .evaluateAll((elements) => elements
          .filter((element) => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
          })
          .map((element) => element.textContent?.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 5))
        .catch(() => []);
      throw new Error(
        `生成图片未完成加载；图片状态=${JSON.stringify(imageState)}；页面错误=${JSON.stringify(visibleErrors)}`,
        { cause: error }
      );
    }
  }

  async expectImageLoaded(image: Locator, timeout = customizerTimeout): Promise<void> {
    await expect(image).toBeVisible({ timeout });
    await this.expectImageResourceLoaded(image, timeout);
  }

  async waitForTwoDGeneration(): Promise<void> {
    // The app may hide the completed 2D result after automatically opening the 3D view.
    await this.expectImageResourceLoaded(this.twoDResultImage, generationTimeout);
    await this.click(this.twoDButton);
    await this.expectImageLoaded(this.twoDResultImage, generationTimeout);
  }

  async waitForThreeDGeneration(): Promise<void> {
    await this.threeDButton.waitFor({ state: 'visible', timeout: generationTimeout });
    await this.click(this.threeDButton);
    await expect(this.threeDView).toBeVisible();
    // A visible progress overlay means the 3D task is still rendering.
    await expect(this.threeDProcessingOverlay).toBeHidden({ timeout: generationTimeout });
    await expect(this.addToCartButton).toBeEnabled({ timeout: 120_000 });
  }

  async rotateThreeDPreview(): Promise<void> {
    await expect(this.threeDView).toBeVisible();
    const box = await this.threeDView.boundingBox();
    if (!box) {
      throw new Error('3D 预览画布未获取到可拖拽区域');
    }

    const startX = box.x + box.width * 0.3;
    const endX = box.x + box.width * 0.7;
    const y = box.y + box.height / 2;
    const beforeRotation = await this.threeDView.screenshot();
    await this.page.mouse.move(startX, y);
    await this.page.mouse.down();
    try {
      // Use many small moves so the viewer receives a real two-second horizontal rotation.
      const steps = 20;
      for (let step = 1; step <= steps; step += 1) {
        await this.page.mouse.move(startX + ((endX - startX) * step) / steps, y);
        await this.page.waitForTimeout(100);
      }
    } finally {
      await this.page.mouse.up();
    }
    await this.page.waitForTimeout(500);
    const afterRotation = await this.threeDView.screenshot();
    expect(afterRotation.equals(beforeRotation), '横向拖动后 3D 视图应发生视觉变化').toBe(false);
    // Keep the completed model visible before the following Add to Cart action.
    await this.page.waitForTimeout(postThreeDRotationPause);
  }

  async openGallery(): Promise<void> {
    await this.click(this.galleryTab);
    await expect(this.galleryTab).toBeVisible();
  }

  async expectHistoryRecordAdded(previousCount: number): Promise<void> {
    await expect.poll(
      () => this.historyRecordDeleteButtons.count(),
      { message: 'History 应新增本次生成记录', timeout: generationTimeout }
    ).toBe(previousCount + 1);
  }

  async deleteLatestHistoryRecord(previousCount: number): Promise<void> {
    // Gallery displays the newest generated record first.
    const latestDeleteButton = this.historyRecordDeleteButtons.first();
    await expect(latestDeleteButton).toBeVisible();
    const confirmDeletion = this.page.waitForEvent('dialog').then(async (dialog) => {
      try {
        expect(dialog.type()).toBe('confirm');
        expect(dialog.message()).toContain('Delete this history record?');
        await dialog.accept();
      } catch (error) {
        await dialog.dismiss().catch(() => undefined);
        throw error;
      }
    });
    await Promise.all([confirmDeletion, this.click(latestDeleteButton)]);
    await expect.poll(
      () => this.historyRecordDeleteButtons.count(),
      { message: '删除后本次生成记录应从 History 消失', timeout: customizerTimeout }
    ).toBe(previousCount);
  }
}
