import { test } from '@playwright/test';
import { TrackingCollector } from './tracking-collector.js';
import { trackingActions } from './tracking-actions.js';
import { trackingContracts } from './tracking-contracts.js';
import { TrackingPage } from './tracking-page.js';

const trackingBaseUrl = process.env.TRACKING_BASE_URL;
const productionHosts = new Set(['jujubit.ai', 'www.jujubit.ai']);
const productionTrackingAllowed = process.env.ALLOW_PRODUCTION_TRACKING === 'true';
const trackingEnabled = process.env.TRACKING_TEST_ENABLED === 'true' && Boolean(trackingBaseUrl) &&
  (!productionHosts.has(new URL(trackingBaseUrl ?? 'https://jujubit.ai').hostname) || productionTrackingAllowed);

test.describe('画板与站内页面埋点', () => {
  test.skip(
    !trackingEnabled,
    '需配置 TRACKING_BASE_URL；生产域名还必须显式设置 ALLOW_PRODUCTION_TRACKING=true。'
  );

  test('TC-TRACK-01: 首次画板曝光只上报一次 POD_diy_view', async ({ page }) => {
    const tracking = await TrackingCollector.create(page);
    const create = new TrackingPage(page);
    await create.goto();
    await tracking.expectAllExactlyOnce([
      trackingContracts.diyViewGa4,
      trackingContracts.diyViewStatsig,
      trackingContracts.workflowImpressionMonitor
    ]);
  });

  test('TC-TRACK-02: 上传入口点击只上报一次且参数正确', async ({ page }) => {
    const tracking = await TrackingCollector.create(page);
    const create = new TrackingPage(page);
    await create.goto();

    tracking.clear();
    await create.click(trackingActions.upload.target(create));
    await tracking.expectAllExactlyOnce([
      trackingContracts.albumClickGa4,
      trackingContracts.albumHintMonitor
    ]);
  });

  test('TC-TRACK-03: Prompt 入口点击只上报一次且参数正确', async ({ page }) => {
    const tracking = await TrackingCollector.create(page);
    const create = new TrackingPage(page);
    await create.goto();

    // The product contract explicitly limits this event to the Pro canvas.
    await create.click(trackingActions.upgrade.target(create));
    tracking.clear();
    await create.click(trackingActions.prompt.target(create));
    await tracking.expectAllExactlyOnce([
      trackingContracts.promptClickGa4,
      trackingContracts.promptClickStatsig,
      trackingContracts.textToolbarMonitor
    ]);
    await create.click(create.cancelPromptEditingButton);
  });

  test('TC-TRACK-04: 生成 2D/3D 后 Gallery 与结果曝光只上报一次且参数正确', async ({ page }) => {
    const tracking = await TrackingCollector.create(page);
    const create = new TrackingPage(page);
    await create.goto();

    tracking.clear();
    await create.uploadFixture();
    await tracking.expectAllExactlyOnce([trackingContracts.imageUploadSelectedMonitor], { soft: true });

    tracking.clear();
    await create.startGeneration();
    await tracking.expectAllExactlyOnce([
      trackingContracts.generateClickGa4,
      trackingContracts.generateClickStatsig,
      trackingContracts.generateToolbarMonitor,
      trackingContracts.generateStartGa4,
      trackingContracts.generateTwoDStartMonitor
    ], { soft: true });

    await create.waitForTwoDResult();
    await tracking.expectAllExactlyOnce([
      trackingContracts.generateSuccessGa4,
      trackingContracts.generateSuccessStatsig,
      trackingContracts.generateTwoDSuccessMonitor,
      trackingContracts.twoDImpressionGa4,
      trackingContracts.twoDImpressionStatsig,
      trackingContracts.twoDResultImpressionMonitor
    ], { soft: true });

    tracking.clear();
    await create.waitForThreeDResult();
    await tracking.expectAllExactlyOnce([
      trackingContracts.threeDViewSwitchMonitor,
      trackingContracts.threeDImpressionGa4,
      trackingContracts.threeDImpressionStatsig,
      trackingContracts.threeDResultImpressionMonitor
    ], { soft: true });

    await create.click(create.createTab);
    tracking.clear();
    await create.click(trackingActions.gallery.target(create));
    await tracking.expectAllExactlyOnce([
      trackingContracts.galleryViewGa4,
      trackingContracts.galleryViewStatsig,
      trackingContracts.galleryTabMonitor
    ], { soft: true });
  });

  test('TC-TRACK-05: 模式切换事件只上报一次且状态正确', async ({ page }) => {
    const tracking = await TrackingCollector.create(page);
    const create = new TrackingPage(page);
    await create.goto();

    tracking.clear();
    await create.click(trackingActions.upgrade.target(create));
    await tracking.expectAllExactlyOnce([
      trackingContracts.upgradeClickGa4,
      trackingContracts.modeSelectionGa4,
      trackingContracts.modeSelectionStatsig,
      trackingContracts.upgradeModeSwitchMonitor
    ], { soft: true });

    tracking.clear();
    await create.click(trackingActions.solo.target(create));
    await tracking.expectAllExactlyOnce([
      trackingContracts.figureModeSwitchGa4,
      trackingContracts.figureModeSwitchMonitor
    ]);
  });
});
