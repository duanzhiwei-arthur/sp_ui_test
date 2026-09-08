export type ExperimentLifecycle = 'draft' | 'testing' | 'running' | 'rolled_out' | 'stopped';

export interface ExperimentVariant {
  stableId?: string;
  expectedValue: string | boolean | number;
}

export interface ExperimentDefinition {
  key: string;
  experimentName: string;
  parameterName: string;
  lifecycle: ExperimentLifecycle;
  owner: string;
  environment: 'preview' | 'production' | 'both';
  linkedCases: readonly string[];
  variants: Readonly<Record<string, ExperimentVariant>>;
}

const value = (name: string): string | undefined => process.env[name]?.trim() || undefined;

export const statsigClientKey = value('TEST_STATSIG_CLIENT_KEY') ??
  'client-2tnhqG57crRsKHR9oTHbP4UsCNu7zQjghyI8otQUMU4';

export const experimentRegistry = {
  membershipBanner: {
    key: 'membershipBanner',
    experimentName: 'show_vip_banner',
    parameterName: 'enable',
    lifecycle: 'running',
    owner: 'membership',
    environment: 'production',
    linkedCases: ['TC-EXP-01', 'TC-06'],
    variants: {
      control: {
        stableId: value('TEST_MEMBERSHIP_CONTROL_STABLE_ID'),
        expectedValue: false
      },
      treatment: {
        stableId: value('TEST_MEMBERSHIP_STABLE_ID') ?? 'jujubit-ui-e2e-membership-20260902',
        expectedValue: true
      }
    }
  }
} as const satisfies Readonly<Record<string, ExperimentDefinition>>;

export type ExperimentKey = keyof typeof experimentRegistry;

export function statsigStableIdStorageKey(sdkKey = statsigClientKey): string {
  let hash = 0;
  for (const character of `k:${sdkKey}`) {
    hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  }
  return `statsig.stable_id.${hash >>> 0}`;
}
