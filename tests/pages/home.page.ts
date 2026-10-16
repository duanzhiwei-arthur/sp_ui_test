import { expect, Locator, Page } from '@playwright/test';

export class HomePage {
  readonly announcementBar: Locator;
  readonly header: Locator;
  readonly logo: Locator;
  readonly desktopNavigation: Locator;
  readonly createEntry: Locator;
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
    this.createEntry = this.header.locator('a[href*="/products/customize-your-own"]:visible').first();
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

  async expectProductionStoreIdentity(): Promise<void> {
    const expectedShop = process.env.EXPECTED_SHOPIFY_SHOP?.trim() || 'exn11x-id.myshopify.com';
    const expectedShopId = process.env.EXPECTED_SHOPIFY_SHOP_ID?.trim() || '95408849267';
    const actual = await this.page.evaluate(() => ({
      shop: String((window as unknown as { Shopify?: { shop?: string } }).Shopify?.shop ?? ''),
      shopId: (() => {
        try {
          return String(JSON.parse(document.querySelector('#shopify-features')?.textContent ?? '{}').shopId ?? '');
        } catch {
          return '';
        }
      })()
    }));
    expect(actual.shop, '线上页面 Shopify 店铺域名必须匹配生产店铺').toBe(expectedShop);
    expect(String(actual.shopId), '线上页面 Shopify Shop ID 必须匹配生产店铺').toBe(expectedShopId);
  }

  async dismissBlockingPopup(): Promise<void> {
    const popup = this.page.locator('div[id$="__newsletter-popup"]').first();
    const closeButton = popup.getByRole('button', { name: 'Close', exact: true });
    if (await closeButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await closeButton.click();
      await expect(popup).toBeHidden();
    }
    const overlay = this.page.locator('.newsletter-popup-v2__overlay').first();
    if (await overlay.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await expect(closeButton, '营销弹窗遮罩出现时应存在可用关闭按钮').toBeVisible();
      await closeButton.click();
    }
    await expect(overlay, '首页营销弹窗遮罩不应拦截页面操作').toBeHidden({ timeout: 10_000 });
  }

  async expectHeaderHealthy(): Promise<void> {
    await expect(this.announcementBar).toBeVisible();
    await expect(this.header).toBeVisible();
    await expect(this.logo).toBeVisible();
    await expect(this.desktopNavigation).toBeVisible();
    await expect(this.createEntry, '首页应展示可用的 Create 入口').toBeVisible();
    await expect(this.createEntry).toHaveAttribute('href', /\/products\/customize-your-own/u);
    const visibleLinks = this.desktopNavigation.locator('a:visible');
    expect(await visibleLinks.count(), '顶部导航应至少展示 5 个可用链接').toBeGreaterThanOrEqual(5);
    for (let index = 0; index < Math.min(await visibleLinks.count(), 8); index += 1) {
      await expect(visibleLinks.nth(index)).toHaveAttribute('href', /\S+/u);
    }
  }

  async openCreate(): Promise<void> {
    await this.dismissBlockingPopup();
    await this.createEntry.scrollIntoViewIfNeeded();
    await expect(this.createEntry).toBeVisible();
    await this.createEntry.click();
  }

  async expectModuleHealthy(section: Locator, label: string): Promise<void> {
    await section.scrollIntoViewIfNeeded();
    await expect(section, `${label} 模块应展示`).toBeVisible();
    const visibleContent = section.locator('h1:visible, h2:visible, h3:visible, p:visible, a:visible, img:visible').first();
    await expect(visibleContent, `${label} 模块应有可见内容`).toBeVisible();
    const size = await section.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height
    }));
    expect(size.width, `${label} 模块宽度应大于 0`).toBeGreaterThan(0);
    expect(size.height, `${label} 模块高度应大于 0`).toBeGreaterThan(0);
    await this.expectVisualContentHealthy(section, label);
  }

  /**
   * A visible shell can still be a black/blank screen when a configured
   * image, video, canvas, or CSS background failed to load. Check the actual
   * rendered media in addition to the section's dimensions and heading.
   */
  async expectVisualContentHealthy(section: Locator, label: string): Promise<void> {
    await expect.poll(async () => section.evaluate((element) => {
      const inViewport = (node: Element): boolean => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 &&
          rect.top < window.innerHeight && rect.left < window.innerWidth &&
          style.display !== 'none' && style.visibility !== 'hidden';
      };
      const images = [...element.querySelectorAll('img')].filter(inViewport) as HTMLImageElement[];
      const videos = [...element.querySelectorAll('video')].filter(inViewport) as HTMLVideoElement[];
      const pendingImages = images.filter((image) => !image.complete).length;
      const pendingVideos = videos.filter((video) => video.readyState === 0).length;
      return { pendingImages, pendingVideos };
    }), `${label} 等待图片/视频资源稳定`).toEqual({ pendingImages: 0, pendingVideos: 0 });
    const result = await section.evaluate((element) => {
      const visible = (node: Element): boolean => {
        const rect = (node as HTMLElement).getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 1 && rect.height > 1 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const mediaErrors: string[] = [];
      const images = [...element.querySelectorAll('img')].filter((node) => visible(node) && (
        node.getBoundingClientRect().bottom > 0 && node.getBoundingClientRect().right > 0 &&
        node.getBoundingClientRect().top < window.innerHeight && node.getBoundingClientRect().left < window.innerWidth
      )) as HTMLImageElement[];
      for (const image of images) {
        if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
          mediaErrors.push(`img:${image.alt || image.currentSrc || image.src || 'unknown'}`);
        }
      }
      const videos = [...element.querySelectorAll('video')].filter((node) => visible(node) && (
        node.getBoundingClientRect().bottom > 0 && node.getBoundingClientRect().right > 0 &&
        node.getBoundingClientRect().top < window.innerHeight && node.getBoundingClientRect().left < window.innerWidth
      )) as HTMLVideoElement[];
      for (const video of videos) {
        const poster = video.poster;
        const posterLoaded = !poster || video.readyState >= 1;
        if (!posterLoaded || (video.readyState >= 2 && (video.videoWidth <= 0 || video.videoHeight <= 0))) {
          mediaErrors.push(`video:${video.currentSrc || video.src || poster || 'unknown'}`);
        }
      }
      const blankCanvases: string[] = [];
      const canvases = [...element.querySelectorAll('canvas')].filter(visible) as HTMLCanvasElement[];
      for (const canvas of canvases) {
        if (canvas.width <= 0 || canvas.height <= 0) {
          blankCanvases.push('canvas:empty-size');
          continue;
        }
        try {
          const sampleWidth = Math.min(canvas.width, 32);
          const sampleHeight = Math.min(canvas.height, 32);
          const pixels = canvas.getContext('2d')?.getImageData(0, 0, sampleWidth, sampleHeight).data;
          if (pixels && pixels.length > 0) {
            let visiblePixel = false;
            let nonBlackPixel = false;
            for (let index = 0; index < pixels.length; index += 4) {
              const alpha = pixels[index + 3];
              if (alpha > 0) visiblePixel = true;
              if (alpha > 0 && (pixels[index] > 8 || pixels[index + 1] > 8 || pixels[index + 2] > 8)) {
                nonBlackPixel = true;
              }
            }
            if (!visiblePixel || !nonBlackPixel) blankCanvases.push('canvas:transparent-or-black');
          }
        } catch {
          // Cross-origin canvases can be tainted; dimensions and media checks
          // still provide useful coverage without creating a false failure.
        }
      }
      const backgroundErrors: string[] = [];
      const backgrounds = [element, ...element.querySelectorAll('*')].filter(visible);
      for (const node of backgrounds) {
        const backgroundImage = getComputedStyle(node).backgroundImage;
        if (backgroundImage !== 'none' && /url\(/iu.test(backgroundImage)) {
          const urls = [...backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/giu)].map((match) => match[1]);
          for (const url of urls) {
            if (!url || url.startsWith('data:')) continue;
            const image = new Image();
            image.src = url;
            if (image.complete && image.naturalWidth <= 0) backgroundErrors.push(`background:${url}`);
          }
        }
      }
      return { images: images.length, videos: videos.length, canvases: canvases.length, mediaErrors, blankCanvases, backgroundErrors };
    });
    expect(result.mediaErrors, `${label} 存在图片/视频资源加载失败`).toEqual([]);
    expect(result.blankCanvases, `${label} 存在透明或纯黑 Canvas，疑似黑屏`).toEqual([]);
    expect(result.backgroundErrors, `${label} 存在背景图加载失败`).toEqual([]);
  }

  async expectFooterHealthy(): Promise<void> {
    await this.footer.scrollIntoViewIfNeeded();
    await expect(this.footer).toBeVisible();
    await expect(this.footer.locator('a:visible').first(), '页脚应展示可用链接').toBeVisible();
    expect(await this.footer.locator('a:visible').count(), '页脚应至少展示 3 个可用链接').toBeGreaterThanOrEqual(3);
  }
}
