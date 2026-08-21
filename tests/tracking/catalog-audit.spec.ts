import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildTrackingAuditReport, TrackingStepEvidence } from './tracking-audit.js';
import { trackingCaseCatalog } from './tracking-case-catalog.js';
import { TrackingCollector } from './tracking-collector.js';
import { TrackingPage } from './tracking-page.js';

const trackingBaseUrl = process.env.TRACKING_BASE_URL;
const productionHosts = new Set(['jujubit.ai', 'www.jujubit.ai']);
const productionTrackingAllowed = process.env.ALLOW_PRODUCTION_TRACKING === 'true';
const trackingEnabled = process.env.TRACKING_TEST_ENABLED === 'true' && Boolean(trackingBaseUrl) &&
  (!productionHosts.has(new URL(trackingBaseUrl ?? 'https://jujubit.ai').hostname) || productionTrackingAllowed);
const auditOutput = process.env.TRACKING_AUDIT_OUTPUT ?? 'test-results/tracking-catalog-audit.json';

test.describe('119 条埋点目录审计', () => {
  test.skip(
    !trackingEnabled,
    '需配置 TRACKING_BASE_URL；生产域名还必须显式设置 ALLOW_PRODUCTION_TRACKING=true。'
  );

  test('逐条执行可安全触发动作并生成完整结果', async ({ page }, testInfo) => {
    test.setTimeout(1_200_000);
    const tracking = await TrackingCollector.create(page);
    const create = new TrackingPage(page);
    const steps: TrackingStepEvidence[] = [];

    const runStep = async (
      id: string,
      action: string,
      attemptedCaseIds: readonly string[],
      execute: () => Promise<void>,
      settleMs = 3_000
    ): Promise<void> => {
      tracking.clear();
      let actionError: string | undefined;
      try {
        await execute();
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
        unifiedTrackCalls: tracking.snapshotTrackCalls()
      });
    };

    await runStep(
      'initial-render',
      '打开测试首页并通过 Create 进入商品自定义器，等待画板完成渲染',
      ['DOC-003', 'DOC-014', 'DOC-027', 'DOC-028', 'DOC-111', 'DOC-119'],
      async () => {
        await create.goto({ requireCustomizer: false });
        await create.dismissMarketingPopup();
        await page.waitForTimeout(10_000);
      },
      3_000
    );

    await runStep(
      'upload-entry',
      '点击上传图片入口',
      ['DOC-001', 'DOC-040'],
      () => create.click(create.uploadButton)
    );

    await runStep(
      'style-switch',
      '打开风格菜单并选择 TRPG',
      ['DOC-003', 'DOC-015', 'DOC-112'],
      async () => {
        await create.click(create.styleButton);
        await create.click(create.trpgStyleButton);
      },
      5_000
    );

    await runStep(
      'inspiration-select',
      '点击第一个 Inspiration 预设模型',
      ['DOC-013', 'DOC-102'],
      async () => {
        await create.click(create.inspirationButtons.first());
      },
      5_000
    );

    await runStep(
      'upgrade-pro',
      '从 Basic 切换到 Pro 画板',
      ['DOC-002', 'DOC-006', 'DOC-044', 'DOC-045', 'DOC-108'],
      () => create.click(create.modeToggleButton),
      5_000
    );

    await runStep(
      'prompt-toolbar',
      '点击 Pro 工具栏 Text 并关闭编辑器',
      ['DOC-012', 'DOC-107'],
      async () => {
        await create.click(create.promptButton);
        await create.click(create.cancelPromptEditingButton);
      }
    );

    await runStep(
      'paint-toolbar',
      '开启 Pro 画笔模式',
      ['DOC-010', 'DOC-093', 'DOC-107'],
      () => create.click(create.paintButton)
    );

    await runStep(
      'figure-mode',
      '切换 Solo/Duo 主体模式',
      ['DOC-004', 'DOC-046'],
      () => create.click(create.soloMode),
      6_000
    );

    await runStep(
      'image-upload',
      '选择有效图片并等待画板读取完成',
      ['DOC-022', 'DOC-023', 'DOC-031', 'DOC-033', 'DOC-084'],
      () => create.uploadFixture(),
      5_000
    );

    await runStep(
      'generate-start',
      '点击 Generate 并进入 2D 生成流程',
      ['DOC-005', 'DOC-008', 'DOC-009', 'DOC-055', 'DOC-107', 'DOC-109'],
      () => create.startGeneration(),
      5_000
    );

    await runStep(
      'two-d-result',
      '等待并展示 2D 结果',
      ['DOC-019', 'DOC-024', 'DOC-056', 'DOC-106'],
      async () => {
        await tracking.waitForObserved({ name: 'jjb_canvas_v3_generate_2d_success', platform: 'monitor' }, 300_000);
        await tracking.flushAndWait(3_000);
      },
      5_000
    );

    await runStep(
      'three-d-result',
      '点击 3D 并等待模型完成展示',
      ['DOC-025', 'DOC-050', 'DOC-060', 'DOC-063', 'DOC-064', 'DOC-089', 'DOC-091', 'DOC-106', 'DOC-110'],
      async () => {
        await tracking.waitForObserved({ name: 'jjb_canvas_v3_generate_3d_success', platform: 'monitor' }, 300_000);
        await tracking.flushAndWait(3_000);
      },
      5_000
    );

    await runStep(
      'gallery',
      '进入 Gallery 并等待历史记录刷新',
      ['DOC-016', 'DOC-079', 'DOC-087', 'DOC-110'],
      () => create.click(create.galleryTab),
      5_000
    );

    await runStep(
      'add-to-cart',
      '点击 Add to Cart，验证加购与购物车信息上报',
      ['DOC-037', 'DOC-038', 'DOC-118'],
      async () => {
        await create.click(create.addToCartButton);
      },
      5_000
    );

    await runStep(
      'membership-impression',
      '访问会员方案页并等待付费墙曝光',
      ['DOC-117'],
      async () => {
        const response = await page.goto('/pages/vip-program', { waitUntil: 'domcontentloaded' });
        expect(response?.status(), '会员方案页应可访问').toBeLessThan(400);
      },
      5_000
    );

    await runStep(
      'membership-click',
      '点击会员方案页的首个方案按钮',
      ['DOC-116'],
      async () => {
        const planControl = page.locator('a, button')
          .filter({ hasText: /join|get started|subscribe|choose|select|buy/i })
          .first();
        await create.click(planControl);
      },
      5_000
    );

    const report = buildTrackingAuditReport({
      catalog: trackingCaseCatalog,
      steps,
      targetUrl: new URL(process.env.TRACKING_ENTRY_URL ?? '/', trackingBaseUrl).toString(),
      skipReasons: {
        'DOC-007': '跳过：当前页面无 Refine 功能入口。',
        'DOC-011': '跳过：本轮 2D 正常生成，没有 Retry 入口。',
        'DOC-026': '跳过：匿名 Gallery 未提供可稳定定位的历史资产选择控件。',
        'DOC-029': '跳过：本轮使用 Pro 画板，未执行 Basic 图片删除。',
        'DOC-034': '跳过：未删除已上传对象，避免影响同轮生成证据。',
        'DOC-067': '跳过：未对生产历史资产执行删除流程。',
        'DOC-068': '跳过：未对生产历史资产执行删除流程。',
        'DOC-069': '跳过：未对生产历史资产执行删除流程。',
        'DOC-071': '跳过：未对生产历史资产执行删除流程。',
        'DOC-072': '跳过：未对生产历史资产执行删除流程。',
        'DOC-080': '跳过：匿名 Gallery 未提供可稳定定位的历史资产选择控件。',
        'DOC-099': '跳过：预设点击只验证选择事件，未额外发起第二次生产生成。',
        'DOC-101': '跳过：预设点击只验证选择事件，未额外发起第二次生产生成。',
        'DOC-103': '跳过：当前页面无 Refine 功能入口。',
        'DOC-104': '跳过：当前页面无 Refine 功能入口。',
        'DOC-105': '跳过：当前页面无 Refine 功能入口。',
        'DOC-113': '跳过：源文档标注“暂时不管/开发确认”，且此前范围明确排除活动埋点。',
        'DOC-114': '跳过：源文档标注“暂时不管/开发确认”，且此前范围明确排除活动埋点。',
        'DOC-115': '跳过：源文档标注“暂时不管/开发确认”。'
      }
    });

    const outputPath = resolve(auditOutput);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await testInfo.attach('tracking-catalog-audit.json', {
      path: outputPath,
      contentType: 'application/json'
    });

    expect(report.total).toBe(119);
    expect(report.passed + report.failed + report.skipped).toBe(119);
    if (process.env.TRACKING_STRICT === 'true') {
      expect(report.failed, 'TRACKING_STRICT=true 时埋点失败必须返回非零退出码').toBe(0);
    }
  });
});
