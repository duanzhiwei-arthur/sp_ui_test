import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { assetPath, canRunGeneration, testData } from './fixtures/test-data.js';
import { CreatePage } from './pages/create.page.js';

const skipGeneration = !canRunGeneration() || !existsSync(assetPath(testData.soloImage));

test.describe('线上游客态生成流程', () => {
  test.skip(skipGeneration, '需在 .env 配置素材，并显式允许线上生成。');

  test('TC-05: Prompt 生成记录可以在 History 中删除', async ({ page }) => {
    test.setTimeout(900_000);
    const create = new CreatePage(page);
    let historyCountBefore = 0;

    await test.step('记录生成前的 History 数量', async () => {
      await create.goto();
      await create.openGallery();
      historyCountBefore = await create.historyRecordDeleteButtons.count();
      await create.openBlankCreate();
    });

    await test.step('上传图片并写入 Prompt', async () => {
      await create.uploadImage(assetPath(testData.soloImage));
      await create.enterPrompt(testData.prompt);
      await expect(create.promptInput).toHaveValue(testData.prompt);
      await create.click(create.confirmPromptEditingButton);
      await expect(create.promptInput).toBeHidden();
    });

    await test.step('生成并验证 2D 图片', async () => {
      await create.startGeneration();
      await create.waitForTwoDGeneration();
    });

    await test.step('等待 3D 完成并横向拖动 2 秒', async () => {
      await create.waitForThreeDGeneration();
      await create.rotateThreeDPreview();
    });

    await test.step('History 新增记录后删除最新记录', async () => {
      await create.openGallery();
      await create.expectHistoryRecordAdded(historyCountBefore);
      await create.deleteLatestHistoryRecord(historyCountBefore);
    });
  });

  // This scenario intentionally leaves a background task running. Run it after
  // completed-generation coverage, but before the final membership probe.
  test('TC-04: 生成期间返回 Create 后可继续创建任务', async ({ page }) => {
    const create = new CreatePage(page);
    await create.goto();
    await create.uploadImage(assetPath(testData.soloImage));
    await create.startGeneration();
    await create.openGallery();
    await create.openCreate();
    await create.uploadImage(assetPath(testData.soloImage));
    await expect(create.generateButton).toBeEnabled();
  });

  // Keep this probe last: when the membership entry is absent, Generate still
  // starts a background task before the case is intentionally skipped.
  test('TC-06: 生成后会员权益入口可打开会员弹窗', async ({ page }) => {
    const stableId = process.env.TEST_MEMBERSHIP_STABLE_ID ?? 'jujubit-ui-e2e-membership-20260902';
    await page.addInitScript((id) => {
      // Statsig namespaces its localStorage StableID by the SDK-key hash.
      // Keep the generic keys too for storefront builds that read them directly.
      // Statsig reads this entry through JSON.parse, so the value must be a
      // JSON-encoded string rather than the raw ID.
      window.localStorage.setItem('statsig.stable_id.3770913638', JSON.stringify(id));
      window.localStorage.setItem('stable_id', id);
      window.localStorage.setItem('stableId', id);
    }, stableId);

    const create = new CreatePage(page);
    await create.goto();
    await expect.poll(
      () => page.evaluate(async () => {
        const statsig = window as Window & {
          statsigReady?: Promise<void>;
          statsigClient?: { getContext(): { stableID?: string } };
        };
        await statsig.statsigReady;
        return statsig.statsigClient?.getContext().stableID;
      }),
      { message: 'Statsig 应读取 TC-06 固定 stable_id', timeout: 30_000 }
    ).toBe(stableId);
    await create.uploadImage(assetPath(testData.soloImage));
    await create.startGeneration();

    const membershipShown = await create.membershipBenefitsText
      .waitFor({ state: 'visible', timeout: 120_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!membershipShown, `stable_id=${stableId} 未命中 Member Benefits: 20% OFF 会员实验组。`);

    // The membership card is rendered with the generated Gallery result.
    // Click its own Upgrade action while the entry is still visible.
    await expect(create.membershipUpgradeButton).toBeVisible();
    await create.click(create.membershipUpgradeButton);
    await expect(create.membershipDialogTitle).toBeVisible();
    await expect(create.membershipDialogCloseButton).toBeVisible();

    const loggedIn = await page.evaluate(() => Boolean((window as Window & {
      theme?: { customerId?: string | number | null };
    }).theme?.customerId));
    await expect(create.membershipJoinButton).toBeVisible();
    const expectedRedirect = loggedIn
      ? /airwallex/i
      : /(?:customer_authentication\/login|\/account(?:\/login)?|shopify\.com\/authentication\/[^/]+\/(?:login|oauth\/authorize))/i;
    await Promise.all([
      page.waitForURL((url) => expectedRedirect.test(`${url.hostname}${url.pathname}${url.search}`), {
        timeout: 120_000,
        waitUntil: 'domcontentloaded'
      }),
      create.membershipJoinButton.click()
    ]);

    if (loggedIn) {
      expect(page.url()).toMatch(/airwallex/i);
    } else {
      expect(page.url()).toMatch(expectedRedirect);
    }
  });
});
