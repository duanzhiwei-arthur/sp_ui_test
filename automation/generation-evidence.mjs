import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
  ? value : Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
const iso = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

function failedStepTitles(steps = []) {
  return steps.flatMap(step => [...(step.error ? [step.title ?? ''] : []), ...failedStepTitles(step.steps)]);
}

export function isGenerationFailure(result) {
  const steps = failedStepTitles(result?.steps);
  return steps.some(title => /生成并验证|等待\s*3D|生成.*(?:2D|3D)|(?:2D|3D).*生成/.test(title))
    || /\[GENERATION_(?:FAILED|TIMEOUT)\]|threeDProcessingOverlay|生成图片未完成加载|Generated Toy Result|data-view-name=.[23]d/.test(result?.error?.message ?? '');
}

export function generationResponseIds(headers = []) {
  const values = name => [...new Set(headers.filter(h => String(h.name).toLowerCase() === name)
    .map(h => safeId(h.value)).filter(Boolean))].slice(0, 10);
  return { traceIds: values('x-trace-id'), requestIds: values('x-request-id') };
}

function safeError(value) {
  return String(value ?? '').replace(/https?:\/\/[^\s"'<>]+/gu, '[URL]')
    .replace(/\b(?:sk-|gh[pousr]_|github_pat_)[\w-]+/gu, '[SECRET]')
    .replace(/(token|password|secret|cookie|authorization|api[_-]?key)["']?\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|(?:Bearer\s+)?[^\s,;]+)/giu, '$1=[REDACTED]')
    .replace(/\bBearer\s+[\w.+/=-]+/giu, 'Bearer [SECRET]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, '[EMAIL]').slice(0, 1000);
}

// Only allowlisted SSE fields are retained. Never persist request headers,
// uploaded images, prompt text, response URLs or arbitrary event payloads.
export function parseGenerationEvents(text) {
  let taskId = null;
  const records = new Map();
  for (const block of text.replaceAll('\r\n', '\n').split(/\n\s*\n/)) {
    const event = block.match(/^event:\s*(\w+)/m)?.[1];
    if (!/^(?:task_start|asset_start|asset_2d_done|asset_3d_start|asset_3d_done|asset_done|task_done|task_error|asset_error)$/.test(event ?? '')) continue;
    const raw = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    let data;
    try { data = JSON.parse(raw); } catch { continue; }
    if (!data || typeof data !== 'object') continue;
    taskId = safeId(data.taskId) ?? taskId;
    const assetId = safeId(data.assetId);
    if (!assetId) continue;
    const key = `${taskId ?? ''}:${assetId}`;
    const record = records.get(key) ?? { taskId, assetId, traceIds: [] };
    const traceId = safeId(data.extra?.traceId);
    if (traceId && !record.traceIds.includes(traceId)) record.traceIds.push(traceId);
    records.set(key, record);
    if (records.size >= 20) break;
  }
  return records.size ? [...records.values()] : taskId ? [{ taskId, assetId: null, traceIds: [] }] : [];
}

async function zipText(zip, entry, maxBuffer) {
  const { stdout } = await exec('unzip', ['-p', zip, entry], { timeout: 20_000, maxBuffer, encoding: 'utf8' });
  return stdout;
}

export function summarizeGenerationStream(text, response) {
  const allowed = /^(?:task_start|asset_start|asset_2d_done|asset_3d_start|asset_3d_done|asset_done|task_done|task_error|asset_error|ping)$/;
  const counts = {};
  const sequence = [];
  const businessErrors = [];
  for (const block of text.replaceAll('\r\n', '\n').split(/\n\s*\n/)) {
    const event = block.match(/^event:\s*(\w+)/m)?.[1];
    if (!allowed.test(event ?? '')) continue;
    counts[event] = (counts[event] ?? 0) + 1;
    if (event !== 'ping' && sequence.length < 40) sequence.push(event);
    const raw = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    try {
      const data = JSON.parse(raw);
      // done means terminal, not necessarily successful. Keep explicit failures,
      // without guessing the meaning of undocumented numeric status codes.
      if (data && (data.errorMessage || (data.errorCode && data.errorCode !== '0') || /^(task|asset)_error$/.test(event)) && businessErrors.length < 20) {
        businessErrors.push({ event, taskId: safeId(data.taskId), assetId: safeId(data.assetId),
          errorCode: safeId(data.errorCode), message: safeError(data.errorMessage ?? data.message ?? '生成事件明确报错') });
      }
    } catch { /* malformed optional event data is not proof of failure */ }
  }
  const startedAt = iso(response.startedDateTime);
  const durationMs = Number.isFinite(response.time) && response.time >= 0 ? response.time : null;
  return { startedAt, recordedEndAt: startedAt && durationMs !== null ? new Date(Date.parse(startedAt) + durationMs).toISOString() : null,
    durationMs, httpStatus: Number.isInteger(response.response?.status) ? response.response.status : null,
    events: sequence, eventCounts: counts, businessErrors,
    threeDCompletionObserved: Boolean(counts.asset_3d_done),
    taskTerminalObserved: Boolean(counts.task_done || counts.task_error),
    caveat: '仅表示该次 Trace 响应中观测到的事件；无完成事件不能单独证明后台失败，HTTP 200 不等于生成成功。' };
}

export async function collectGenerationEvidence(result, root = process.cwd()) {
  if (!isGenerationFailure(result)) return null;
  const startedAt = iso(result?.startTime);
  const endMs = startedAt && Number.isFinite(result.duration) && result.duration >= 0
    ? Date.parse(startedAt) + result.duration : NaN;
  const evidence = { source: '该失败尝试的 Playwright Trace / 生成 SSE', records: [], streams: [],
    startedAt, endedAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
    timeBasis: '用例开始至失败（未取得生成请求时间）', gap: '' };
  // The passive per-attempt collector survives large/unreadable traces. Only
  // correlate an asset with one in-window request; never borrow another run.
  try {
    const audit = result.attachments?.find(item => item.name === 'run-assets' && typeof item.body === 'string' && item.body.length < 350_000);
    if (audit) {
      const data = JSON.parse(Buffer.from(audit.body, 'base64').toString('utf8'));
      const requests = (data.generationRequests ?? []).filter(r => iso(r.at) && startedAt && Date.parse(r.at) >= Date.parse(startedAt) && Date.parse(r.at) <= endMs);
      for (const asset of (data.assets ?? []).slice(0, 20)) {
        const matches = requests.filter(r => safeId(r.traceId) && r.traceId === asset.traceId);
        const request = matches.length === 1 ? matches[0] : requests.length === 1 ? requests[0] : null;
        if (!request || !safeId(asset.assetId)) continue;
        evidence.records.push({ taskId: safeId(asset.taskId), assetId: safeId(asset.assetId),
          traceIds: [...new Set([safeId(asset.traceId), safeId(request.traceId)].filter(Boolean))],
          requestIds: [safeId(request.requestId)].filter(Boolean), startedAt: iso(request.at) });
      }
      if (evidence.records.length) { evidence.source += ' / 本次资产审计'; evidence.timeBasis = '本次生成请求至用例失败'; }
    }
  } catch { /* optional evidence must not change the test outcome */ }
  const attachment = result.attachments?.find(item => item.name === 'trace' && item.path);
  if (!attachment) { evidence.gap = '未采集到 Trace；仅展示本次资产审计中已确认的标识'; return evidence; }
  try {
    const resultsRoot = await realpath(path.join(root, 'test-results'));
    const zip = await realpath(path.resolve(root, attachment.path));
    if (!zip.startsWith(resultsRoot + path.sep) || (await stat(zip)).size > 150 * 1024 * 1024) throw new Error('unsafe trace');
    const { stdout: entries } = await exec('unzip', ['-Z1', zip], { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 });
    const networks = entries.split('\n').filter(name => /^[\w-]+\.network$/.test(name)).slice(0, 5);
    const starts = [];
    let responsesRead = 0;
    for (const entry of networks) {
      const network = await zipText(zip, entry, 24 * 1024 * 1024);
      for (const line of network.split('\n')) {
        if (!line) continue;
        const response = JSON.parse(line).snapshot;
        if (!response?.request?.url) continue;
        const url = new URL(response.request.url);
        if (response.request.method !== 'POST' || url.pathname !== '/apps/ai/activity/tasks'
          || !/text\/event-stream/i.test(response.response?.content?.mimeType ?? '')) continue;
        if (++responsesRead > 10) throw new Error('generation response limit');
        const start = iso(response.startedDateTime);
        if (!start || !startedAt || Date.parse(start) < Date.parse(startedAt) || Date.parse(start) > endMs) continue;
        starts.push(start);
        const ids = generationResponseIds(response.response.headers);
        const sha = response.response.content._sha1;
        if (!/^[a-f0-9]{40}\.[a-z0-9]+$/.test(sha ?? '')) {
          if (ids.traceIds.length || ids.requestIds.length) evidence.records.push({ taskId: null, assetId: null, ...ids, startedAt: start });
          continue;
        }
        const text = await zipText(zip, `resources/${sha}`, 1024 * 1024);
        evidence.streams.push(summarizeGenerationStream(text, response));
        const records = parseGenerationEvents(text);
        for (const record of records) evidence.records.push({ ...record,
          traceIds: [...new Set([...record.traceIds, ...ids.traceIds])], requestIds: ids.requestIds, startedAt: start });
        if (!records.length && (ids.traceIds.length || ids.requestIds.length)) evidence.records.push({ taskId: null, assetId: null, ...ids, startedAt: start });
      }
    }
    if (starts.length) {
      evidence.startedAt = starts.sort()[0];
      evidence.timeBasis = '生成请求开始至该用例失败';
    }
    if (!evidence.records.some(record => record.taskId || record.assetId)) evidence.gap = 'Trace 中未采集到可解析的生成任务事件（请求可能未结束或事件缺失）；已尽可能保留响应头标识';
  } catch {
    // Evidence failures must never change a test result or block notifications.
    evidence.gap = 'Trace 不可读、超过读取限额或本机 unzip 不可用；已尽可能保留本次资产审计标识，流事件可能不完整';
  }
  evidence.records = evidence.records.filter((r, index, all) => all.findIndex(other => other.taskId === r.taskId && other.assetId === r.assetId && other.startedAt === r.startedAt) === index);
  return evidence;
}

function chinaTime(value) {
  return value ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '未采集到';
}

export function formatGenerationEvidence(evidence) {
  if (!evidence) return '';
  const records = evidence.records.length ? evidence.records : [{ taskId: null, assetId: null, traceIds: [] }];
  return ['生成任务排查信息：', ...records.flatMap((record, index) => [
    ...(records.length > 1 ? [`任务/资产 ${index + 1}：`] : []),
    `Task ID：${record.taskId ?? '未采集到'}`,
    `Asset ID：${record.assetId ?? '未采集到'}`,
    `Trace ID：${record.traceIds.join('、') || '未采集到'}`,
    `Request ID：${(record.requestIds ?? []).join('、') || '未采集到'}`,
    `时间范围：${chinaTime(record.startedAt ?? evidence.startedAt)} ～ ${chinaTime(evidence.endedAt)}（北京时间；${evidence.timeBasis}）`,
  ]), ...(evidence.streams ?? []).flatMap(stream => (stream.businessErrors ?? []).map(error =>
    `生成业务错误：${error.errorCode ?? '无错误码'}；${error.message}`)),
  ...(evidence.gap ? [`证据缺口：${evidence.gap}`] : [])].join('\n');
}

// Recovery must not remove the first generation failure from the final message.
// Use only the first attempt's evidence; never borrow IDs from the recheck.
export function firstGenerationFailureMessages(summary) {
  return (summary.recheck?.cases ?? []).flatMap(review => {
    const first = review.firstFailure;
    if (!first?.generationEvidence && !/\[GENERATION_(?:FAILED|TIMEOUT)\]/.test(first?.reason ?? '')) return [];
    const evidence = first.generationEvidence ?? { records: [], streams: [] };
    const errors = (evidence.streams ?? []).flatMap(stream => stream.businessErrors ?? []);
    const details = formatGenerationEvidence({ ...evidence, streams: [] });
    const outcome = review.finalStatus === 'passed-on-recheck' ? '二次复核通过' :
      review.finalStatus === 'failed-on-recheck' ? '二次复核仍失败' : '复核未完成/证据不足';
    return [[`首次生成失败（${outcome}）：${safeError(review.title)}`, details,
      ...(errors.length ? errors.flatMap(error => [
        `错误码：${safeId(error.errorCode) ?? '未采集到'}`,
        `原始原因：${safeError(error.message) || '未采集到'}`
      ]) : ['错误码：未采集到', `原始原因：${safeError(first.reason) || '未采集到'}`])
    ].join('\n')];
  });
}
