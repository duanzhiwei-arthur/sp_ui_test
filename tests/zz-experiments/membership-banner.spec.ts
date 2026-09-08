import { existsSync } from 'node:fs';
import { experimentRegistry } from '../experiments/experiment-registry.js';
import { expect, test } from '../experiments/experiment.fixture.js';
import { assetPath, canRunGeneration, testData } from '../fixtures/test-data.js';
import { CreatePage } from '../pages/create.page.js';

test.describe(`会员权益实验：${experimentRegistry.membershipBanner.experimentName}`, () => {
  test.describe('Control', () => {
    test.use({ experimentSelection: { experiment: 'membershipBanner', variant: 'control' } });

    test('TC-EXP-01: Control 分组不展示会员权益入口', async ({ page, experiment }) => {
      test.skip(!experiment.configured, '需配置 TEST_MEMBERSHIP_CONTROL_STABLE_ID 并固定加入 Control 分组。');
      const create = new CreatePage(page);
      await create.goto();
      await experiment.assertAssignment(page);
      await expect(create.membershipBenefitsText).toBeHidden();
    });
  });

  test.describe('Treatment', () => {
    test.use({ experimentSelection: { experiment: 'membershipBanner', variant: 'treatment' } });

    test('TC-06: Treatment 分组可打开会员弹窗并进入结算或登录', async ({ page, experiment }) => {
      test.skip(
        !canRunGeneration() || !existsSync(assetPath(testData.soloImage)),
        '需配置测试素材，并显式允许线上生成。'
      );
      const create = new CreatePage(page);
      await create.goto();
      await experiment.assertAssignment(page);
      await create.uploadImage(assetPath(testData.soloImage));
      await create.startGeneration();
      await expect(create.membershipBenefitsText).toBeVisible({ timeout: 120_000 });
      await expect(create.membershipUpgradeButton).toBeVisible();
      await create.click(create.membershipUpgradeButton);
      await expect(create.membershipDialogTitle).toBeVisible();
      await expect(create.membershipDialogCloseButton).toBeVisible();

      const loggedIn = await page.evaluate(() => Boolean((window as Window & {
        theme?: { customerId?: string | number | null };
      }).theme?.customerId));
      const expectedRedirect = loggedIn
        ? /airwallex/i
        : /(?:customer_authentication\/login|\/account(?:\/login)?|shopify\.com\/authentication\/[^/]+\/(?:login|oauth\/authorize))/i;
      await expect(create.membershipJoinButton).toBeVisible();
      await Promise.all([
        page.waitForURL((url) => expectedRedirect.test(`${url.hostname}${url.pathname}${url.search}`), {
          timeout: 120_000,
          waitUntil: 'domcontentloaded'
        }),
        create.membershipJoinButton.click()
      ]);
      expect(page.url()).toMatch(expectedRedirect);
    });
  });
});
