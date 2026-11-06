import { randomUUID } from 'node:crypto';
import { expect, type CDPSession, type Page, type Request, type Response, type Route } from '@playwright/test';

export interface OwnedAsset { assetId: string; taskId?: string; traceId?: string; imageUrl?: string; terminal: boolean; deleted?: boolean }
const safeId = (value: unknown): string | undefined => (typeof value === 'string' || Number.isSafeInteger(value))
  && /^[a-zA-Z0-9_-]{1,128}$/.test(String(value)) ? String(value) : undefined;
const endpoint = (raw: string, origin: string, pathname: string) => {
  try { const u = new URL(raw); return u.origin === origin && u.pathname === pathname; } catch { return false; }
};

// 只从本次点击产生的生成POST响应建立归属，不从History列表或固定test标记推断。
export class RunAssets {
  readonly attemptId = randomUUID();
  readonly assets = new Map<string, OwnedAsset>();
  private origin = '';
  private armed = false;
  private armedUntil = 0;
  private requests = new Map<Request, { at: string; status?: number; traceId?: string; requestId?: string; complete: boolean }>();
  private pending = new Set<Promise<void>>();
  private gaps = new Set<string>();
  private armedDelete?: string;
  private deleteBlocked = false;
  private cartLines: Array<{ assetId: string; key: string }> = [];
  private taskIds = new Set<string>();
  private disposed = false;
  private guarding = false;
  private cdp?: CDPSession;
  private streamArmed = false;
  private streams = new Map<string, string>();
  constructor(readonly page: Page) {}

  private onRequest = (request: Request) => {
    if (this.armed && Date.now() <= this.armedUntil && request.method() === 'POST' && endpoint(request.url(), this.origin, '/apps/ai/activity/tasks')) {
      this.armed = false;
      this.requests.set(request, { at: new Date().toISOString(), complete: false });
    }
  };
  private onResponse = (response: Response) => {
    const request = response.request(), meta = this.requests.get(request);
    if (!meta) return;
    meta.status = response.status();
    meta.traceId = safeId(response.headers()['x-trace-id']); meta.requestId = safeId(response.headers()['x-request-id']);
    const job = (async () => {
      await response.finished();
      if (this.disposed) return;
      const size = (await request.sizes()).responseBodySize;
      if (size > 1024 * 1024) { this.gaps.add('生成响应超过1MiB，未用于资产归属'); return; }
      const text = await response.text();
      if (this.disposed) return;
      meta.complete = true;
      if (response.ok()) this.consume(text);
    })().catch(() => { if (!this.disposed) this.gaps.add('生成响应未完整采集，未猜测资产归属'); });
    this.pending.add(job); void job.finally(() => this.pending.delete(job));
  };
  // 仅本case的浏览器上下文；未知DELETE在出站前拦截。普通GET/生成流不经route.fetch缓冲。
  private deleteGuard = async (route: Route) => {
    const request = route.request();
    if (request.method() !== 'DELETE') { await route.fallback(); return; }
    const url = new URL(request.url()), assetId = url.pathname.match(/^\/apps\/ai\/activity\/assets\/([a-zA-Z0-9_-]+)$/)?.[1];
    if (url.origin !== this.origin || !assetId || this.armedDelete !== assetId || !this.assets.has(assetId)) {
      this.deleteBlocked = true; this.gaps.add('已拦截非本次授权资产的删除请求'); await route.abort('blockedbyclient'); return;
    }
    this.armedDelete = undefined; // 一次性授权，禁止应用重放或重复删除。
    try {
      // DELETE不能通过307/308重定向到其他资产；最多发一次，不做网络重试。
      const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 20_000 });
      try {
        if (response.status() >= 300 && response.status() < 400) {
          this.deleteBlocked = true; this.gaps.add('已阻止DELETE重定向，不重放删除'); await route.abort('blockedbyclient');
        } else await route.fulfill({ response });
      } finally { await response.dispose(); }
    } catch { this.gaps.add('DELETE传输未确认；未重试或宣称清理成功'); await route.abort('failed').catch(() => {}); }
  };
  async install() {
    this.page.on('request', this.onRequest); this.page.on('response', this.onResponse);
    // Chromium被动读取已到达的网络数据，不替换fetch、不缓冲页面SSE、不重放请求。
    try {
      this.cdp = await this.page.context().newCDPSession(this.page);
      await this.cdp.send('Network.enable');
      this.cdp.on('Network.requestWillBeSent', event => {
        if (this.streamArmed && Date.now() <= this.armedUntil && event.request.method === 'POST'
          && endpoint(event.request.url, this.origin, '/apps/ai/activity/tasks')) {
          this.streamArmed = false; this.streams.set(event.requestId, '');
        }
      });
      this.cdp.on('Network.responseReceived', event => {
        if (!this.streams.has(event.requestId)) return;
        if (event.response.status < 200 || event.response.status >= 300) { this.streams.delete(event.requestId); return; }
        void this.cdp!.send('Network.streamResourceContent', { requestId: event.requestId }).then(result => {
          if (this.disposed || !this.streams.has(event.requestId)) return;
          // 启用流读取时已有缓冲必须放在后续dataReceived前面。
          const text = Buffer.from(result.bufferedData, 'base64').toString('utf8') + this.streams.get(event.requestId)!;
          this.acceptStream(event.requestId, text);
        }).catch(() => { if(!this.disposed)this.gaps.add('实时SSE采集不可用，保留完成响应采集'); });
      });
      this.cdp.on('Network.dataReceived', event => {
        if (!event.data || !this.streams.has(event.requestId) || this.disposed) return;
        this.acceptStream(event.requestId, this.streams.get(event.requestId)! + Buffer.from(event.data,'base64').toString('utf8'));
      });
    } catch { this.gaps.add('浏览器不支持实时SSE采集，保留完成响应采集'); }
  }
  private acceptStream(requestId: string, text: string) {
    if (Buffer.byteLength(text)>1024*1024) { this.streams.delete(requestId); this.gaps.add('实时SSE超过1MiB');return; }
    this.streams.set(requestId,text);
    const normalized = text.replaceAll('\r\n', '\n');
    const end=normalized.lastIndexOf('\n\n');if(end>=0)this.consume(normalized.slice(0,end+2));
  }
  beginGeneration() {
    this.origin = new URL(this.page.url()).origin;
    this.armed = true; this.streamArmed = true; this.armedUntil = Date.now() + 120_000;
  }
  endGenerationAction() { this.armed = false; this.streamArmed = false; }
  consume(text: string) {
    let taskId: string | undefined;
    for (const block of text.replaceAll('\r\n', '\n').split(/\n\s*\n/).slice(0, 1000)) {
      const event = block.match(/^event:\s*(\w+)/m)?.[1];
      if (!/^(task_start|asset_start|asset_2d_done|asset_3d_start|asset_3d_done|asset_done|task_done|asset_error|task_error)$/.test(event ?? '')) continue;
      try {
        const data = JSON.parse(block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n'));
        taskId = safeId(data.taskId) ?? taskId;
        if (taskId) this.taskIds.add(taskId);
        const assetId = safeId(data.assetId); if (!assetId) continue;
        const asset = this.assets.get(assetId) ?? { assetId, terminal: false };
        asset.taskId = taskId ?? asset.taskId;
        asset.traceId = safeId(data.extra?.traceId) ?? asset.traceId;
        if (typeof data.extra?.imageUrl === 'string') {
          const image = new URL(data.extra.imageUrl);
          if (image.protocol === 'https:' && !image.username && !image.password) asset.imageUrl = image.href;
        }
        if (['asset_done', 'asset_error'].includes(event!)) asset.terminal = true;
        this.assets.set(assetId, asset);
      } catch { this.gaps.add('部分SSE无法解析'); }
    }
  }
  async requireSingleAsset(timeout = 30_000): Promise<OwnedAsset> {
    await expect.poll(() => this.assets.size, { timeout, message: '[ASSET_OWNERSHIP] 等待本次生成响应提供唯一Asset ID，不重复生成' }).toBe(1);
    return [...this.assets.values()][0];
  }
  async authorizeDelete(assetId: string) {
    const asset = this.assets.get(assetId);
    if (!asset || asset.deleted) throw Error('[ASSET_OWNERSHIP] 无法确认本轮资产，拒绝删除');
    if (this.page.context().serviceWorkers().length) throw Error('[ASSET_OWNERSHIP] 存在Service Worker，无法保证删除出站拦截，拒绝删除');
    this.deleteBlocked = false; this.armedDelete = assetId;
    if (!this.guarding) {
      await this.page.route('**/apps/ai/activity/assets/**', this.deleteGuard);
      this.guarding = true;
    }
  }
  cancelDelete() { this.armedDelete = undefined; }
  wasDeleteBlocked() { return this.deleteBlocked; }
  markDeleted(assetId: string) { const asset = this.assets.get(assetId); if (asset) asset.deleted = true; }
  recordCart(assetId: string, key: string) { this.cartLines.push({ assetId, key }); }
  snapshot() {
    return { version: 1, attemptId: this.attemptId, taskIds: [...this.taskIds], generationRequests: [...this.requests.values()],
      assets: [...this.assets.values()].map(({ imageUrl, ...asset }) => ({ ...asset, imageObserved: Boolean(imageUrl) })),
      cartLines: this.cartLines, gaps: [...this.gaps],
      unfinishedRequests: [...this.requests.values()].filter(r => !r.complete).length,
      caveat: '浏览器关闭不等于任务取消；未完整收到响应的任务状态未知，不自动清理或借用上轮ID。' };
  }
  async dispose() {
    this.disposed = true; this.armed = false;
    this.page.off('request', this.onRequest); this.page.off('response', this.onResponse);
    if (this.guarding) await this.page.unroute('**/apps/ai/activity/assets/**', this.deleteGuard);
    await this.cdp?.detach().catch(() => {});
  }
}

const trackers = new WeakMap<Page, RunAssets>();
export function registerRunAssets(page: Page, tracker: RunAssets) { trackers.set(page, tracker); }
// 原实验fixture不依赖资产清理/加购追踪，不因新增观测强制改变实验用例。
export function optionalRunAssets(page: Page) { return trackers.get(page); }
export function runAssets(page: Page): RunAssets {
  const tracker = trackers.get(page);
  if (!tracker) throw Error('[ASSET_OWNERSHIP] 缺少本轮资产追踪fixture，不能猜测归属');
  return tracker;
}
