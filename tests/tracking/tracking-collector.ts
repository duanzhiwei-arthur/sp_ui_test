import { expect, Page, Request } from '@playwright/test';

export type TrackingPlatform = 'ga4' | 'statsig' | 'monitor';

export interface TrackingEvent {
  name: string;
  params: Record<string, unknown>;
  platform: TrackingPlatform;
  url: string;
  /** A matching browser transport request was observed. This is the frontend reporting boundary. */
  transportStarted?: boolean;
  responseStatus?: number;
  requestFailure?: string;
  capturedAt: number;
}

export interface UnifiedTrackCall {
  name: string;
  params: Record<string, unknown>;
  options: Record<string, unknown>;
  capturedAt: number;
}

export interface EventExpectation {
  name: string;
  platform: TrackingPlatform;
  requiredParams?: Record<string, RegExp | string | number | boolean>;
  forbiddenParams?: string[];
  /** Only business parameters are checked; GA4 transport/context fields are ignored. */
  allowedParamKeys?: string[];
  eventTimeoutMs?: number;
  deliveryTimeoutMs?: number;
  /** Platform receipt is an auxiliary integration check, not a frontend tracking requirement. */
  requireReceipt?: boolean;
}

export interface PlatformRouteExpectation {
  name: string;
  allowedPlatforms: readonly TrackingPlatform[];
  eventTimeoutMs?: number;
  stableWindowMs?: number;
}

const stableWindowMs = 2_000;
const defaultEventTimeoutMs = Number(process.env.TRACKING_EVENT_TIMEOUT_MS ?? 30_000);
const defaultDeliveryTimeoutMs = Number(process.env.TRACKING_DELIVERY_TIMEOUT_MS ?? 15_000);
const sensitiveKey = /(?:access_?)?token|authorization|cookie|password|secret/i;

/** Captures SDK event content and whether the browser actually starts a matching transport request. */
export class TrackingCollector {
  private readonly events: TrackingEvent[] = [];
  private readonly trackCalls: UnifiedTrackCall[] = [];
  private readonly requestEvents = new WeakMap<Request, TrackingEvent[]>();
  private readonly requestPlatforms = new WeakMap<Request, TrackingPlatform>();
  private readonly lastDelivery = new Map<TrackingPlatform, {
    completedAt: number;
    responseStatus?: number;
    requestFailure?: string;
  }>();

  private constructor(private readonly page: Page) {
    page.on('request', (request) => this.capture(request));
    page.on('requestfinished', (request) => void this.markFinished(request));
    page.on('requestfailed', (request) => this.markFailed(request));
  }

  static async create(page: Page): Promise<TrackingCollector> {
    const collector = new TrackingCollector(page);
    await page.exposeFunction(
      '__trackingCaptureSdkEvent',
      (
        platform: Exclude<TrackingPlatform, 'ga4'>,
        name: string,
        params: unknown,
        capturedAt: number
      ) => {
        collector.captureSdkEvent(platform, name, params, capturedAt);
      }
    );
    await page.exposeFunction(
      '__trackingCaptureUnifiedTrackCall',
      (name: string, params: unknown, options: unknown, capturedAt: number) => {
        collector.captureUnifiedTrackCall(name, params, options, capturedAt);
      }
    );
    await page.addInitScript(() => {
      type InstrumentedWindow = Window & {
        track?: (...args: unknown[]) => unknown;
        Monitor?: { track?: (...args: unknown[]) => unknown };
        statsigClient?: { logEvent?: (...args: unknown[]) => unknown };
        __trackingCaptureSdkEvent?: (
          platform: 'monitor' | 'statsig',
          name: string,
          params: unknown,
          capturedAt: number
        ) => Promise<void>;
        __trackingSdkCallDepth?: Partial<Record<'monitor' | 'statsig', number>>;
        __trackingTrackWrapped?: boolean;
        __trackingCaptureUnifiedTrackCall?: (
          name: string,
          params: unknown,
          options: unknown,
          capturedAt: number
        ) => Promise<void>;
      };
      const target = window as InstrumentedWindow;
      const wrap = (
        owner: { [key: string]: unknown } | undefined,
        method: 'track' | 'logEvent',
        platform: 'monitor' | 'statsig'
      ) => {
        const original = owner?.[method];
        if (typeof original !== 'function' || Reflect.get(original, '__trackingWrapped')) {
          return;
        }
        const wrapped = function (this: unknown, ...args: unknown[]) {
          const name = args[0];
          const params = platform === 'statsig' ? args[2] : args[1];
          const depths = target.__trackingSdkCallDepth ??= {};
          const depth = depths[platform] ?? 0;
          if (depth === 0 && typeof name === 'string') {
            void target.__trackingCaptureSdkEvent?.(platform, name, params ?? {}, Date.now());
          }
          depths[platform] = depth + 1;
          try {
            return Reflect.apply(original, this, args);
          } finally {
            depths[platform] = depth;
          }
        };
        Reflect.set(wrapped, '__trackingWrapped', true);
        owner![method] = wrapped;
      };

      const install = () => {
        const originalTrack = target.track;
        if (typeof originalTrack === 'function' && !Reflect.get(originalTrack, '__trackingWrapped')) {
          const wrappedTrack = function (this: unknown, ...args: unknown[]) {
            const name = args[0];
            if (typeof name === 'string') {
              void target.__trackingCaptureUnifiedTrackCall?.(
                name,
                args[1] ?? {},
                args[2] ?? {},
                Date.now()
              );
            }
            return Reflect.apply(originalTrack, this, args);
          };
          Reflect.set(wrappedTrack, '__trackingWrapped', true);
          try {
            target.track = wrappedTrack;
          } catch {
            // A non-writable global is still observable through SDK/network capture.
          }
        }
        wrap(target.Monitor as { [key: string]: unknown } | undefined, 'track', 'monitor');
        wrap(target.statsigClient as { [key: string]: unknown } | undefined, 'logEvent', 'statsig');
      };
      install();
      window.setInterval(install, 10);
    });
    return collector;
  }

  clear(): void {
    this.events.length = 0;
    this.trackCalls.length = 0;
  }

  find(expectation: Pick<EventExpectation, 'name' | 'platform'>): TrackingEvent[] {
    return this.events.filter((event) =>
      event.platform === expectation.platform && event.name === expectation.name
    );
  }

  snapshot(): readonly TrackingEvent[] {
    return this.events.map((event) => ({ ...event, params: { ...event.params } }));
  }

  snapshotTrackCalls(): readonly UnifiedTrackCall[] {
    return this.trackCalls.map((call) => ({
      ...call,
      params: { ...call.params },
      options: { ...call.options }
    }));
  }

  async unifiedContract(): Promise<{
    track: boolean;
    setGa4TrackingContext: boolean;
    setMonitorTrackingContext: boolean;
    setStatsigTrackingContext: boolean;
  }> {
    return this.page.evaluate(() => {
      const target = window as Window & {
        track?: unknown;
        setGa4TrackingContext?: unknown;
        setMonitorTrackingContext?: unknown;
        setStatsigTrackingContext?: unknown;
      };
      return {
        track: typeof target.track === 'function',
        setGa4TrackingContext: typeof target.setGa4TrackingContext === 'function',
        setMonitorTrackingContext: typeof target.setMonitorTrackingContext === 'function',
        setStatsigTrackingContext: typeof target.setStatsigTrackingContext === 'function'
      };
    });
  }

  async expectUnifiedContract(options: { requireContexts?: boolean } = {}): Promise<void> {
    await expect.poll(
      () => this.unifiedContract(),
      { timeout: defaultEventTimeoutMs, message: '页面未初始化统一 window.track 埋点入口' }
    ).toMatchObject({ track: true });
    const contract = await this.unifiedContract();
    if (options.requireContexts) {
      expect(contract, '三平台公共上下文函数未完整暴露').toMatchObject({
        setGa4TrackingContext: true,
        setMonitorTrackingContext: true,
        setStatsigTrackingContext: true
      });
    }
  }

  async expectOnlyOnPlatforms(expectation: PlatformRouteExpectation): Promise<TrackingEvent[]> {
    const timeout = expectation.eventTimeoutMs ?? defaultEventTimeoutMs;
    await expect.poll(
      () => this.events.some((event) => event.name === expectation.name),
      { timeout, message: `未观察到 ${expectation.name}，无法验证平台路由` }
    ).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, expectation.stableWindowMs ?? stableWindowMs));
    const observed = this.events.filter((event) => event.name === expectation.name);
    const disallowed = observed.filter((event) => !expectation.allowedPlatforms.includes(event.platform));
    expect(disallowed, `${expectation.name} 误上报平台：${disallowed.map((event) => event.platform).join(', ')}`)
      .toEqual([]);
    for (const platform of expectation.allowedPlatforms) {
      const matches = observed.filter((event) => event.platform === platform);
      expect(matches.length, `${expectation.name} 未上报到 ${platform}`).toBe(1);
    }
    return observed;
  }

  async expectNoEvent(name: string, platform: TrackingPlatform, waitMs = stableWindowMs): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    expect(this.find({ name, platform }), `${platform} 不应收到 ${name}`).toEqual([]);
  }

  async flushAndWait(waitMs = 3_000): Promise<void> {
    await this.page.evaluate(async () => {
      const target = window as Window & {
        Monitor?: { flush?: () => unknown };
        statsigClient?: { flush?: () => unknown };
      };
      await Promise.allSettled([
        Promise.resolve(target.Monitor?.flush?.()),
        Promise.resolve(target.statsigClient?.flush?.())
      ]);
    }).catch(() => undefined);
    await this.page.waitForTimeout(waitMs);
  }

  async waitForObserved(
    expectation: Pick<EventExpectation, 'name' | 'platform'>,
    timeoutMs = Number(process.env.TRACKING_EVENT_TIMEOUT_MS ?? 30_000)
  ): Promise<TrackingEvent | undefined> {
    await expect.poll(
      () => this.find(expectation).length,
      { timeout: timeoutMs, message: `${expectation.platform} 未在 ${timeoutMs}ms 内观察到 ${expectation.name}` }
    ).toBeGreaterThan(0);
    return this.find(expectation)[0];
  }

  /** A concise inventory is useful in a failed Playwright trace and report. */
  observed(): string {
    const counts = new Map<string, number>();
    for (const event of this.events) {
      const key = `${event.platform}:${event.name}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => `${name} x${count}`).join(', ') || '无可识别埋点请求';
  }

  async expectExactlyOnce(expectation: EventExpectation): Promise<TrackingEvent> {
    const eventTimeout = expectation.eventTimeoutMs ?? defaultEventTimeoutMs;
    await expect.poll(
      () => {
        const count = this.find(expectation).length;
        if (count > 1) {
          throw new Error(`${expectation.platform} 重复上报 ${expectation.name}：${count} 次`);
        }
        return count;
      },
      {
        timeout: eventTimeout,
        message: `${expectation.platform} 未在 ${eventTimeout}ms 内上报 ${expectation.name}；已采集：${this.observed()}`
      }
    ).toBe(1);

    const event = this.find(expectation)[0];
    this.expectParams(event, expectation);
    this.expectNoSensitiveData(event.params);
    // SDK callbacks and batched transports are asynchronous. Give the browser
    // request a short window to start before treating a local SDK call as a
    // transport failure.
    await expect.poll(
      () => Boolean(this.find(expectation)[0]?.transportStarted),
      {
        timeout: expectation.deliveryTimeoutMs ?? defaultDeliveryTimeoutMs,
        message: `${event.platform} 未发起浏览器上报请求：${event.name}`
      }
    ).toBe(true);
    if (expectation.requireReceipt) {
      await this.expectDelivery(event, expectation.deliveryTimeoutMs ?? defaultDeliveryTimeoutMs);
    }

    // Let delayed SDK batches arrive before accepting the one-time assertion.
    await new Promise((resolve) => setTimeout(resolve, stableWindowMs));
    expect(
      this.find(expectation).length,
      `${expectation.platform} 不应重复上报 ${expectation.name}`
    ).toBe(1);
    return event;
  }

  async expectAllExactlyOnce(
    expectations: readonly EventExpectation[],
    options: { soft?: boolean } = {}
  ): Promise<TrackingEvent[]> {
    const results = await Promise.allSettled(
      expectations.map((expectation) => this.expectExactlyOnce(expectation))
    );
    const failures = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [`${expectations[index].platform}:${expectations[index].name} - ${formatReason(result.reason)}`]
        : []
    );
    const assertion = options.soft ? expect.soft : expect;
    assertion(failures, `埋点联合断言失败；已采集：${this.observed()}`).toEqual([]);
    return results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  }

  private capture(request: Request): void {
    const platform = identifyPlatform(request.url());
    if (!platform) {
      return;
    }

    this.requestPlatforms.set(request, platform);
    if (platform !== 'ga4') {
      const pending = this.pending(platform);
      for (const event of pending) {
        event.transportStarted = true;
      }
      this.requestEvents.set(request, pending);
      return;
    }

    const captured = parseEvents(platform, request);
    if (captured.length === 0) {
      return;
    }
    for (const event of captured) {
      event.transportStarted = true;
    }
    this.events.push(...captured);
    this.requestEvents.set(request, captured);
  }

  private async markFinished(request: Request): Promise<void> {
    const platform = this.requestPlatforms.get(request);
    const events = this.requestEvents.get(request) ?? (platform ? this.pending(platform) : []);
    if (events.length === 0) {
      return;
    }
    const response = await request.response().catch(() => null);
    if (!response) {
      return;
    }
    for (const event of events) {
      event.responseStatus = response.status();
    }
    if (platform) {
      this.lastDelivery.set(platform, { completedAt: Date.now(), responseStatus: response.status() });
    }
  }

  private markFailed(request: Request): void {
    const platform = this.requestPlatforms.get(request);
    const events = this.requestEvents.get(request) ?? (platform ? this.pending(platform) : []);
    for (const event of events) {
      event.requestFailure = request.failure()?.errorText ?? 'unknown request failure';
    }
    if (platform) {
      this.lastDelivery.set(platform, {
        completedAt: Date.now(),
        requestFailure: request.failure()?.errorText ?? 'unknown request failure'
      });
    }
  }

  private captureSdkEvent(
    platform: Exclude<TrackingPlatform, 'ga4'>,
    name: string,
    params: unknown,
    capturedAt: number
  ): void {
    const event: TrackingEvent = {
      name,
      params: params && typeof params === 'object' && !Array.isArray(params)
        ? params as Record<string, unknown>
        : {},
      platform,
      url: `sdk://${platform}`,
      transportStarted: false,
      capturedAt
    };
    const delivery = this.lastDelivery.get(platform);
    if (delivery && delivery.completedAt >= capturedAt) {
      event.responseStatus = delivery.responseStatus;
      event.requestFailure = delivery.requestFailure;
    }
    this.events.push(event);
  }

  private captureUnifiedTrackCall(name: string, params: unknown, options: unknown, capturedAt: number): void {
    this.trackCalls.push({
      name,
      params: params && typeof params === 'object' && !Array.isArray(params)
        ? params as Record<string, unknown>
        : {},
      options: options && typeof options === 'object' && !Array.isArray(options)
        ? options as Record<string, unknown>
        : {},
      capturedAt
    });
  }

  private pending(platform: TrackingPlatform): TrackingEvent[] {
    return this.events.filter((event) =>
      event.platform === platform && event.responseStatus === undefined && event.requestFailure === undefined
    );
  }

  private expectParams(event: TrackingEvent, expectation: EventExpectation): void {
    for (const [key, expected] of Object.entries(expectation.requiredParams ?? {})) {
      const value = event.params[key];
      expect(value, `${event.name} 缺少参数 ${key}`).not.toBeUndefined();
      if (expected instanceof RegExp) {
        expect(String(value), `${event.name}.${key} 不符合预期`).toMatch(expected);
      } else {
        expect(value, `${event.name}.${key} 不符合预期`).toBe(expected);
      }
    }
    for (const key of expectation.forbiddenParams ?? []) {
      expect(event.params[key], `${event.name} 不应携带业务参数 ${key}`).toBeUndefined();
    }
    if (expectation.allowedParamKeys) {
      const allowed = new Set(expectation.allowedParamKeys);
      for (const key of Object.keys(event.params)) {
        expect(allowed.has(key), `${event.name} 出现未定义业务参数 ${key}`).toBe(true);
      }
    }
  }

  private async expectDelivery(event: TrackingEvent, timeout: number): Promise<void> {
    if (event.platform === 'monitor') {
      await this.page.evaluate(() => {
        const target = window as Window & { Monitor?: { flush?: () => unknown } };
        return target.Monitor?.flush?.();
      }).catch(() => undefined);
    } else if (event.platform === 'statsig') {
      await this.page.evaluate(() => {
        const target = window as Window & { statsigClient?: { flush?: () => unknown } };
        return target.statsigClient?.flush?.();
      }).catch(() => undefined);
    }
    await expect.poll(
      () => event.responseStatus ?? event.requestFailure ?? null,
      { timeout, message: `${event.platform} 请求未完成：${event.name}` }
    ).not.toBeNull();
    // GA4 uses sendBeacon. Chromium can emit ERR_ABORTED after accepting the
    // beacon payload, without exposing an HTTP response to Playwright. The
    // assertion remains valid for browser-side reporting; the run report marks
    // this transport as "server receipt not observable" rather than 2xx.
    if (event.platform === 'ga4' && event.requestFailure === 'net::ERR_ABORTED') {
      return;
    }
    expect(event.requestFailure, `${event.platform} 请求失败：${event.name}`).toBeUndefined();
    expect(event.responseStatus, `${event.platform} 接收失败：${event.name}`).toBeGreaterThanOrEqual(200);
    expect(event.responseStatus, `${event.platform} 接收失败：${event.name}`).toBeLessThan(400);
  }

  private expectNoSensitiveData(value: unknown, path = 'params'): void {
    if (Array.isArray(value)) {
      value.forEach((item, index) => this.expectNoSensitiveData(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      expect(sensitiveKey.test(key), `埋点不得携带敏感字段 ${path}.${key}`).toBe(false);
      this.expectNoSensitiveData(nested, `${path}.${key}`);
    }
  }
}

function identifyPlatform(url: string): TrackingPlatform | null {
  const parsed = new URL(url);
  if (
    /(^|\.)(google-analytics|analytics\.google)\.com$/.test(parsed.hostname) &&
    /\/collect$/.test(parsed.pathname)
  ) {
    return 'ga4';
  }

  const statsigPatterns = readPatterns('TRACKING_STATSIG_URL_PATTERNS', [
    'prodregistryv2.org/v1/rgstr',
    '/v1/rgstr'
  ]);
  if (/statsig/i.test(parsed.hostname) || statsigPatterns.some((pattern) => url.includes(pattern))) {
    return 'statsig';
  }

  // Monitor is usually a first-party endpoint, so hostname matching alone is insufficient.
  const monitorPatterns = readPatterns('TRACKING_MONITOR_URL_PATTERNS', ['/api/collect/batch/add']);
  return monitorPatterns.some((pattern) => url.includes(pattern)) ? 'monitor' : null;
}

function formatReason(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function readPatterns(name: string, defaults: string[] = []): string[] {
  const configured = (process.env[name] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set([...configured, ...defaults])];
}

function parseEvents(platform: TrackingPlatform, request: Request): TrackingEvent[] {
  if (platform === 'ga4') {
    return parseGa4Events(request);
  }
  return parseJsonEvents(platform, request);
}

function parseGa4Events(request: Request): TrackingEvent[] {
  const url = new URL(request.url());
  const body = request.postData() ?? '';
  const payloads = [url.searchParams, ...body.split('\n').filter(Boolean).map((line) => new URLSearchParams(line))];
  return payloads.flatMap((params) => {
    const name = params.get('en');
    if (!name) {
      return [];
    }
    const eventParams: Record<string, unknown> = {};
    for (const [key, value] of params.entries()) {
      if (key.startsWith('ep.')) {
        eventParams[key.slice(3)] = value;
      } else if (key.startsWith('epn.')) {
        eventParams[key.slice(4)] = Number(value);
      }
    }
    return [{
      name,
      params: eventParams,
      platform: 'ga4' as const,
      url: request.url(),
      transportStarted: true,
      capturedAt: Date.now()
    }];
  });
}

function parseJsonEvents(platform: Exclude<TrackingPlatform, 'ga4'>, request: Request): TrackingEvent[] {
  const payload = safeJson(request.postData());
  if (!payload) {
    return [];
  }
  return extractNamedEvents(payload).map(({ name, params }) => ({
    name,
    params,
    platform,
    url: request.url(),
    transportStarted: true,
    capturedAt: Date.now()
  }));
}

function safeJson(value: string | null): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Supports Monitor's `{ events: [{ data: { name, ... } }] }` batches,
 * Statsig's `{ eventName, metadata }` records, and common generic JSON forms.
 */
function extractNamedEvents(value: unknown): Array<{ name: string; params: Record<string, unknown> }> {
  if (Array.isArray(value)) {
    return value.flatMap(extractNamedEvents);
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  const name = [record.eventName, record.event_name, record.name].find(
    (candidate): candidate is string => typeof candidate === 'string'
  );
  const nested = Object.values(record).flatMap((item) => extractNamedEvents(item));
  if (!name) {
    return nested;
  }

  const explicitParams = [record.eventParams, record.event_params, record.metadata, record.params, record.data].find(
    (candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === 'object' && !Array.isArray(candidate)
  );
  const metadata = typeof record.metadata === 'string' ? safeJson(record.metadata) : null;
  const params = explicitParams ?? (metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : omitEventNameFields(record));
  return [{ name, params }, ...nested];
}

function omitEventNameFields(record: Record<string, unknown>): Record<string, unknown> {
  const { name: _name, eventName: _eventName, event_name: _eventNameSnake, ...params } = record;
  return params;
}
