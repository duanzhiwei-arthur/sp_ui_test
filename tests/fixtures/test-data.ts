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

export function canRunGeneration(): boolean {
  return process.env.ALLOW_PRODUCTION_GENERATION === 'true';
}
