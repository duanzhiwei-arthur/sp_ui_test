import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildTrackingAuditReport, TrackingStepEvidence } from './tracking-audit.js';
import { trackingCaseCatalog } from './tracking-case-catalog.js';
import { TrackingCollector } from './tracking-collector.js';
import { TrackingFaultInjector, previewOnly } from './tracking-fault-injection.js';
import { TrackingPage } from './tracking-page.js';

const baseUrl = process.env.TRACKING_BASE_URL;
const enabled = process.env.TRACKING_FAULT_INJECTION_ENABLED === 'true' && previewOnly(baseUrl);
const output = process.env.TRACKING_EXCEPTION_OUTPUT ?? 'test-results/tracking-exception-audit.json';
const cases = new Map(trackingCaseCatalog.map((item) => [item.id, item]));

test.describe('异常埋点：接口 Mock 与浏览器故障注入', () => {
  test.skip(!enabled, '异常埋点只允许在 shopifypreview.com 或本地测试环境执行。');

  test('执行可稳定注入的异常场景并输出完整目录结果', async ({ browser }, testInfo) => {
    test.setTimeout(1_200_000);
    const steps: TrackingStepEvidence[] = [];

    const run = async (
      id: string,
      action: string,
      attemptedCaseIds: readonly string[],
      execute: (page: import('@playwright/test').Page, tracking: TrackingCollector, injector: TrackingFaultInjector) => Promise<void>,
      settleMs = 3_000
    ): Promise<void> => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const tracking = await TrackingCollector.create(page);
      const injector = new TrackingFaultInjector(page);
      let actionError: string | undefined;
      try {
        await execute(page, tracking, injector);
      } catch (error) {
        actionError = error instanceof Error ? error.message : String(error);
      }
      await tracking.flushAndWait(settleMs);
      steps.push({
        id,
        action,
        attemptedCaseIds,
        events: tracking.snapshot(),
        actionError,
        faultEvidence: injector.evidence,
        unifiedTrackCalls: tracking.snapshotTrackCalls()
      });
      await injector.dispose();
      await context.close();
    };

    await run(
      'exception-membership-quota',
      'Mock 会员额度接口 HTTP 500',
      ['DOC-088'],
      async (page, tracking, injector) => {
        await injector.http({
          id: 'membership-quota-500',
          url: /(?:\/apps\/ai-test\/api|https?:\/\/[^/]+\/api)\/membership\/quota(?:\?|$)/,
          method: 'GET',
          status: 500,
          code: 'QUOTA_SERVICE_UNAVAILABLE'
        });
        const create = new TrackingPage(page);
        await create.goto({ requireCustomizer: false });
        await tracking.expectExactlyOnce({
          name: cases.get('DOC-088')!.name,
          platform: 'monitor'
        });
        await injector.expectHit('membership-quota-500');
      }
    );

    await run(
      'exception-generate-2d',
      '上传图片后 Mock 2D 任务接口 HTTP 500',
      ['DOC-052'],
      async (page, tracking, injector) => {
        const create = new TrackingPage(page);
        await create.goto();
        await create.uploadFixture();
        tracking.clear();
        await injector.http({
          id: 'generate-2d-500',
          url: /(?:\/apps\/ai-test\/api|https?:\/\/[^/]+\/api)\/activity\/tasks(?:\/async)?(?:\?|$)/,
          method: 'POST',
          status: 500,
          code: 'GENERATION_SERVICE_UNAVAILABLE'
        });
        await create.startGeneration();
        await tracking.expectExactlyOnce({
          name: cases.get('DOC-052')!.name,
          platform: 'monitor'
        });
        await injector.expectHit('generate-2d-500');
      }
    );

    await run(
      'exception-file-reader',
      '注入 FileReader error 验证图片读取失败埋点',
      ['DOC-032'],
      async (page, tracking) => {
        await page.addInitScript(() => {
          const NativeFileReader = window.FileReader;
          class FailingFileReader extends NativeFileReader {
            override readAsDataURL(): void {
              const error = new DOMException('Injected FileReader failure', 'NotReadableError');
              Object.defineProperty(this, 'error', { configurable: true, value: error });
              queueMicrotask(() => this.dispatchEvent(new ProgressEvent('error')));
            }
          }
          window.FileReader = FailingFileReader;
        });
        const create = new TrackingPage(page);
        await create.goto();
        await create.uploadFixture();
        await tracking.expectExactlyOnce({
          name: cases.get('DOC-032')!.name,
          platform: 'monitor'
        });
      }
    );

    await run(
      'exception-fabric-resource',
      'Mock Fabric 资源失败验证画板加载失败埋点',
      ['DOC-043'],
      async (page, tracking, injector) => {
        await injector.http({
          id: 'fabric-load-500',
          url: /\/cdn\/shop\/t\/169\/assets\/fabric\.min\.js(?:\?|$)/,
          method: 'GET',
          status: 503,
          code: 'FABRIC_ASSET_UNAVAILABLE'
        });
        const create = new TrackingPage(page);
        await create.goto({ requireCustomizer: false });
        await tracking.expectExactlyOnce({
          name: cases.get('DOC-043')!.name,
          platform: 'monitor'
        });
        await injector.expectHit('fabric-load-500');
      }
    );

    const report = buildTrackingAuditReport({
      catalog: trackingCaseCatalog,
      steps,
      targetUrl: new URL(process.env.PRODUCT_URL ?? '/products/customize-your-own', baseUrl).toString(),
      skipReasons: {
        'DOC-030': '跳过：需要 Canvas 跨域导出污染状态，未在本轮注入。',
        'DOC-036': '跳过：需要已有生成资产，避免额外生成成本。',
        'DOC-039': '跳过：需要已有生成资产并单独失败 trackRecord 请求。',
        'DOC-041': '跳过：需要结果错误覆盖层及稳定 Retry 控件。',
        'DOC-049': '跳过：需要已有 3D 资产并注入模型资源失败。',
        'DOC-053': '跳过：需要 Canvas 导出运行时失败。',
        'DOC-058': '跳过：需要已有 2D 资产并执行 3D 生成。',
        'DOC-066': '跳过：需要 SSE 回退后的轮询链路。',
        'DOC-070': '跳过：涉及删除已有历史资产。',
        'DOC-074': '跳过：需要历史 3D 生成中资产。',
        'DOC-076': '跳过：匿名会话无可稳定触发的分页游标。',
        'DOC-078': '跳过：当前版本刷新链路没有稳定的独立入口。',
        'DOC-081': '跳过：需要已有历史资产缩略图。',
        'DOC-086': '跳过：Lottie 仅在错误覆盖层出现时加载。',
        'DOC-090': '跳过：需要已有模型 URL。',
        'DOC-092': '跳过：需要已有模型 URL 和解析插件初始化。',
        'DOC-094': '跳过：需要 Mock 商品价格数据。',
        'DOC-095': '跳过：需要进入轮询回退链路。',
        'DOC-096': '跳过：需要已有任务进入失败状态。',
        'DOC-100': '跳过：当前 Preview 未提供稳定预设模型入口。'
      }
    });
    const outputPath = resolve(output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await testInfo.attach('tracking-exception-audit.json', { path: outputPath, contentType: 'application/json' });
    expect(report.total).toBe(119);
    expect(report.passed + report.failed + report.skipped).toBe(119);
    if (process.env.TRACKING_STRICT === 'true') {
      expect(report.failed, 'TRACKING_STRICT=true 时埋点失败必须返回非零退出码').toBe(0);
    }
  });
});
