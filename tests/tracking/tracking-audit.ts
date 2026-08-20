import type { TrackingCase } from './tracking-case-catalog.js';
import type { TrackingEvent, TrackingPlatform, UnifiedTrackCall } from './tracking-collector.js';

export type TrackingAuditStatus = 'passed' | 'failed' | 'skipped';

export interface TrackingStepEvidence {
  id: string;
  action: string;
  attemptedCaseIds: readonly string[];
  events: readonly TrackingEvent[];
  actionError?: string;
  faultEvidence?: readonly unknown[];
  unifiedTrackCalls?: readonly UnifiedTrackCall[];
}

export interface TrackingAuditResult {
  id: string;
  kind: TrackingCase['kind'];
  name: string;
  params: string;
  platforms: string;
  forbiddenPlatforms?: string;
  action: string;
  status: TrackingAuditStatus;
  statusLabel: string;
  reason: string;
  evidenceStep?: string;
  observed: Array<{
    platform: TrackingPlatform;
    count: number;
    params: Record<string, unknown>;
    receipt: string;
  }>;
}

export interface TrackingAuditReport {
  generatedAt: string;
  targetUrl: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: TrackingAuditResult[];
  steps: Array<{
    id: string;
    action: string;
    attemptedCaseIds: readonly string[];
    actionError?: string;
    observedEvents: string[];
    faultEvidence?: readonly unknown[];
    unifiedTrackCalls?: readonly UnifiedTrackCall[];
  }>;
}

const sensitiveKey = /(?:access_?)?token|authorization|cookie|password|secret/i;

export function buildTrackingAuditReport(options: {
  catalog: readonly TrackingCase[];
  steps: readonly TrackingStepEvidence[];
  targetUrl: string;
  skipReasons?: Readonly<Record<string, string>>;
}): TrackingAuditReport {
  const attempted = new Set(options.steps.flatMap((step) => [...step.attemptedCaseIds]));
  const results = options.catalog.map((trackingCase) => {
    const step = options.steps.find((candidate) => candidate.attemptedCaseIds.includes(trackingCase.id));
    if (!step) {
      return skippedResult(trackingCase, options.skipReasons?.[trackingCase.id] ?? defaultSkipReason(trackingCase));
    }

    const observedTargetEvent = step.events.some((event) =>
      event.name === trackingCase.name && trackingCase.platforms.includes(event.platform)
    );
    if (step.actionError && !observedTargetEvent) {
      return skippedResult(
        trackingCase,
        `跳过：触发动作未成功执行，不能据此判定埋点失败。${summarizeActionError(step.actionError)}`
      );
    }

    const observed = trackingCase.platforms.map((platform) => {
      const matches = step.events.filter((event) => event.name === trackingCase.name && event.platform === platform);
      return {
        platform,
        count: matches.length,
        params: matches[0]?.params ?? {},
        receipt: matches[0] ? receiptDescription(matches[0]) : '未观察到前端请求'
      };
    });
    const failures = evaluateCase(trackingCase, step, observed);
    const status: TrackingAuditStatus = failures.length === 0 ? 'passed' : 'failed';
    return {
      id: trackingCase.id,
      kind: trackingCase.kind,
      name: trackingCase.name,
      params: trackingCase.requiredParams.join(', ') || '无业务参数',
      platforms: trackingCase.platforms.map(platformLabel).join('、'),
      forbiddenPlatforms: trackingCase.forbiddenPlatforms?.map(platformLabel).join('、'),
      action: trackingCase.actionDescription,
      status,
      statusLabel: status === 'passed' ? '✅ 通过' : '❌ 失败',
      reason: status === 'passed'
        ? `${step.actionError ? '控件未稳定可点击，但事件已出现；' : ''}${successReason(trackingCase, observed)}`
        : failures.join('；'),
      evidenceStep: step.id,
      observed
    } satisfies TrackingAuditResult;
  });

  const unknownCaseIds = [...attempted].filter((id) => !options.catalog.some((trackingCase) => trackingCase.id === id));
  if (unknownCaseIds.length > 0) {
    throw new Error(`动作证据引用了未知 case：${unknownCaseIds.join(', ')}`);
  }
  const total = results.length;
  const passed = results.filter((result) => result.status === 'passed').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const skipped = results.filter((result) => result.status === 'skipped').length;
  if (passed + failed + skipped !== total) {
    throw new Error(`结果计数不闭合：${passed} + ${failed} + ${skipped} != ${total}`);
  }

  return {
    generatedAt: new Date().toISOString(),
    targetUrl: options.targetUrl,
    total,
    passed,
    failed,
    skipped,
    results,
    steps: options.steps.map((step) => ({
      id: step.id,
      action: step.action,
      attemptedCaseIds: step.attemptedCaseIds,
      actionError: step.actionError,
      observedEvents: summarizeEvents(step.events),
      faultEvidence: step.faultEvidence,
      unifiedTrackCalls: step.unifiedTrackCalls
    }))
  };
}

function evaluateCase(
  trackingCase: TrackingCase,
  step: TrackingStepEvidence,
  observed: TrackingAuditResult['observed']
): string[] {
  const failures: string[] = [];
  for (const platformResult of observed) {
    if (platformResult.count === 0) {
      failures.push(`${platformLabel(platformResult.platform)} 未上报`);
      continue;
    }
    if (platformResult.count !== 1) {
      failures.push(`${platformLabel(platformResult.platform)} 重复上报 ${platformResult.count} 次`);
    }
    const event = step.events.find((candidate) =>
      candidate.name === trackingCase.name && candidate.platform === platformResult.platform
    );
    if (!event) {
      continue;
    }
    const missing = trackingCase.requiredParams.filter((key) => event.params[key] === undefined);
    if (missing.length > 0) {
      failures.push(`${platformLabel(platformResult.platform)} 缺少参数 ${missing.join(', ')}`);
    }
    const sensitive = findSensitiveKeys(event.params);
    if (sensitive.length > 0) {
      failures.push(`${platformLabel(platformResult.platform)} 包含敏感字段 ${sensitive.join(', ')}`);
    }
    if (!event.transportStarted) {
      failures.push(`${platformLabel(platformResult.platform)} 仅调用 SDK，未观察到浏览器上报请求`);
    }
  }
  for (const platform of trackingCase.forbiddenPlatforms ?? []) {
    const count = step.events.filter((event) => event.name === trackingCase.name && event.platform === platform).length;
    if (count > 0) {
      failures.push(`${platformLabel(platform)} 不应上报 ${trackingCase.name}，实际 ${count} 次`);
    }
  }
  return failures;
}

function skippedResult(trackingCase: TrackingCase, reason: string): TrackingAuditResult {
  return {
    id: trackingCase.id,
    kind: trackingCase.kind,
    name: trackingCase.name,
    params: trackingCase.requiredParams.join(', ') || '无业务参数',
    platforms: trackingCase.platforms.map(platformLabel).join('、'),
    forbiddenPlatforms: trackingCase.forbiddenPlatforms?.map(platformLabel).join('、'),
    action: trackingCase.actionDescription,
    status: 'skipped',
    statusLabel: '跳过',
    reason,
    observed: []
  };
}

function summarizeActionError(error: string): string {
  const firstLine = error
    .replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? `动作错误：${firstLine}` : '';
}

function defaultSkipReason(trackingCase: TrackingCase): string {
  if (trackingCase.kind === 'exception') {
    return '跳过：异常场景需要 Mock/故障注入；生产环境不制造故障。';
  }
  if (/error|failed|timeout|fallback|blocked|rejected|missing/i.test(trackingCase.name)) {
    return '跳过：需要异常、限额或失败前置条件，生产环境未安全触发。';
  }
  if (/delete/i.test(trackingCase.name)) {
    return '跳过：涉及删除资产，未对生产数据执行破坏性操作。';
  }
  if (/refine/i.test(trackingCase.name)) {
    return '跳过：当前页面无 Refine 功能入口。';
  }
  if (/history/i.test(trackingCase.name)) {
    return '跳过：当前匿名会话没有满足该事件的历史记录状态或入口。';
  }
  if (/membership|campaign/i.test(trackingCase.name)) {
    return '跳过：需要会员/活动页面或账号状态，当前测试入口不具备前置条件。';
  }
  return '跳过：当前生产页面没有可稳定到达且可安全执行的对应入口。';
}

function successReason(trackingCase: TrackingCase, observed: TrackingAuditResult['observed']): string {
  const params = trackingCase.requiredParams.length > 0
    ? `必填参数 ${trackingCase.requiredParams.join(', ')} 完整`
    : '无业务参数要求';
  const requests = observed.map((item) => `${platformLabel(item.platform)} 浏览器请求已发起`).join('；');
  return `各平台均上报 1 次，${params}；${requests}`;
}

function receiptDescription(event: TrackingEvent): string {
  if (event.platform === 'ga4' && event.requestFailure === 'net::ERR_ABORTED') {
    return '未确认（Beacon 服务端回执不可观察）';
  }
  if (event.requestFailure) {
    return `未确认（浏览器请求失败：${event.requestFailure}）`;
  }
  if (event.responseStatus === undefined) {
    return '未确认（未观察到 HTTP 回执）';
  }
  return event.responseStatus >= 200 && event.responseStatus < 400
    ? `已确认（HTTP ${event.responseStatus}）`
    : `未确认（HTTP ${event.responseStatus}）`;
}

function findSensitiveKeys(value: unknown, path = 'params'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findSensitiveKeys(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  return Object.entries(value).flatMap(([key, nested]) => [
    ...(sensitiveKey.test(key) ? [`${path}.${key}`] : []),
    ...findSensitiveKeys(nested, `${path}.${key}`)
  ]);
}

function summarizeEvents(events: readonly TrackingEvent[]): string[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = `${platformLabel(event.platform)}:${event.name}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => `${name} x${count}`);
}

function platformLabel(platform: TrackingPlatform): string {
  return platform === 'ga4' ? 'GA4' : platform === 'statsig' ? 'Statsig' : 'Monitor';
}
