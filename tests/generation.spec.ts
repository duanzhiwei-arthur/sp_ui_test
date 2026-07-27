import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { assetPath, canRunGeneration, testData } from './fixtures/test-data.js';
import { CreatePage } from './pages/create.page.js';

const skipGeneration = !canRunGeneration() || !existsSync(assetPath(testData.soloImage));

test.describe('线上游客态生成流程', () => {
  test.skip(skipGeneration, '需在 .env 配置素材，并显式允许线上生成。');

  test('TC-18: 生成期间返回 Create 后可继续创建任务', async ({ page }) => {
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
