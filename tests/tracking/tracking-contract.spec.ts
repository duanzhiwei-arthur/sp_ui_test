import { expect, test } from '@playwright/test';
import { TrackingCollector } from './tracking-collector.js';
import { TrackingFaultInjector } from './tracking-fault-injection.js';
import { TrackingPage } from './tracking-page.js';

const baseUrl = process.env.TRACKING_BASE_URL;
const enabled = process.env.TRACKING_CONTRACT_TEST_ENABLED === 'true' && Boolean(baseUrl);

test.describe('运行时埋点契约与平台隔离', () => {
  test.skip(!enabled, '设置 TRACKING_CONTRACT_TEST_ENABLED=true 和 TRACKING_BASE_URL 后执行。');

  test('window.track 与三平台公共上下文均可探测', async ({ page }) => {
    const tracking = await TrackingCollector.create(page);
    const create = new TrackingPage(page);
    await create.goto({ requireCustomizer: false });
    await tracking.expectUnifiedContract({ requireContexts: true });
  });

  test('单平台 SDK 抛错不阻断其他平台和页面点击', async ({ page }) => {
    const tracking = await TrackingCollector.create(page);
    const injector = new TrackingFaultInjector(page);
    const create = new TrackingPage(page);
    await injector.sdk({ id: 'monitor-sdk-throw', platform: 'monitor' });
    await create.goto();
    tracking.clear();
    await create.click(create.uploadButton);
    await tracking.expectExactlyOnce({ name: 'POD_Canvas_Album_Click', platform: 'ga4' });
    await expect.poll(
      () => injector.evidence.filter((hit) => hit.id === 'monitor-sdk-throw').length,
      { timeout: 30_000, message: 'Monitor SDK 故障桩未命中' }
    ).toBeGreaterThan(0);
    await injector.dispose();
  });
});
