import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { automationOrigins } from './automation-identity.js';
import { statsigStableIdStorageKey } from '../experiments/experiment-registry.js';

export type CanvasAssignment = { stableId: string; variant: 'control' | 'treatment' };

export async function installCanvasAssignment(context: BrowserContext, baseURL: string, assignment: CanvasAssignment) {
  await context.addInitScript(({ origins, key, id }) => {
    if (!origins.includes(location.origin)) return;
    localStorage.removeItem('_statsig_override');
    localStorage.setItem(key, JSON.stringify(id));
    localStorage.setItem('stable_id', id);
    localStorage.setItem('stableId', id);
  }, { origins: automationOrigins(baseURL), key: statsigStableIdStorageKey(), id: assignment.stableId });
}

export async function assertCanvasAssignment(page: Page, info: TestInfo, assignment: CanvasAssignment) {
  const read = () => page.evaluate(() => {
    const w = window as unknown as {
      __jjbCanvasV3Enabled?: boolean;
      statsigClient?: {
        getContext(): { stableID?: string };
        getExperiment(name: string): { get(key: string, fallback: unknown): unknown };
      };
    };
    return {
      stableId: w.statsigClient?.getContext().stableID ?? null,
      canvas: w.statsigClient?.getExperiment('canvas_v3_109').get('enable', null) ?? null,
      trust: w.statsigClient?.getExperiment('canvas_trust_info').get('enable', null) ?? null,
      renderedV3: w.__jjbCanvasV3Enabled ?? null,
      override: localStorage.getItem('_statsig_override'),
    };
  });
  let last: Awaited<ReturnType<typeof read>> | undefined;
  try {
    await expect.poll(async () => {
      last = await read();
      return { stableId: last.stableId, canvas: last.canvas, renderedV3: last.renderedV3, override: last.override };
    }, { timeout: 45_000, message: '画板实验分组前置校验：stable_id与真实分组/画板必须一致；不自动强制开启实验' })
      .toEqual({ stableId: assignment.stableId, canvas: assignment.variant === 'treatment', renderedV3: assignment.variant === 'treatment', override: null });
    if (assignment.variant === 'treatment') expect(last?.trust, 'EXP用例同时要求canvas_trust_info.enable=true；缺少增信分组不能冒充通过').toBe(true);
  } finally {
    await info.attach('canvas-assignment', { body: JSON.stringify({ expected: assignment, actual: last ?? null, at: new Date().toISOString() }, null, 2), contentType: 'application/json' });
  }
}
