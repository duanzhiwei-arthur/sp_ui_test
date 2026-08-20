import { expect, Page, Route } from '@playwright/test';

export type FaultMode = 'http' | 'abort' | 'sdk';

export type TrackingSdkPlatform = 'ga4' | 'monitor' | 'statsig';

export interface FaultRule {
  id: string;
  url: string | RegExp;
  method?: string;
  mode?: FaultMode;
  status?: number;
  code?: string;
  message?: string;
  times?: number;
}

export interface FaultHit {
  id: string;
  method: string;
  url: string;
  status?: number;
  mode: FaultMode;
  matchedAt: string;
}

/** Injects business/resource failures while leaving analytics transports untouched. */
export class TrackingFaultInjector {
  private readonly hits: FaultHit[] = [];
  private readonly handlers = new Map<FaultRule, (route: Route) => Promise<void>>();

  constructor(private readonly page: Page) {}

  async http(rule: Omit<FaultRule, 'mode'>): Promise<void> {
    await this.install({ ...rule, mode: 'http' });
  }

  async abort(rule: Omit<FaultRule, 'mode'>): Promise<void> {
    await this.install({ ...rule, mode: 'abort' });
  }

  /**
   * Fails one analytics SDK at runtime. The wrapper is installed before the
   * next navigation and is deliberately isolated to the selected platform.
   * This verifies that another SDK and the business click path still run.
   */
  async sdk(options: {
    id: string;
    platform: TrackingSdkPlatform;
    mode?: 'throw' | 'reject';
    message?: string;
  }): Promise<void> {
    const callbackName = '__trackingRecordSdkFault';
    await this.page.exposeFunction(callbackName, (id: string, platform: TrackingSdkPlatform) => {
      this.hits.push({
        id,
        method: 'SDK',
        url: `sdk://${platform}`,
        mode: 'sdk',
        matchedAt: new Date().toISOString()
      });
    }).catch(() => undefined);
    await this.page.addInitScript(({ id, platform, mode, message, callbackName }) => {
      type Target = {
        gtag?: (...args: unknown[]) => unknown;
        Monitor?: { track?: (...args: unknown[]) => unknown };
        statsigClient?: { logEvent?: (...args: unknown[]) => unknown };
        [key: string]: unknown;
      };
      const target = window as unknown as Target;
      const fail = () => {
        const recordFault = target[callbackName] as ((faultId: string, sdk: TrackingSdkPlatform) => void) | undefined;
        recordFault?.(id, platform);
        if (mode === 'reject') return Promise.reject(new Error(message));
        throw new Error(message);
      };
      const install = () => {
        let owner: Record<string, unknown> | undefined;
        let method: string | undefined;
        if (platform === 'ga4') {
          owner = target as unknown as Record<string, unknown>;
          method = 'gtag';
        } else if (platform === 'monitor') {
          owner = target.Monitor as unknown as Record<string, unknown> | undefined;
          method = 'track';
        } else {
          owner = target.statsigClient as unknown as Record<string, unknown> | undefined;
          method = 'logEvent';
        }
        const original = owner?.[method ?? ''];
        if (!owner || !method || typeof original !== 'function' || Reflect.get(original, '__trackingSdkFaultWrapped')) {
          return;
        }
        const wrapped = function () {
          return fail();
        };
        Reflect.set(wrapped, '__trackingSdkFaultWrapped', true);
        owner[method] = wrapped;
      };
      install();
      window.setInterval(install, 25);
    }, { ...options, callbackName });
  }

  async install(rule: FaultRule): Promise<void> {
    const handler = async (route: Route): Promise<void> => {
      const request = route.request();
      if (rule.method && request.method() !== rule.method.toUpperCase()) {
        await route.continue();
        return;
      }

      const mode = rule.mode ?? 'http';
      this.hits.push({
        id: rule.id,
        method: request.method(),
        url: request.url(),
        status: mode === 'http' ? (rule.status ?? 500) : undefined,
        mode,
        matchedAt: new Date().toISOString()
      });

      if (mode === 'abort') {
        await route.abort('failed');
        return;
      }

      await route.fulfill({
        status: rule.status ?? 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          code: rule.code ?? 'MOCK_FAILURE',
          errorCode: rule.code ?? 'MOCK_FAILURE',
          message: rule.message ?? 'Injected tracking test failure'
        })
      });
    };
    this.handlers.set(rule, handler);
    await this.page.route(rule.url, handler, rule.times ? { times: rule.times } : undefined);
  }

  get evidence(): readonly FaultHit[] {
    return this.hits.map((hit) => ({ ...hit }));
  }

  async expectHit(id: string, count = 1): Promise<void> {
    await expect.poll(
      () => this.hits.filter((hit) => hit.id === id).length,
      { timeout: 30_000, message: `Mock 接口 ${id} 未命中` }
    ).toBe(count);
  }

  async dispose(): Promise<void> {
    for (const [rule, handler] of this.handlers) {
      await this.page.unroute(rule.url, handler);
    }
    this.handlers.clear();
  }
}

export function previewOnly(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  const hostname = new URL(baseUrl).hostname;
  return hostname.endsWith('.shopifypreview.com') || hostname === 'localhost' || hostname === '127.0.0.1';
}
