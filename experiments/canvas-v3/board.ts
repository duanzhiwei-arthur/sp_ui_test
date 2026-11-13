import { type Page, type TestInfo } from '@playwright/test';
import { test as base, expect } from '../../tests/fixtures/runtime-diagnostics.js';
import fs from 'node:fs';
import path from 'node:path';
import { assertCanvasAssignment, type CanvasAssignment } from '../../tests/fixtures/canvas-assignment.js';
import { runAssets } from '../../tests/fixtures/run-assets.js';
import { CartDrawer } from '../../tests/pages/cart-drawer.page.js';
import { CheckoutPage } from '../../tests/pages/checkout.page.js';
import { reserveCanvasGeneration } from '../../tests/fixtures/generation-budget.js';

type RecordRow = { at: string; method: string; path: string; status?: number; trace?: string; taskId?: string };
export class ExperimentBoard {
  readonly root;
  readonly records;
  readonly log: RecordRow[] = [];
  readonly createdRecords = new Set<string>();
  readonly allowedDeletes = new Set<string>();
  readonly checkpoints: { name: string; actual: unknown }[] = [];
  readonly deniedDeletes: string[] = [];
  private initialIds = new Set<string>();
  private generated = false;
  constructor(readonly page: Page, readonly info: TestInfo) {
    this.root = page.locator('#jjb-create-canvas');
    this.records = this.root.locator('article[data-history-record-id]');
  }
  note(name: string, actual: unknown) { this.checkpoints.push({ name, actual }); }
  async install() {
    if (!this.info.project.metadata.canvasAssignment) {
      const origin = new URL(this.info.project.use.baseURL!).origin;
      await this.page.addInitScript(origin => {
        if (location.origin === origin) localStorage.setItem('_statsig_override', JSON.stringify({ canvas_v3_109: { enable: true }, canvas_trust_info: { enable: true } }));
      }, origin);
    }
    await this.page.route('**/activity/assets/*', async route => {
      const req = route.request(), id = new URL(req.url()).pathname.split('/').pop()!;
      if (req.method() === 'DELETE' && !this.allowedDeletes.has(id)) {
        this.deniedDeletes.push(id); await route.abort('blockedbyclient'); return;
      }
      await route.continue();
    });
    this.page.on('response', async response => {
      try {
        const req = response.request(), pathname = new URL(response.url()).pathname;
        if (!/\/activity\/(tasks|assets)|\/cart\/add/.test(pathname)) return;
        const row: RecordRow = { at: new Date().toISOString(), method: req.method(), path: pathname, status: response.status(), trace: response.headers()['x-trace-id'] };
        const task = pathname.match(/\/activity\/tasks\/(\d+)$/); if (task) row.taskId = task[1];
        this.log.push(row);
      } catch { /* 不阻断业务；缺证据不伪造 */ }
    });
    await this.page.addLocatorHandler(this.page.locator('.newsletter-popup-v2__close:visible'), async close => {
      await close.focus(); await this.page.keyboard.press('Enter');
    });
  }
  async dismiss() {
    const hide = this.page.frameLocator('#PBarNextFrame').getByRole('button', { name: 'Hide bar', exact: true });
    if (await hide.isVisible().catch(() => false)) { await hide.focus(); await this.page.keyboard.press('Enter'); }
    const accept = this.page.getByRole('button', { name: 'Accept', exact: true });
    if (await accept.isVisible()) { await accept.focus(); await this.page.keyboard.press('Enter'); }
  }
  async open() {
    const response = await this.page.goto('/products/customize-your-own', { waitUntil: 'commit' });
    expect(response?.ok()).toBe(true); await this.ready();
  }
  async ready() {
    const assignment = this.info.project.metadata.canvasAssignment as CanvasAssignment | undefined;
    if (assignment) await assertCanvasAssignment(this.page, this.info, assignment);
    await expect(this.root).toHaveAttribute('data-jjb-create-mount-status', 'mounted', { timeout: 120_000 });
    await this.dismiss();
    const version = await this.page.evaluate(() => {
      const w = window as unknown as { __jjbCanvasV3Enabled?: boolean; Shopify?: { theme?: { id: number; name: string } } };
      return { actualV3: w.__jjbCanvasV3Enabled, theme: w.Shopify?.theme, scripts: [...document.scripts].map(s => s.src).filter(s => /jjb-create.*canvas/.test(s)) };
    });
    this.note('实际实验与部署版本', version);
    expect(version.actualV3, '必须命中canvas_v3_109实验组').toBe(true);
    await expect(this.root.locator('.jjb-v3-upload-card')).toBeVisible();
    for (const name of ['Digital Crafting', 'Ship Policy', 'Quality & Guarantee']) await expect(this.page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  async upload() {
    const file = path.resolve(__dirname, '../../assets/two-dogs.jpeg');
    if (!fs.existsSync(file)) throw new Error('缺少与定时基线同源的two-dogs.jpeg测试素材');
    const [chooser] = await Promise.all([this.page.waitForEvent('filechooser'), this.root.getByRole('button', { name: /^(Upload your photo|Replace photo)$/ }).click()]);
    await chooser.setFiles(file);
    await expect(this.root.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
    this.note('正常图片上传', '与定时基线同源two-dogs.jpeg；Generate已可用');
  }
  async preview() {
    await this.root.locator('.jjb-v3-steps button').filter({ hasText: '3D Preview' }).click();
    await expect(this.root.locator('.jjb-v3-steps [aria-current="step"]')).toContainText('3D Preview');
  }
  async create() {
    await this.root.locator('.jjb-v3-steps button').filter({ hasText: 'Create' }).click();
    await expect(this.root.locator('.jjb-v3-upload-card')).toBeVisible();
  }
  async snapshotHistory() {
    this.initialIds = new Set(await this.records.evaluateAll(es => es.map(e => e.getAttribute('data-history-record-id')!)));
    this.note('原有History记录', [...this.initialIds]);
    // 独立游客不应有既存作品；有则停止，绝不借用或删除。
    expect(this.initialIds.size, '隔离游客应无既存History；不触碰历史资产').toBe(0);
  }
  reserve() {
    if (process.env.CANVAS_PARITY_ALLOW_GENERATION !== 'true') throw new Error('真实生成需CANVAS_PARITY_ALLOW_GENERATION=true');
    const file = process.env.CANVAS_PARITY_LEDGER;
    if (!file || !path.isAbsolute(file)) throw new Error('必须指定绝对路径CANVAS_PARITY_LEDGER');
    reserveCanvasGeneration(this.info.title);
  }
  async generate() {
    await this.snapshotHistory(); this.reserve();
    runAssets(this.page).beginGeneration();
    const pending = this.page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/activity/tasks'), { timeout: 60_000 });
    await this.root.getByRole('button', { name: 'Generate', exact: true }).click();
    const response = await pending; expect(response.ok(), '真实任务创建成功').toBe(true);
    this.generated = true;
    this.note('真实生成请求', { status: response.status(), trace: response.headers()['x-trace-id'] });
    await expect(this.root.locator('.jjb-v3-steps [aria-current="step"]')).toContainText('3D Preview');
  }
  async wait2D() {
    const image = this.root.locator('.jjb-v3-viewer img[alt="Generated Toy Result"]');
    // 新版隐藏的2D图使用lazy loading：先切到2D并滚入视口，不能对隐藏图先等naturalWidth。
    await expect(image).toHaveCount(1, { timeout: 300_000 });
    const switch2d = this.root.getByRole('button', { name: /^(Switch to )?2D$/ }).filter({ visible: true });
    await expect.poll(async () => {
      if (await image.isVisible()) return true;
      if (await switch2d.count() && await switch2d.isEnabled()) await switch2d.click({ timeout: 3_000 });
      return image.isVisible();
    }, { timeout: 300_000, message: '生成事件可能自动切3D，等待真实2D切换完成后再校验资源' }).toBe(true);
    await expect(image).toBeVisible(); await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluateAll(es => es.some(e => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0)), { timeout: 300_000, message: '真实2D图片加载成功，不以请求200代替' }).toBe(true);
    this.note('真实2D', '生成图片实际加载并可见');
    await this.captureNewRecords();
  }
  async wait3DAndRotate() {
    const switch3d = this.root.getByRole('button', { name: /^(Switch to )?3D$/ }).filter({ visible: true });
    if (await switch3d.count()) { await expect(switch3d).toBeEnabled({ timeout: 300_000 }); await switch3d.click(); }
    const model = this.root.locator('model-viewer').filter({ visible: true }).first();
    await expect(model).toBeVisible({ timeout: 300_000 });
    await model.scrollIntoViewIfNeeded();
    await expect.poll(() => model.evaluate(e => Boolean((e as unknown as { loaded: boolean }).loaded)), { timeout: 300_000, message: '真实3D模型必须loaded=true' }).toBe(true);
    await model.scrollIntoViewIfNeeded();
    const orbit = () => model.evaluate(e => (e as unknown as { getCameraOrbit(): { theta: number; phi: number; radius: number } }).getCameraOrbit());
    const before = await orbit(), box = await model.boundingBox(); if (!box) throw new Error('3D模型无交互区域');
    await this.page.mouse.move(box.x + box.width * .3, box.y + box.height * .5); await this.page.mouse.down();
    try { for (let i = 1; i <= 20; i++) { await this.page.mouse.move(box.x + box.width * (.3 + .4 * i / 20), box.y + box.height * .5); await this.page.waitForTimeout(100); } }
    finally { await this.page.mouse.up(); }
    await expect.poll(async () => Math.abs((await orbit()).theta - before.theta), { message: '两秒横向拖动必须改变3D相机角度' }).toBeGreaterThan(.01);
    this.note('真实3D及拖动', { loaded: true, before, after: await orbit() });
    await this.captureNewRecords();
    await this.page.screenshot({ path: this.info.outputPath('generated-model.png') });
  }
  async captureNewRecords() {
    expect(this.generated).toBe(true);
    const ids = await this.records.evaluateAll(es => es.map(e => e.getAttribute('data-history-record-id')!));
    for (const id of ids) if (!this.initialIds.has(id)) this.createdRecords.add(id);
    this.note('本次新增History', [...this.createdRecords]);
  }
  async addAndCheckout() {
    const initial = await this.page.request.get('/cart.js'); expect(initial.ok()).toBe(true);
    const before = await initial.json(); expect(before.item_count, '隔离上下文购物车应为空').toBe(0);
    const add = this.root.getByRole('button', { name: /^Add to Cart$/i }).filter({ visible: true });
    await expect(add).toBeEnabled();
    await new CartDrawer(this.page).addCurrentAsset(() => add.click(), runAssets(this.page));
    const cartResponse = await this.page.request.get('/cart.js'); expect(cartResponse.ok()).toBe(true);
    const cart = await cartResponse.json(); expect(cart.item_count).toBe(1); expect(cart.total_price).toBeGreaterThan(0);
    this.note('真实加购', { item_count: cart.item_count, total_price: cart.total_price, currency: cart.currency,
      items: cart.items.map((i: { variant_id: number; quantity: number; product_title: string; final_line_price: number }) => ({ variant_id: i.variant_id, quantity: i.quantity, title: i.product_title, final_line_price: i.final_line_price })) });
    await this.page.goto('/cart', { waitUntil: 'commit' }); await this.dismiss();
    const cartRoot = this.page.locator('#custom-cart-page-root'); await expect(cartRoot).toBeVisible({ timeout: 60_000 });
    await expect(cartRoot.getByRole('spinbutton').first()).toHaveValue('1');
    const checkout = cartRoot.getByRole('button', { name: /^Check\s*out$/i }); await expect(checkout).toBeEnabled();
    await checkout.click({ noWaitAfter: true });
    await expect.poll(() => new URL(this.page.url()).pathname.includes('/checkouts/'), { timeout: 120_000 }).toBe(true);
    await new CheckoutPage(this.page).expectVisible();
    this.note('Checkout', '订单商品行及支付入口可见；未点击支付、未提交订单');
  }
  async deleteOwnRecord() {
    await this.captureNewRecords(); expect(this.createdRecords.size).toBe(1);
    const id = [...this.createdRecords][0]; expect(this.initialIds.has(id)).toBe(false);
    const owned = await runAssets(this.page).requireSingleAsset();
    expect(id, 'History记录必须对应本次生成响应的Asset ID').toBe(owned.assetId);
    // 定位确切record，不假定“最新第一条”永远属于本case。
    const target = this.root.locator(`article[data-history-record-id="${id}"]`);
    this.allowedDeletes.add(id);
    const confirm = this.page.waitForEvent('dialog').then(async d => {
      if (d.type() !== 'confirm' || !d.message().includes('Delete this history record?')) { await d.dismiss(); throw new Error('非预期删除确认，已取消'); }
      await d.accept();
    });
    const [response] = await Promise.all([
      this.page.waitForResponse(r => r.request().method() === 'DELETE' && new URL(r.url()).origin === new URL(this.info.project.use.baseURL!).origin
        && new URL(r.url()).pathname.endsWith(`/activity/assets/${id}`), { timeout: 120_000 }),
      target.getByRole('button', { name: 'delete record', exact: true }).click(), confirm,
    ]);
    expect(response.ok()).toBe(true); await expect(target).toHaveCount(0); await expect(this.records).toHaveCount(0);
    runAssets(this.page).markDeleted(id);
    this.note('删除本次记录', { id, status: '已确认DELETE成功且History为空' });
  }
  async evidence() {
    const viewer = await this.root.locator('model-viewer').evaluateAll(es => es.map(e => ({
      registered: Boolean(customElements.get('model-viewer')),
      loaded: (e as unknown as { loaded?: boolean }).loaded ?? null,
      loading: e.getAttribute('loading'), visible: e.getBoundingClientRect().height > 0,
    }))).catch(() => []);
    this.note('结束时模型诊断', viewer);
    await this.info.attach('parity-checkpoints', { body: JSON.stringify({ experiment: { mode: this.info.project.metadata.canvasAssignment ? 'stable-id' : 'preview-override', expected: this.info.project.metadata.canvasAssignment ?? { canvas_v3_109: true, canvas_trust_info: true } }, checkpoints: this.checkpoints, network: this.log, createdRecords: [...this.createdRecords], deniedDeletes: this.deniedDeletes }, null, 2), contentType: 'application/json' });
    expect(this.deniedDeletes, '不得删除非本case资产').toEqual([]);
  }
}
export const test = base.extend<{ board: ExperimentBoard }>({
  board: async ({ page }, use, info) => { const board = new ExperimentBoard(page, info); await board.install(); try { await use(board); } finally { await board.evidence(); } },
});
export { expect };
