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

test.describe('有效埋点目录审计', () => {
  test.skip(
    !trackingEnabled,
    '需配置 TRACKING_BASE_URL；生产域名还必须显式设置 ALLOW_PRODUCTION_TRACKING=true。'
  );

  test('逐条执行可安全触发动作并生成完整结果', async ({ browser }, testInfo) => {
    test.setTimeout(1_200_000);
    const steps: TrackingStepEvidence[] = [];

    const runScene = async (
      execute: (scene: {
        page: Awaited<ReturnType<typeof browser.newPage>>;
        tracking: TrackingCollector;
        create: TrackingPage;
        runStep: (
          id: string,
          action: string,
          attemptedCaseIds: readonly string[],
          executeStep: () => Promise<void>,
          settleMs?: number
        ) => Promise<void>;
      }) => Promise<void>
    ): Promise<void> => {
      const context = await browser.newContext({ baseURL: trackingBaseUrl });
      const page = await context.newPage();
      const tracking = await TrackingCollector.create(page);
      const create = new TrackingPage(page);
    const runStep = async (
      id: string,
      action: string,
      attemptedCaseIds: readonly string[],
      executeStep: () => Promise<void>,
      settleMs = 3_000
    ): Promise<void> => {
      tracking.clear();
      let actionError: string | undefined;
      try {
        await executeStep();
      } catch (error) {
        actionError = error instanceof Error ? error.message : String(error);
      }
      await tracking.flushAndWait(settleMs);
      steps.push({
        id,
        action,
        attemptedCaseIds: attemptedCaseIds.filter((caseId) =>
          trackingCaseCatalog.some((trackingCase) => trackingCase.id === caseId)
        ),
        events: tracking.snapshot(),
        actionError,
        unifiedTrackCalls: tracking.snapshotTrackCalls()
      });
    };
      try {
        await execute({ page, tracking, create, runStep });
      } finally {
        await context.close();
      }
    };

    await runScene(async ({ page, create, runStep }) => {
      await runStep(
        'initial-render',
        '新游客会话：打开首页并通过 Create 进入商品自定义器，首次渲染后立即采集曝光',
      ['DOC-003', 'DOC-028', 'DOC-111', 'DOC-119'],
        async () => {
          await create.goto({ requireCustomizer: false });
          await create.dismissMarketingPopup();
          await page.waitForTimeout(10_000);
        },
        3_000
      );
    });

    await runScene(async ({ create, runStep }) => {
      await create.goto();
      await runStep(
      'upload-entry',
      '点击上传图片入口',
      ['DOC-001', 'DOC-040'],
      () => create.click(create.uploadButton)
      );

      await runStep(
      'style-switch',
      '打开风格菜单并选择 TRPG',
      ['DOC-003', 'DOC-112'],
      async () => {
        await create.click(create.styleButton);
        await create.click(create.trpgStyleButton);
      },
      5_000
      );

      await runStep(
      'inspiration-select',
      '点击第一个 Inspiration 预设模型',
      [],
      async () => {
        await create.click(create.inspirationButtons.first());
      },
      5_000
      );

      await runStep(
      'upgrade-pro',
      '从 Basic 切换到 Pro 画板',
      ['DOC-002', 'DOC-044', 'DOC-045', 'DOC-108'],
      () => create.click(create.modeToggleButton),
      5_000
      );

      await runStep(
      'prompt-toolbar',
      '点击 Pro 工具栏 Text 并关闭编辑器',
      ['DOC-107'],
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
    });

    await runScene(async ({ tracking, create, runStep }) => {
      await create.goto();
      await create.click(create.modeToggleButton);
      await runStep(
      'image-upload',
      '选择有效图片并等待画板读取完成',
      ['DOC-033', 'DOC-084'],
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
    });

    await runScene(async ({ page, create, runStep }) => {
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
    });

    const report = buildTrackingAuditReport({
      catalog: trackingCaseCatalog,
      steps,
      targetUrl: new URL(process.env.TRACKING_ENTRY_URL ?? '/', trackingBaseUrl).toString(),
      executionPlan: {
        strategy: '按触发类型拆分为独立浏览器场景：首次曝光、编辑点击、生成完成与加购、会员条件页；每个场景独立上下文，事件只在对应前置状态下验证。',
        riskPoints: [
          '单一长会话会让前一步改变后一步的页面状态，导致曝光事件错过或点击事件前置不成立。',
          '第三方资源、异步 SDK 批次和页面跳转可能让网络请求晚于 SDK 回调到达，产生“未上报”误判。',
          '真实生成和加购会产生线上成本与数据影响；不能为覆盖目录而执行删除、付款或重复生成。',
          '实验分流、会员入口和 Inspiration 列表属于条件场景，未命中时不能当作业务失败。'
        ],
        improvements: [
          '曝光事件在新场景首次进入目标状态后立即采集；点击事件在动作前清空记录并只验证本次动作。',
          '生成/异步完成事件等待明确完成信号；Statsig/Monitor 在断言前 flush，并保留 SDK 与批次请求的关联证据。',
          '废弃事件、不可安全触发的异常和缺少前置入口的目录项明确标记为 skipped。',
          '保留一次真实生成、一次加购和零付款边界，避免用例覆盖扩大生产影响。'
        ]
      },
      skipReasons: {
        'DOC-007': '跳过：当前页面无 Refine 功能入口。',
        'DOC-014': '跳过：当前页面未提供稳定的 Inspiration 预设列表入口。',
        'DOC-022': '跳过：旧版全轮询上传开始事件已废弃，当前实现使用 jjb_canvas_v3_image_upload_selected。',
        'DOC-023': '跳过：旧版全轮询上传成功事件已废弃，当前实现使用 jjb_canvas_v3_canvas_image_added。',
        'DOC-027': '跳过：当前匿名会话未展示会员入口，未安全触发会员曝光。',
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

    expect(report.total).toBe(trackingCaseCatalog.length);
    expect(report.passed + report.failed + report.skipped).toBe(trackingCaseCatalog.length);
    if (process.env.TRACKING_STRICT === 'true') {
      expect(report.failed, 'TRACKING_STRICT=true 时埋点失败必须返回非零退出码').toBe(0);
    }
  });
});
