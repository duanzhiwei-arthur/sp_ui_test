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
    || /threeDProcessingOverlay|生成图片未完成加载|Generated Toy Result|data-view-name=.[23]d/.test(result?.error?.message ?? '');
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

export async function collectGenerationEvidence(result, root = process.cwd()) {
  if (!isGenerationFailure(result)) return null;
  const startedAt = iso(result?.startTime);
  const endMs = startedAt && Number.isFinite(result.duration) && result.duration >= 0
    ? Date.parse(startedAt) + result.duration : NaN;
  const evidence = { source: '该失败尝试的 Playwright Trace / 生成 SSE', records: [],
    startedAt, endedAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
    timeBasis: '用例开始至失败（未取得生成请求时间）', gap: '' };
  const attachment = result.attachments?.find(item => item.name === 'trace' && item.path);
  if (!attachment) { evidence.gap = '未采集到 Trace，无法获取生成任务标识'; return evidence; }
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
        const sha = response.response.content._sha1;
        if (!/^[a-f0-9]{40}\.[a-z0-9]+$/.test(sha ?? '')) continue;
        const text = await zipText(zip, `resources/${sha}`, 1024 * 1024);
        for (const record of parseGenerationEvents(text)) evidence.records.push({ ...record, startedAt: start });
      }
    }
    if (starts.length) {
      evidence.startedAt = starts.sort()[0];
      evidence.timeBasis = '生成请求开始至该用例失败';
    }
    if (!evidence.records.length) evidence.gap = 'Trace 中未采集到可解析的生成任务事件（请求可能未结束或事件缺失）';
  } catch {
    // Evidence failures must never change a test result or block notifications.
    evidence.gap = 'Trace 不可读、超过读取限额或本机 unzip 不可用；标识未完整采集';
  }
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
    `时间范围：${chinaTime(record.startedAt ?? evidence.startedAt)} ～ ${chinaTime(evidence.endedAt)}（北京时间；${evidence.timeBasis}）`,
  ]), ...(evidence.gap ? [`证据缺口：${evidence.gap}`] : [])].join('\n');
}
