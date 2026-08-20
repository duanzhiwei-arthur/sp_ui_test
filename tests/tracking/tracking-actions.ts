import { Locator } from '@playwright/test';
import { TrackingPage } from './tracking-page.js';

export interface TrackingAction {
  id: string;
  title: string;
  target: (page: TrackingPage) => Locator;
}

/** Reusable action registry. Add actions here before binding new event contracts. */
export const trackingActions = {
  upload: {
    id: 'upload',
    title: '点击上传图片入口',
    target: (page) => page.uploadButton
  },
  prompt: {
    id: 'prompt',
    title: '点击 Prompt 入口',
    target: (page) => page.promptButton
  },
  gallery: {
    id: 'gallery',
    title: '进入 Gallery',
    target: (page) => page.galleryTab
  },
  upgrade: {
    id: 'upgrade',
    title: '切换 Basic/Pro 模式',
    target: (page) => page.modeToggleButton
  },
  solo: {
    id: 'solo',
    title: '切换 Solo/Duo 任务模式',
    target: (page) => page.soloMode
  }
} as const satisfies Record<string, TrackingAction>;
