import path from 'node:path';

export const testData = {
  soloImage: process.env.TEST_IMAGE_SOLO ?? 'assets/solo.jpg',
  duoImage: process.env.TEST_IMAGE_DUO ?? 'assets/duo.jpg',
  largeImage: process.env.TEST_IMAGE_LARGE ?? 'assets/large.jpg',
  prompt: process.env.TEST_PROMPT ?? 'A friendly fantasy adventurer in a forest',
  modelLabel: process.env.TEST_MODEL_LABEL ?? ''
};

export function assetPath(relativePath: string): string {
  return path.resolve(process.cwd(), relativePath);
}

let generationWarningShown = false;

export function canRunGeneration(): boolean {
  const allowed = process.env.ALLOW_PRODUCTION_GENERATION === 'true';
  const confirmed = process.env.CONFIRM_PRODUCTION_GENERATION === 'YES';
  if (allowed && !confirmed && !generationWarningShown) {
    generationWarningShown = true;
    console.warn(
      '\n⛔  已阻止真实生成：请同时设置 CONFIRM_PRODUCTION_GENERATION=YES。' +
      '\n   示例：ALLOW_PRODUCTION_GENERATION=true CONFIRM_PRODUCTION_GENERATION=YES npm run test:daily\n'
    );
  }
  if (allowed && confirmed && !generationWarningShown) {
    generationWarningShown = true;
    console.warn(
      '\n⚠️  ALLOW_PRODUCTION_GENERATION=true — 本次运行会在线上创建真实生成任务并加购。' +
      '\n   如果不需要真实生成，请移除该变量或设为 false。\n'
    );
  }
  return allowed && confirmed;
}
