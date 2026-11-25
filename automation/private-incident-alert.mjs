import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { groupFailureKind } from './group-failure-policy.mjs';
import { redact } from './build-diagnostic-bundle.mjs';

const workflows = new Set(['.github/workflows/ui-regression.yml', '.github/workflows/homepage-clickable.yml']);
const failed = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);
const clean = (value, limit = 1200) => redact(value).slice(0, limit);
const safeId = value => /^[a-zA-Z0-9_-]{1,128}$/.test(String(value ?? '')) ? String(value) : '未采集';

export function trustedRun(run, repository) {
  return run?.repository?.full_name === repository && run?.head_repository?.full_name === repository
    && run?.head_branch === 'main' && workflows.has(run?.path) && run?.status === 'completed';
}

export function incident(run, jobs = [], bundle) {
  // Deliberate cancellation and duplicate-slot skips are not product failures.
  if (run.conclusion === 'cancelled') return null;
  const notificationError = bundle?.notificationError;
  if (!failed.has(run.conclusion) && !notificationError) return null;
  const lines = [
    `运行：${run.id} / 第 ${run.run_attempt ?? 1} 次`,
    `状态：${run.conclusion}；代码：${String(run.head_sha ?? '').slice(0, 12)}`,
    `开始时间：${new Date(run.run_started_at ?? run.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）`,
    '这是独立私聊告警，不受群通知暂停或断言抑制规则影响。',
  ];
  for (const job of jobs.filter(job => failed.has(job.conclusion))) {
    lines.push(`异常任务：${clean(job.name, 150)}`);
    for (const step of (job.steps ?? []).filter(step => failed.has(step.conclusion))) lines.push(`失败步骤：${clean(step.name, 200)}（${step.conclusion}）`);
  }
  if (notificationError) lines.push(`结果通知异常：${clean(notificationError)}`);
  for (const error of (bundle?.errors ?? []).slice(0, 5)) lines.push(`报告异常：${clean(error)}`);
  const reviews = bundle?.recheck?.cases ?? [];
  for (const row of (bundle?.cases ?? []).slice(0, 12)) {
    const review = reviews.find(item => item.title === row.title);
    if (['passed', 'passed-on-recheck'].includes(review?.finalStatus) || (!review && ['expected', 'passed', 'skipped'].includes(row.status))) continue;
    const reason = review?.secondReason || row.error || '失败原因未采集';
    lines.push(`\n用例：${clean(row.title, 200)}`, `分类：${groupFailureKind(reason)}`,
      review ? `复核结果：${clean(review.finalStatus, 50)}` : '复核记录未采集', `原因：${clean(reason)}`);
    if (review?.firstReason && review.firstReason !== reason) lines.push(`首次原因：${clean(review.firstReason, 700)}`);
    // Explicit ID allowlist: do not forward arbitrary URLs, cookies or raw payloads.
    for (const record of (row.generationEvidence?.records ?? []).slice(0, 3)) {
      lines.push('首次生成证据（不冒充复核任务）：', `Task ID：${safeId(record.taskId)}`, `Asset ID：${safeId(record.assetId)}`,
        `Trace ID：${(record.traceIds ?? []).slice(0, 5).map(safeId).join('、') || '未采集'}`,
        `Request ID：${(record.requestIds ?? []).slice(0, 5).map(safeId).join('、') || '未采集'}`);
      const range = [record.startedAt ?? row.generationEvidence?.startedAt, row.generationEvidence?.endedAt]
        .map(value => /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value ?? '') ? value : '未采集');
      lines.push(`生成时间范围（UTC）：${range.join(' ～ ')}`);
    }
  }
  if (!bundle) lines.push('诊断报告未取得：用例可能尚未启动或报告上传失败，请先检查上述失败步骤。不能据此认定产品故障。');
  lines.push('断言失败不等于脚本问题；网络、人机验证与业务失败按实际证据区分，未明确部分需进一步排查。');
  return lines.join('\n').slice(0, 16000);
}

export async function sendPrivateAlert(env, text, key, fetcher = fetch) {
  const recipient = env.FEISHU_PRIVATE_ALERT_OPEN_ID?.trim();
  if (!/^ou_[a-zA-Z0-9]+$/.test(recipient ?? '')) throw new Error('私人告警只允许已核实的 open_id，不允许群 chat_id');
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) throw new Error('私人告警机器人凭据缺失');
  const request = async (url, body, token) => {
    const response = await fetcher(`https://open.feishu.cn${url}`, {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`飞书接口 HTTP ${response.status}`);
    const result = await response.json();
    if (result.code !== 0) throw new Error(`飞书接口错误码 ${result.code}`);
    return result;
  };
  const auth = await request('/open-apis/auth/v3/tenant_access_token/internal', { app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET });
  if (!auth.tenant_access_token) throw new Error('飞书未返回机器人令牌');
  const result = await request('/open-apis/im/v1/messages?receive_id_type=open_id', {
    receive_id: recipient, msg_type: 'post', uuid: createHash('sha256').update(key).digest('hex').slice(0, 32),
    content: JSON.stringify({ zh_cn: { title: 'JuJuBit · 自动化重要异常私报', content: [[{ tag: 'text', text }]] } }),
  }, auth.tenant_access_token);
  if (!result.data?.message_id) throw new Error('飞书未返回消息ID，送达状态未知；不要盲目重发');
  return result.data.message_id;
}

export async function main(env = process.env) {
  const repo = env.GITHUB_REPOSITORY;
  if (repo !== 'duanzhiwei-arthur/sp_ui_test') throw new Error('私人告警仅在原自动化仓库启用');
  if (env.PRIVATE_ALERT_VALIDATION === 'true') {
    const id = await sendPrivateAlert(env, '【配置验证，不是真实失败】重要问题私聊告警已接入：复核后仍失败、群内被抑制的断言失败、工作流准备失败或超时、结果通知发送异常，会独立通知你。正常通过及复核通过不额外私发。定时频率、用例和群通知规则不变。', `${repo}:validation:${env.GITHUB_RUN_ID}`);
    console.log(`[private-alert] 验证消息已发送 ${id}`); return;
  }
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const run = event.workflow_run;
  if (!trustedRun(run, repo)) { console.log('[private-alert] 非受信任主分支回归，跳过'); return; }
  const github = async url => {
    const response = await fetch(`https://api.github.com/repos/${repo}${url}`, {
      headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`GitHub只读查询 HTTP ${response.status}`);
    return response;
  };
  let jobs = [], bundle;
  try {
    jobs = (await (await github(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`)).json()).jobs ?? [];
  } catch { console.warn('[private-alert] 任务步骤查询失败，保留运行终态'); }
  try {
    const artifacts = (await (await github(`/actions/runs/${run.id}/artifacts?per_page=100`)).json()).artifacts ?? [];
    const artifact = artifacts.find(a => a.name === `ui-diagnostics-${run.id}` && !a.expired && a.size_in_bytes <= 4 * 1024 * 1024);
    if (artifact) {
      const zip = Buffer.from(await (await github(`/actions/artifacts/${artifact.id}/zip`)).arrayBuffer());
      // Read one fixed JSON member from stdin; never extract or execute run artifacts.
      const raw = execFileSync('python3', ['-c', 'import sys,io,zipfile\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\ni=z.getinfo("diagnostic.json")\nassert i.file_size <= 2000000\nsys.stdout.buffer.write(z.read(i))'], { input: zip, maxBuffer: 2100000, timeout: 10000 });
      const candidate = JSON.parse(raw);
      if (String(candidate.runId) === String(run.id) && String(candidate.runAttempt) === String(run.run_attempt)) bundle = candidate;
    }
  } catch { console.warn('[private-alert] 诊断报告不可读，按实际可用证据报告'); }
  let text;
  try { text = incident(run, jobs, bundle); }
  catch { text = incident(run, jobs); } // Malformed evidence must not silence run failure.
  if (!text) { console.log('[private-alert] 无需重要异常私报'); return; }
  const url = `https://github.com/${repo}/actions/runs/${run.id}`;
  const id = await sendPrivateAlert(env, `${text}\n\n完整证据：${url}`, `${repo}:${run.id}:${run.run_attempt}:incident`);
  console.log(`[private-alert] 重要异常已私发 ${id}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('[private-alert] 私报发送或查询失败，请检查告警工作流；未更改原用例结果。'); process.exitCode = 1; });
}
