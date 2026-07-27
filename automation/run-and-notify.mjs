import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testResultsDir = path.join(projectRoot, 'test-results');
const resultsFile = path.join(projectRoot, 'test-results', 'results.json');
const reportFile = path.join(projectRoot, 'playwright-report', 'index.html');
const mode = (process.env.SCHEDULED_TEST_MODE ?? 'safe').trim().toLowerCase();
const feishuApiBase = 'https://open.feishu.cn';
const maxImageBytes = 10 * 1024 * 1024;
const maxFileBytes = 30 * 1024 * 1024;

if (!['safe', 'all'].includes(mode)) {
  throw new Error('SCHEDULED_TEST_MODE 仅支持 safe 或 all');
}

if (process.argv.includes('--notification-preview') || process.argv.includes('--notification-test')) {
  const finishedAt = new Date();
  const summary = await loadSummary();
  const durationMs = summary.stats?.duration ?? 0;
  const startedAt = new Date(finishedAt.getTime() - durationMs);
  const testExitCode = (summary.stats?.unexpected ?? 0) > 0 ? 1 : 0;
  const message = buildMessage({ testExitCode, mode, startedAt, finishedAt, summary });

  if (process.argv.includes('--notification-test')) {
    await sendFeishuNotification(message, summary.failureArtifacts);
  } else {
    console.log(message);
  }
} else {
  const startedAt = new Date();
  await rm(resultsFile, { force: true });

  const playwrightBin = path.join(projectRoot, 'node_modules', '.bin', 'playwright');
  const testExitCode = await run(playwrightBin, ['test', '--project=chromium'], {
    ...process.env,
    ALLOW_PRODUCTION_GENERATION: mode === 'all' ? 'true' : 'false'
  });

  const finishedAt = new Date();
  const summary = await loadSummary();
  const message = buildMessage({ testExitCode, mode, startedAt, finishedAt, summary });

  try {
    await sendFeishuNotification(message, summary.failureArtifacts);
  } catch (error) {
    console.error(`[feishu] 结果通知失败：${error instanceof Error ? error.message : String(error)}`);
  }

  process.exitCode = testExitCode;
}

function run(command, args, env) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code) => {
      if (!settled) {
        settled = true;
        resolve(code);
      }
    };
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: 'inherit'
    });
    child.once('error', (error) => {
      console.error(`[playwright] 无法启动：${error.message}`);
      finish(1);
    });
    child.once('exit', (code, signal) => {
      if (signal) {
        console.error(`[playwright] 进程被信号 ${signal} 终止`);
      }
      finish(code ?? 1);
    });
  });
}

async function readSummary(file) {
  const report = JSON.parse(await readFile(file, 'utf8'));
  const failures = [];
  const failureArtifacts = [];

  for (const suite of report.suites ?? []) {
    collectFailures(suite, failures, failureArtifacts);
  }

  return {
    stats: report.stats ?? null,
    failures: [...new Set(failures)],
    failureArtifacts,
    readError: null
  };
}

async function loadSummary() {
  return readSummary(resultsFile).catch((error) => ({
    stats: null,
    failures: [],
    failureArtifacts: [],
    readError: error instanceof Error ? error.message : String(error)
  }));
}

function collectFailures(suite, failures, failureArtifacts) {
  for (const spec of suite.specs ?? []) {
    if (spec.ok === false) {
      failures.push(spec.title);
      const attachments = (spec.tests ?? [])
        .flatMap((test) => test.results ?? [])
        .filter((result) => ['failed', 'timedOut', 'interrupted'].includes(result.status))
        .flatMap((result) => result.attachments ?? []);
      failureArtifacts.push({
        title: spec.title,
        screenshot: findSafeAttachment(attachments, (item) => item.contentType?.startsWith('image/')),
        video: findSafeAttachment(attachments, (item) => item.contentType?.startsWith('video/'))
      });
    }
  }
  for (const child of suite.suites ?? []) {
    collectFailures(child, failures, failureArtifacts);
  }
}

function findSafeAttachment(attachments, predicate) {
  const attachment = [...attachments].reverse().find((item) => item.path && predicate(item));
  if (!attachment) {
    return null;
  }

  const resolved = path.resolve(attachment.path);
  return resolved.startsWith(`${testResultsDir}${path.sep}`) ? resolved : null;
}

function buildMessage({ testExitCode, mode, startedAt, finishedAt, summary }) {
  const passed = testExitCode === 0;
  const stats = summary.stats;
  const modeLabel = mode === 'all' ? '全部 4 条（真实生成）' : '安全用例 TC-01、TC-02';
  const durationMs = stats?.duration ?? finishedAt.getTime() - startedAt.getTime();
  const lines = [
    `[JuJuBit UI] ${passed ? '执行通过' : '执行失败'}`,
    `模式：${modeLabel}`,
    `机器：${hostname()}`,
    `开始：${formatChinaTime(startedAt)}`,
    `耗时：${formatDuration(durationMs)}`
  ];

  if (stats) {
    const expected = stats.expected ?? 0;
    const unexpected = stats.unexpected ?? 0;
    const flaky = stats.flaky ?? 0;
    const skipped = stats.skipped ?? 0;
    const total = expected + unexpected + flaky + skipped;
    lines.push(
      `结果：共 ${total}，通过 ${expected}，失败 ${unexpected}，不稳定 ${flaky}，跳过 ${skipped}`
    );
  } else {
    lines.push(`结果：未能读取 JSON 报告（${summary.readError}）`);
  }

  if (summary.failures.length > 0) {
    lines.push('失败用例：');
    for (const name of summary.failures.slice(0, 8)) {
      lines.push(`- ${name}`);
    }
    if (summary.failures.length > 8) {
      lines.push(`- 另有 ${summary.failures.length - 8} 条失败`);
    }
  }

  lines.push(buildReportReference());
  return lines.join('\n');
}

function buildReportReference() {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const runId = process.env.GITHUB_RUN_ID?.trim();
  if (repository && runId) {
    const server = process.env.GITHUB_SERVER_URL?.trim() || 'https://github.com';
    return `GitHub 运行：${server}/${repository}/actions/runs/${runId}`;
  }
  return `本机报告：${reportFile}`;
}

async function sendFeishuNotification(text, failureArtifacts) {
  const appConfig = readAppConfig();
  if (appConfig) {
    await sendAppNotification(appConfig, text, failureArtifacts);
    return;
  }

  await sendWebhookMessage(text);
}

function readAppConfig() {
  const values = {
    appId: process.env.FEISHU_APP_ID?.trim(),
    appSecret: process.env.FEISHU_APP_SECRET?.trim(),
    receiveIdType: process.env.FEISHU_RECEIVE_ID_TYPE?.trim() || 'open_id',
    receiveId: process.env.FEISHU_RECEIVE_ID?.trim()
  };
  const configured = [values.appId, values.appSecret, values.receiveId].filter(Boolean).length;
  if (configured === 0) {
    return null;
  }
  if (configured !== 3) {
    throw new Error('企业应用机器人配置不完整，需要 FEISHU_APP_ID、FEISHU_APP_SECRET、FEISHU_RECEIVE_ID');
  }
  if (!['open_id', 'email', 'chat_id', 'user_id', 'union_id'].includes(values.receiveIdType)) {
    throw new Error('FEISHU_RECEIVE_ID_TYPE 仅支持 open_id、email、chat_id、user_id、union_id');
  }
  return values;
}

async function sendAppNotification(config, text, failureArtifacts) {
  const token = await getTenantAccessToken(config);
  const preparedArtifacts = [];

  for (const artifact of failureArtifacts) {
    let imageKey = null;
    if (artifact.screenshot) {
      imageKey = await sendArtifactSafely('截图上传', () => uploadImage(token, artifact.screenshot));
    }
    preparedArtifacts.push({ ...artifact, imageKey });
  }

  // Rich post keeps the summary, failure names and screenshots in one message.
  await sendAppMessage(config, token, 'post', buildPostContent(text, preparedArtifacts));

  for (const artifact of preparedArtifacts) {
    if (!artifact.video) {
      continue;
    }
    await sendArtifactSafely('录屏', async () => {
      if (!artifact.imageKey) {
        throw new Error('缺少视频封面，无法发送可播放视频');
      }
      try {
        const mp4Path = await convertVideoToMp4(artifact.video);
        const fileKey = await uploadFile(token, mp4Path, 'mp4');
        await sendAppMessage(config, token, 'media', {
          file_key: fileKey,
          image_key: artifact.imageKey
        });
      } catch (error) {
        console.warn(`[feishu] 无法生成可播放 MP4，降级发送 WebM 文件：${error instanceof Error ? error.message : String(error)}`);
        const fileKey = await uploadFile(token, artifact.video);
        await sendAppMessage(config, token, 'file', { file_key: fileKey });
      }
    });
  }
  console.log('[feishu] 企业应用机器人测试结果已发送。');
}

async function sendArtifactSafely(label, action) {
  try {
    return await action();
  } catch (error) {
    console.warn(`[feishu] ${label}发送失败：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function buildPostContent(text, failureArtifacts) {
  const [title, ...lines] = text.split('\n');
  const content = lines.map(buildPostLine);

  for (const artifact of failureArtifacts) {
    if (!artifact.imageKey) {
      continue;
    }
    content.push([{ tag: 'text', text: `\n失败截图：${artifact.title}\n` }]);
    content.push([{ tag: 'img', image_key: artifact.imageKey }]);
  }

  return {
    zh_cn: {
      title,
      content
    }
  };
}

function buildPostLine(line) {
  const prefix = 'GitHub 运行：';
  if (line.startsWith(prefix)) {
    return [
      { tag: 'text', text: prefix },
      { tag: 'a', text: '查看运行与报告', href: line.slice(prefix.length) }
    ];
  }
  return [{ tag: 'text', text: `${line}\n` }];
}

async function getTenantAccessToken(config) {
  const body = await fetchFeishu('/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret })
  });
  if (!body.tenant_access_token) {
    throw new Error('飞书未返回 tenant_access_token');
  }
  return body.tenant_access_token;
}

async function sendAppMessage(config, token, msgType, content) {
  await fetchFeishu(
    `/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(config.receiveIdType)}`,
    {
      method: 'POST',
      headers: appHeaders(token),
      body: JSON.stringify({
        receive_id: config.receiveId,
        msg_type: msgType,
        content: JSON.stringify(content)
      })
    }
  );
}

async function uploadImage(token, filePath) {
  const file = await readUpload(filePath, maxImageBytes);
  const form = new FormData();
  form.append('image_type', 'message');
  form.append('image', new Blob([file.data]), file.name);
  const body = await fetchFeishu('/open-apis/im/v1/images', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form
  });
  if (!body.data?.image_key) {
    throw new Error('飞书未返回 image_key');
  }
  return body.data.image_key;
}

async function uploadFile(token, filePath, fileType = 'stream') {
  const file = await readUpload(filePath, maxFileBytes);
  const form = new FormData();
  form.append('file_type', fileType);
  form.append('file_name', file.name);
  form.append('file', new Blob([file.data]), file.name);
  const body = await fetchFeishu('/open-apis/im/v1/files', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form
  });
  if (!body.data?.file_key) {
    throw new Error('飞书未返回 file_key');
  }
  return body.data.file_key;
}

async function convertVideoToMp4(videoPath) {
  const outputPath = path.join(path.dirname(videoPath), 'video.mp4');
  const ffmpeg = await resolveFfmpeg();
  await runProcess(ffmpeg, [
    '-y',
    '-i', videoPath,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath
  ]);
  await readUpload(outputPath, maxFileBytes);
  return outputPath;
}

async function resolveFfmpeg() {
  const configured = process.env.FFMPEG_PATH?.trim();
  if (configured) {
    return configured;
  }

  const bundled = await import('ffmpeg-static')
    .then((module) => module.default)
    .catch(() => null);
  return bundled || 'ffmpeg';
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`视频转换失败（exit ${code}）：${stderr.trim()}`));
      }
    });
  });
}

async function readUpload(filePath, maxBytes) {
  const info = await stat(filePath);
  if (!info.isFile() || info.size === 0) {
    throw new Error(`附件为空或不是文件：${path.basename(filePath)}`);
  }
  if (info.size > maxBytes) {
    throw new Error(`附件超过 ${Math.round(maxBytes / 1024 / 1024)} MB：${path.basename(filePath)}`);
  }
  return { name: path.basename(filePath), data: await readFile(filePath) };
}

async function fetchFeishu(apiPath, options) {
  const response = await fetch(`${feishuApiBase}${apiPath}`, {
    ...options,
    signal: AbortSignal.timeout(30_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.code !== 0) {
    throw new Error(`OpenAPI 返回 HTTP ${response.status}，code=${body.code ?? 'unknown'}，msg=${body.msg ?? 'unknown'}`);
  }
  return body;
}

function appHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json; charset=utf-8'
  };
}

async function sendWebhookMessage(text) {
  const webhook = process.env.FEISHU_WEBHOOK_URL?.trim();
  if (!webhook) {
    console.warn('[feishu] 未配置企业应用机器人或 FEISHU_WEBHOOK_URL，本次仅完成测试，不发送消息。');
    return;
  }

  const url = new URL(webhook);
  if (url.protocol !== 'https:') {
    throw new Error('FEISHU_WEBHOOK_URL 必须使用 HTTPS');
  }

  const payload = {
    msg_type: 'text',
    content: { text }
  };
  const secret = process.env.FEISHU_WEBHOOK_SECRET?.trim();
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const stringToSign = `${timestamp}\n${secret}`;
    payload.timestamp = timestamp;
    payload.sign = createHmac('sha256', stringToSign).update('').digest('base64');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || (body.code !== undefined && body.code !== 0)) {
    throw new Error(`Webhook 返回 HTTP ${response.status}，code=${body.code ?? 'unknown'}`);
  }
  console.log('[feishu] 测试结果已发送。');
}

function formatChinaTime(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
}
