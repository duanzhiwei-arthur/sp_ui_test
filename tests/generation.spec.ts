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
      await create.click(create.createTab);
      await expect(create.uploadButton).toBeVisible();
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

  // This scenario intentionally leaves a background task running, so keep it
  // last to avoid consuming the generation slot needed by TC-05.
  test('TC-04: 生成期间返回 Create 后可继续创建任务', async ({ page }) => {
    const create = new CreatePage(page);
    await create.goto();
    await create.uploadImage(assetPath(testData.soloImage));
    await create.startGeneration();
    await create.openGallery();
    await create.click(create.createTab);
    await expect(create.uploadButton).toBeVisible();
    await expect(create.generateButton).toBeDisabled();
    await create.uploadImage(assetPath(testData.soloImage));
    await expect(create.generateButton).toBeEnabled();
  });
});
