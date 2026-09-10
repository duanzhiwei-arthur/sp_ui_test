import { existsSync } from 'node:fs';
import { experimentRegistry } from '../experiments/experiment-registry.js';
import { expect, test } from '../experiments/experiment.fixture.js';
import { assetPath, canRunGeneration, testData } from '../fixtures/test-data.js';
import { CreatePage } from '../pages/create.page.js';

test.describe(`画板实验：${experimentRegistry.canvasTemplateDisplay.experimentName}`, () => {
  test.use({ experimentSelection: { experiment: 'canvasTemplateDisplay', variant: 'treatment' } });

  test('TC-EXP-02: Treatment 支持多模板并行生成并切换 3D 资产', async ({ page, experiment }) => {
    test.setTimeout(1_200_000);
    test.skip(
      !canRunGeneration() || !existsSync(assetPath(testData.soloImage)),
      '需配置测试素材，并显式允许线上生成。'
    );

    const create = new CreatePage(page);
    await create.goto();
    await experiment.assertAssignment(page);
    await page.waitForTimeout(10_000);
    await create.dismissMarketingPopup();

    await test.step('One → Two → One 切换', async () => {
      await create.click(create.oneSubjectButton);
      await expect(create.oneSubjectButton).toHaveAttribute('aria-pressed', 'true');
      await create.click(create.twoSubjectButton);
      await expect(create.twoSubjectButton).toHaveAttribute('aria-pressed', 'true');
      await create.click(create.oneSubjectButton);
      await expect(create.oneSubjectButton).toHaveAttribute('aria-pressed', 'true');
    });

    await test.step('按顺序选择 Free Style、TRPG、Soft Chibi', async () => {
      await create.selectCanvasTemplates();
    });

    await test.step('打开并关闭 TRPG 模板预览', async () => {
      await create.click(create.trpgPreviewButton);
      await expect(create.stylePreviewDialog).toBeVisible();
      await create.click(create.stylePreviewCloseButton);
      await expect(create.stylePreviewDialog).toBeHidden();
    });

    await test.step('Choose Your Style 横向滑动到末尾', async () => {
      await create.scrollCanvasStylesToEnd();
    });

    let historyCountBefore = 0;
    await test.step('记录生成前 History 数量', async () => {
      historyCountBefore = await create.historyTotal();
    });

    await test.step('上传图片并提交 3 个模板生成', async () => {
      await create.uploadImage(assetPath(testData.soloImage));
      await create.startGeneration();
      await create.expectThreeNewGeneratingHistoryRecords(historyCountBefore);
    });

    await test.step('等待本次 3 条 History 记录生成完成', async () => {
      await create.waitForNewHistoryRecordsComplete();
    });

    await test.step('切换本次生成资产并逐一验证 3D', async () => {
      await create.verifyNewHistoryRecordsThreeD();
    });
  });
});
