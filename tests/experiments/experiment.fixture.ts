import { expect, test as base, type Page } from '@playwright/test';
import {
  experimentRegistry,
  statsigStableIdStorageKey,
  type ExperimentDefinition,
  type ExperimentKey,
  type ExperimentVariant
} from './experiment-registry.js';

export interface ExperimentSelection {
  experiment: ExperimentKey;
  variant: string;
}

export interface ExperimentRuntime {
  definition: ExperimentDefinition;
  variantName: string;
  variant: ExperimentVariant;
  configured: boolean;
  assertAssignment(page: Page): Promise<void>;
}

interface ExperimentFixtures {
  experimentSelection: ExperimentSelection;
  experiment: ExperimentRuntime;
}

export const test = base.extend<ExperimentFixtures>({
  experimentSelection: [{ experiment: 'membershipBanner', variant: 'treatment' }, { option: true }],
  experiment: async ({ page, experimentSelection }, use, testInfo) => {
    const definition = experimentRegistry[experimentSelection.experiment];
    const variant = definition.variants[experimentSelection.variant as keyof typeof definition.variants];
    if (!variant) {
      throw new Error(`未知实验分组：${definition.experimentName}.${experimentSelection.variant}`);
    }

    const stableId = variant.stableId;
    if (stableId) {
      const storageKey = statsigStableIdStorageKey();
      await page.addInitScript(({ id, key }) => {
        window.localStorage.setItem(key, JSON.stringify(id));
        window.localStorage.setItem('stable_id', id);
        window.localStorage.setItem('stableId', id);
      }, { id: stableId, key: storageKey });
    }

    testInfo.annotations.push(
      { type: 'experiment', description: definition.experimentName },
      { type: 'variant', description: experimentSelection.variant },
      { type: 'stable_id', description: stableId ?? '未配置' }
    );

    await use({
      definition,
      variantName: experimentSelection.variant,
      variant,
      configured: Boolean(stableId),
      async assertAssignment(targetPage) {
        if (!stableId) {
          throw new Error(`${definition.experimentName}.${experimentSelection.variant} 未配置固定 stable_id`);
        }
        const assignment = await expect.poll(
          () => targetPage.evaluate(async ({ experimentName, parameterName }) => {
            const target = window as Window & {
              statsigReady?: Promise<void>;
              statsigClient?: {
                getContext(): { stableID?: string };
                getExperiment(name: string): { get(key: string, fallback: unknown): unknown };
              };
            };
            await target.statsigReady;
            return {
              stableId: target.statsigClient?.getContext().stableID,
              value: target.statsigClient?.getExperiment(experimentName).get(parameterName, null)
            };
          }, {
            experimentName: definition.experimentName,
            parameterName: definition.parameterName
          }),
          {
            message: `实验分流应为 ${definition.experimentName}.${definition.parameterName}=${String(variant.expectedValue)}`,
            timeout: 30_000
          }
        ).toEqual({ stableId, value: variant.expectedValue });
        void assignment;
      }
    });
  }
});

export { expect } from '@playwright/test';
