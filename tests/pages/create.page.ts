import { expect, Locator, Page } from '@playwright/test';

const customizerTimeout = 120_000;
const generationTimeout = 300_000;
const actionPause = 2_000;

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
  readonly threeDPreviewImage: Locator;
  readonly threeDProcessingOverlay: Locator;
  readonly addToCartButton: Locator;
  readonly buyNowButton: Locator;
  readonly deleteRecordButton: Locator;
  readonly deleteImageButton: Locator;
  readonly cancelPromptEditingButton: Locator;
  readonly confirmPromptEditingButton: Locator;
  readonly customizerLoading: Locator;
  readonly marketingPopupCloseButton: Locator;

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
    this.twoDResultImage = page.locator('#jjb-create-canvas [data-view-name="2d"] img[alt="Generated Toy Result"]');
    this.threeDView = page.locator('#jjb-create-canvas [data-view-name="3d"]');
    this.threeDPreviewImage = this.threeDView.locator('img[alt="3d preview"]');
    this.threeDProcessingOverlay = this.threeDView.locator('[class*="bg-white/95"]').filter({
      has: page.locator('[class*="bg-linear-to-r"]')
    });
    this.addToCartButton = page.getByRole('button', { name: 'Add to Cart', exact: true });
    this.buyNowButton = page.getByRole('button', { name: /Buy Now/ });
    this.deleteRecordButton = page.getByRole('button', { name: 'delete record', exact: true });
    this.deleteImageButton = page.getByRole('button', { name: 'Delete image', exact: true });
    this.cancelPromptEditingButton = page.getByRole('button', { name: 'Cancel prompt editing', exact: true });
    this.confirmPromptEditingButton = page.getByRole('button', { name: 'Confirm prompt editing', exact: true });
    this.customizerLoading = page.getByText('Loading customizer...', { exact: true });
    this.marketingPopupCloseButton = page.getByRole('button', { name: 'Close', exact: true });
  }

  async goto(): Promise<void> {
    await this.gotoProductPage();
    await this.waitForCustomizer();
  }

  async gotoProductPage(): Promise<void> {
    await this.page.goto('/products/customize-your-own', { waitUntil: 'domcontentloaded' });
    await expect(this.createTab).toBeVisible();
  }

  async waitForCustomizer(timeout = customizerTimeout): Promise<void> {
    await expect(this.customizerLoading).toBeHidden({ timeout });
    await expect(this.generateButton).toBeVisible({ timeout });
    await this.dismissMarketingPopup();
  }

  async dismissMarketingPopup(): Promise<void> {
    if (await this.marketingPopupCloseButton.isVisible().catch(() => false)) {
      await this.click(this.marketingPopupCloseButton);
    }
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
    const promptInput = this.page.locator('main textarea').filter({ hasNotText: '[{' });
    await expect(promptInput).toHaveCount(1);
    await promptInput.fill(text);
  }

  async startGeneration(): Promise<void> {
    await expect(this.generateButton).toBeEnabled();
    await this.click(this.generateButton);
  }

  async expectImageResourceLoaded(image: Locator, timeout = customizerTimeout): Promise<void> {
    await image.waitFor({ state: 'attached', timeout });
    await expect.poll(
      () => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0),
      { message: '生成图片未完成加载', timeout }
    ).toBe(true);
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
    await this.expectImageLoaded(this.threeDPreviewImage, generationTimeout);
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
  }

  async openGallery(): Promise<void> {
    await this.click(this.galleryTab);
    await expect(this.galleryTab).toBeVisible();
  }
}
