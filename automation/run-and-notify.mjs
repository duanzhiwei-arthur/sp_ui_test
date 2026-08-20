import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testResultsDir = path.join(projectRoot, 'test-results');
const resultsFile = path.join(projectRoot, 'test-results', 'results.json');
const reportFile = path.join(projectRoot, 'playwright-report', 'index.html');
const mode = (process.env.SCHEDULED_TEST_MODE ?? 'safe').trim().toLowerCase();
const feishuApiBase = 'https://open.feishu.cn';
const maxImageBytes = 10 * 1024 * 1024;
const maxFileBytes = 30 * 1024 * 1024;
const maxCommandOutputBytes = 2 * 1024 * 1024;
const commandTimeoutMs = 60_000;
const knowledgeFetchConcurrency = 4;

if (!['safe', 'all'].includes(mode)) {
  throw new Error('SCHEDULED_TEST_MODE 仅支持 safe 或 all');
}

if (process.argv.includes('--execution-record-preview') || process.argv.includes('--execution-record-test')) {
  const finishedAt = new Date();
  const summary = await loadSummary();
  const durationMs = summary.stats?.duration ?? 0;
  const startedAt = new Date(finishedAt.getTime() - durationMs);
  const testExitCode = (summary.stats?.unexpected ?? 0) > 0 ? 1 : 0;
  if (process.argv.includes('--execution-record-test')) {
    await createExecutionRecord({ testExitCode, mode, startedAt, finishedAt, summary });
  } else if (testExitCode === 0) {
    console.log('[feishu-doc] 最近一次用例没有失败，不会创建执行文档。');
  } else {
    const title = `UI 自动化失败记录 - ${formatRecordTime(finishedAt)}`;
    console.log(buildExecutionRecord({
      title,
      testExitCode,
      mode,
      startedAt,
      finishedAt,
      summary,
      knowledgeResult: { status: 'preview', matches: [], documentCount: 0 }
    }));
  }
} else if (process.argv.includes('--notification-preview') || process.argv.includes('--notification-test')) {
  const finishedAt = new Date();
  const summary = await loadSummary();
  const durationMs = summary.stats?.duration ?? 0;
  const startedAt = new Date(finishedAt.getTime() - durationMs);
  const testExitCode = summary.readError || (summary.stats?.unexpected ?? 0) > 0 ? 1 : 0;
  const message = buildMessage({ testExitCode, mode, startedAt, finishedAt, summary });

  if (process.argv.includes('--notification-test')) {
    await sendFeishuNotification(message, summary.failureArtifacts);
  } else {
    console.log(message);
  }
} else {
  const shanghaiWeekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short'
  }).format(new Date());

  if (['Sat', 'Sun'].includes(shanghaiWeekday)) {
    console.log(`[scheduler] 今天是${shanghaiWeekday === 'Sat' ? '周六' : '周日'}，跳过 UI 自动化。`);
    process.exit(0);
  }

  const startedAt = new Date();
  await rm(resultsFile, { force: true });

  const playwrightBin = path.join(projectRoot, 'node_modules', '.bin', 'playwright');
  const playwrightArgs = ['test', '--project=chromium'];
  if (process.argv.includes('--headed')) {
    playwrightArgs.push('--headed');
  }
  const testExitCode = await run(playwrightBin, playwrightArgs, {
    ...process.env,
    ALLOW_PRODUCTION_GENERATION: mode === 'all' ? 'true' : 'false',
    SCHEDULED_TRACKING_ENABLED: 'false',
    TRACKING_TEST_ENABLED: 'false',
    TRACKING_FAULT_INJECTION_ENABLED: 'false'
  });

  const finishedAt = new Date();
  let summary = await loadSummary();
  const validateFailureRecord = process.env.FEISHU_FAILURE_RECORD_VALIDATION === 'true';
  if (validateFailureRecord) {
    summary = addFailureRecordValidationCase(summary);
    console.warn('[feishu-doc] 已启用失败记录权限验证：将创建一份明确标注的验证文档。');
  }
  const messageExitCode = testExitCode === 0 && !summary.readError && !validateFailureRecord ? 0 : 1;
  const message = buildMessage({ testExitCode: messageExitCode, mode, startedAt, finishedAt, summary });

  try {
    await sendFeishuNotification(message, summary.failureArtifacts);
  } catch (error) {
    console.error(`[feishu] 结果通知失败：${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    await createExecutionRecord({ testExitCode: messageExitCode, mode, startedAt, finishedAt, summary });
  } catch (error) {
    // A documentation failure must not hide the original Playwright outcome.
    console.error(`[feishu-doc] 执行记录创建失败：${error instanceof Error ? error.message : String(error)}`);
  }

  process.exitCode = messageExitCode;
}

function addFailureRecordValidationCase(summary) {
  const title = '机器人失败报告创建权限验证（手动触发）';
  const alreadyIncluded = (summary.caseResults ?? []).some((item) => item.title === title);
  if (alreadyIncluded) {
    return summary;
  }
  const stats = summary.stats ?? {};
  return {
    ...summary,
    stats: {
      ...stats,
      unexpected: Number(stats.unexpected ?? 0) + 1
    },
    failures: [...(summary.failures ?? []), title],
    failureDetails: [
      ...(summary.failureDetails ?? []),
      {
        title,
        reason: '本条为手动触发的权限验证，不代表 JuJuBit 业务功能异常。',
        analysis: '用于确认 GitHub 托管 Runner 的企业应用机器人可在目标节点下创建并写入失败报告。'
      }
    ],
    caseResults: [...(summary.caseResults ?? []), { title, status: 'failed' }]
  };
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
  const failureDetails = [];
  const caseResults = [];

  for (const suite of report.suites ?? []) {
    collectFailures(suite, failures, failureArtifacts, failureDetails, caseResults);
  }

  return {
    stats: report.stats ?? null,
    failures: [...new Set(failures)],
    failureArtifacts,
    failureDetails,
    caseResults,
    readError: null
  };
}

async function loadSummary() {
  return readSummary(resultsFile).catch((error) => ({
    stats: null,
    failures: [],
    failureArtifacts: [],
    failureDetails: [],
    caseResults: [],
    readError: error instanceof Error ? error.message : String(error)
  }));
}

function collectFailures(suite, failures, failureArtifacts, failureDetails, caseResults) {
  for (const spec of suite.specs ?? []) {
    caseResults.push({ title: spec.title, status: resolveCaseStatus(spec) });
    if (spec.ok === false) {
      failures.push(spec.title);
      const failedResults = (spec.tests ?? [])
        .flatMap((test) => test.results ?? [])
        .filter((result) => ['failed', 'timedOut', 'interrupted'].includes(result.status));
      const attachments = failedResults.flatMap((result) => result.attachments ?? []);
      failureArtifacts.push({
        title: spec.title,
        screenshot: findSafeAttachment(attachments, (item) => item.contentType?.startsWith('image/')),
        video: findSafeAttachment(attachments, (item) => item.contentType?.startsWith('video/'))
      });
      const reason = normalizeFailureReason(failedResults.at(-1)?.error?.message);
      failureDetails.push({
        title: spec.title,
        reason,
        analysis: analyzeFailureReason(spec.title, reason)
      });
    }
  }
  for (const child of suite.suites ?? []) {
    collectFailures(child, failures, failureArtifacts, failureDetails, caseResults);
  }
}

function resolveCaseStatus(spec) {
  const statuses = (spec.tests ?? []).map((test) => test.status).filter(Boolean);
  if (spec.ok === false || statuses.includes('unexpected')) {
    return 'failed';
  }
  if (statuses.includes('flaky')) {
    return 'flaky';
  }
  if (statuses.length > 0 && statuses.every((status) => status === 'skipped')) {
    return 'skipped';
  }
  if (statuses.includes('expected') || spec.ok === true) {
    return 'passed';
  }
  return 'unknown';
}

function normalizeFailureReason(message) {
  if (!message) {
    return 'Playwright 未提供具体错误信息，请查看本机 HTML 报告和 trace。';
  }
  return stripVTControlCharacters(message).replace(/\s+/g, ' ').trim().slice(0, 800);
}

function analyzeFailureReason(title, reason) {
  if (/newsletter-popup[\s\S]*intercepts pointer events|intercepts pointer events[\s\S]*newsletter-popup/i.test(reason)) {
    return '首页营销弹窗延迟出现并覆盖 Create，遮罩持续拦截点击直至超时。属于弹窗处理时序问题，不是 Create 链接不可用。';
  }
  if (/strict mode violation/i.test(reason) && /model-viewer canvas|webgl-canvas|canvas/i.test(reason)) {
    return '3D 内容已经生成，但页面同时渲染了多个 canvas，旧定位器无法唯一确定目标并触发 Playwright 严格模式冲突。属于自动化定位器误报。';
  }
  if (/browserType\.launch|Target page, context or browser has been closed|SIGABRT|kill EPERM/i.test(reason)) {
    return 'Chromium 在用例开始前异常退出，页面步骤没有执行。优先检查本机浏览器启动权限、残留进程和 launchd 运行环境。';
  }
  if (/legal-rate-limited|HTTP 429/i.test(reason)) {
    return '站点拒绝了当前网络出口或触发访问限流，页面业务流程尚未开始。应检查本机出口网络并等待限流窗口恢复。';
  }
  if (/Loading customizer|customizerLoading/i.test(reason) && /Timeout/i.test(reason)) {
    return '自定义器在等待上限内没有完成初始化，Loading 状态未消失或 Generate 未出现。需要结合截图判断资源加载、接口响应或页面改版。';
  }
  if (/Generated Toy Result|生成图片未完成加载|twoDResultImage/i.test(reason)) {
    return '2D 结果图片没有在等待上限内形成可加载的有效资源。需要确认生成任务状态、图片请求响应和 Gallery 中是否已有结果。';
  }
  if (/History 应新增本次生成记录/i.test(reason)) {
    return '2D/3D 流程完成后，History 条目数量没有增加 1。可能是生成记录尚未同步到 Gallery，或 History 列表结构发生变化。';
  }
  if (/删除后本次生成记录应从 History 消失/i.test(reason)) {
    return '删除确认操作完成后，History 条目数量没有恢复到生成前，说明删除请求未生效或列表没有及时刷新。';
  }
  if (/deleteRecordDialog|confirmDeleteRecordButton|delete record/i.test(reason)) {
    return '最新 History 记录已定位，但删除 icon 或确认弹窗没有达到可操作状态。优先检查删除弹窗的角色和确认按钮名称是否改版。';
  }
  if (/threeDProcessingOverlay|3D 预览画布|横向拖动后 3D|model-viewer/i.test(reason)) {
    return '3D 阶段没有满足可交互条件：可能仍在生成、模型区域不可拖动，或拖动前后画面没有变化。需要结合录屏确认实际模型状态。';
  }
  if (/strict mode violation/i.test(reason)) {
    return '页面中出现了多个符合条件的元素，定位器不再唯一，Playwright 严格模式主动终止了操作。应收窄定位范围，而不是延长超时。';
  }
  if (/intercepts pointer events/i.test(reason)) {
    return '目标元素本身可见，但被其他页面层遮挡，点击事件无法到达目标。需要先关闭遮挡层并确认其完全消失。';
  }
  if (/TimeoutError.*locator\.click|locator\.click.*Timeout/i.test(reason)) {
    return '目标点击在等待上限内未完成，常见原因是元素被遮挡、状态不稳定或定位器已经失效。需要优先查看失败截图和 trace。';
  }
  if (/toBeVisible|element\(s\) not found|waiting for locator/i.test(reason)) {
    return '预期页面元素在等待上限内未达到可见状态，可能是页面状态未进入目标阶段或定位器与当前 DOM 不一致。';
  }

  const summary = reason.replace(/\s+/g, ' ').trim().slice(0, 260);
  return `自动化在“${title}”执行失败，现有证据不足以可靠归类。原始错误摘要：${summary}`;
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
  const modeLabel = mode === 'all' ? '全部 5 条（真实生成）' : '安全用例 TC-01、TC-02';
  const durationMs = stats?.duration ?? finishedAt.getTime() - startedAt.getTime();
  const headline = summary.readError
    ? '❌ 结果报告缺失'
    : passed
      ? '✅ 执行通过'
      : '❌ 执行失败';
  const lines = [
    `[JuJuBit UI] ${headline}`,
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

  if (summary.caseResults.length > 0) {
    lines.push('全部用例：');
    for (const item of summary.caseResults) {
      lines.push(`- [${formatCaseStatus(item.status)}] ${item.title}`);
      if (item.status === 'failed') {
        const detail = summary.failureDetails.find((failure) => failure.title === item.title);
        lines.push(`  失败原因：${formatFailureReasonForMessage(detail?.analysis)}`);
      }
    }
  }

  lines.push(buildReportReference());
  return lines.join('\n');
}

function formatFailureReasonForMessage(reason) {
  if (!reason) {
    return '当前证据不足以生成自动分析，请查看失败截图、录屏和 HTML 报告。';
  }
  return reason.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function formatCaseStatus(status) {
  return {
    passed: '✅ 通过',
    failed: '❌ 失败',
    flaky: '❌ 不稳定',
    skipped: '❌ 跳过',
    unknown: '❌ 未知'
  }[status] ?? '❌ 未知';
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

async function createExecutionRecord({ testExitCode, mode, startedAt, finishedAt, summary }) {
  if (testExitCode === 0) {
    console.log('[feishu-doc] 用例全部通过，不创建执行文档。');
    return;
  }

  const parentToken = parseWikiNodeToken(process.env.FEISHU_EXECUTION_RECORDS_PARENT?.trim());
  if (!parentToken) {
    console.warn('[feishu-doc] 未配置 FEISHU_EXECUTION_RECORDS_PARENT，本次不创建执行记录。');
    return;
  }

  const knowledgeResult = await loadKnowledgeSuggestions(summary).catch((error) => ({
    status: 'error',
    matches: [],
    documentCount: 0,
    error: error instanceof Error ? error.message : String(error)
  }));
  const title = `UI 自动化失败记录 - ${formatRecordTime(finishedAt)}`;
  const content = buildExecutionRecord({
    title,
    testExitCode,
    mode,
    startedAt,
    finishedAt,
    summary,
    knowledgeResult
  });

  // GitHub-hosted runners do not have a persisted lark-cli user login. Create
  // the Docx through the application bot instead, so scheduled failures are
  // still written into the configured Wiki folder.
  if (process.env.GITHUB_ACTIONS === 'true') {
    const appConfig = readAppConfig();
    if (!appConfig) {
      throw new Error('远端创建失败记录需要 FEISHU_APP_ID 和 FEISHU_APP_SECRET。');
    }
    const documentUrl = await createExecutionRecordWithBot({
      parentToken,
      title,
      testExitCode,
      mode,
      startedAt,
      finishedAt,
      summary,
      token: await getTenantAccessToken(appConfig)
    });
    console.log(`[feishu-doc] 远端失败记录已创建：${documentUrl}`);
    return;
  }

  const result = await runCommand(resolveLarkCli(), [
    'docs',
    '+create',
    '--as',
    'user',
    '--parent-token',
    parentToken,
    '--content',
    content,
    '--format',
    'json'
  ]);
  const response = parseCommandJson(result.stdout);
  if (!response.ok || !response.data?.document?.url) {
    throw new Error(`飞书未返回新建执行记录的文档链接：${formatCommandOutput(result.stdout)}`);
  }
  console.log(`[feishu-doc] 执行记录已创建：${response.data.document.url}`);
}

async function createExecutionRecordWithBot({ parentToken, title, testExitCode, mode, startedAt, finishedAt, summary, token }) {
  const parent = await fetchFeishu(
    `/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(parentToken)}`,
    { headers: appHeaders(token) }
  );
  const parentNode = parent.data?.node;
  if (!parentNode?.space_id || !parentNode?.node_token) {
    throw new Error('无法读取 FEISHU_EXECUTION_RECORDS_PARENT 对应的 Wiki 节点。');
  }

  const created = await fetchFeishu(`/open-apis/wiki/v2/spaces/${encodeURIComponent(parentNode.space_id)}/nodes`, {
    method: 'POST',
    headers: appHeaders(token),
    body: JSON.stringify({
      obj_type: 'docx',
      node_type: 'origin',
      parent_node_token: parentNode.node_token,
      title
    })
  });
  const documentId = created.data?.node?.obj_token;
  if (!documentId) {
    throw new Error('飞书未返回新建失败记录的 Docx token。');
  }

  const blocks = buildRemoteExecutionRecordBlocks({ testExitCode, mode, startedAt, finishedAt, summary });
  await fetchFeishu(
    `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children`,
    {
      method: 'POST',
      headers: appHeaders(token),
      body: JSON.stringify({ children: blocks })
    }
  );

  return `https://a9ihi0un9c.feishu.cn/docx/${documentId}`;
}

function buildRemoteExecutionRecordBlocks({ testExitCode, mode, startedAt, finishedAt, summary }) {
  const stats = summary.stats;
  const expected = stats?.expected ?? 0;
  const failed = stats?.unexpected ?? 0;
  const flaky = stats?.flaky ?? 0;
  const skipped = stats?.skipped ?? 0;
  const total = expected + failed + flaky + skipped;
  const duration = formatDuration(finishedAt.getTime() - startedAt.getTime());
  const modeLabel = mode === 'all' ? '全部 5 条（真实生成）' : '安全用例 TC-01、TC-02';
  const status = testExitCode === 0 ? '执行通过' : '发现业务失败';
  const reportUrl = buildGitHubRunUrl();
  const artifactUrl = buildGitHubArtifactUrl();
  const blocks = [
    headingBlock('JuJuBit 自动化测试 · 发现业务失败', 1),
    textBlock(`状态：${status}    总用例：${total}`),
    headingBlock('执行概览', 2),
    textBlock(`执行通过率：${total === 0 ? '0.0' : ((expected / total) * 100).toFixed(1)}%（${expected}/${total}）`),
    textBlock(`业务失败：${failed + flaky}    跳过：${skipped}    耗时：${duration}`),
    headingBlock('运行信息', 2),
    textBlock(`分支：${process.env.GITHUB_REF_NAME ?? 'main'}    执行人：${process.env.GITHUB_ACTOR ?? 'GitHub Actions'}`),
    textBlock(`提交：${(process.env.GITHUB_SHA ?? 'unknown').slice(0, 12)}    开始时间：${formatChinaTime(startedAt)}`),
    textBlock(`运行标识：${process.env.GITHUB_RUN_ID ?? 'unknown'}    执行范围：${modeLabel}`),
    headingBlock('模块结果', 2)
  ];

  for (const item of summary.caseResults ?? []) {
    const detail = summary.failureDetails?.find((failure) => failure.title === item.title);
    const description = item.status === 'failed'
      ? `失败｜${item.title}｜${formatFailureReasonForMessage(detail?.analysis ?? detail?.reason)}`
      : `${formatCaseStatus(item.status)}｜${item.title}`;
    blocks.push(textBlock(description));
  }

  blocks.push(headingBlock('失败原因与建议', 2));
  for (const detail of summary.failureDetails ?? []) {
    blocks.push(textBlock(`失败用例：${detail.title}`));
    blocks.push(textBlock(`自动分析：${detail.analysis || '当前证据不足，请查看报告。'}`));
    blocks.push(textBlock(`原始错误：${detail.reason || '无'}`));
  }
  for (const suggestion of buildFixSuggestions(summary, testExitCode)) {
    blocks.push(textBlock(`建议：${suggestion}`));
  }

  blocks.push(headingBlock('运行与报告', 2));
  blocks.push(linkBlock('查看 GitHub Actions 运行与报告', reportUrl));
  blocks.push(linkBlock('下载 HTML 报告、Trace 与录屏附件', artifactUrl));
  return blocks.slice(0, 50);
}

function headingBlock(content, level) {
  const key = `heading${level}`;
  return {
    block_type: level === 1 ? 3 : 4,
    [key]: { elements: [textRun(content)] }
  };
}

function textBlock(content) {
  return { block_type: 2, text: { elements: [textRun(content)] } };
}

function linkBlock(content, url) {
  return {
    block_type: 2,
    text: { elements: [textRun(content, { link: { url: encodeURIComponent(url) } })] }
  };
}

function textRun(content, style = {}) {
  return { text_run: { content, text_element_style: style } };
}

function buildGitHubRunUrl() {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const runId = process.env.GITHUB_RUN_ID?.trim();
  const server = process.env.GITHUB_SERVER_URL?.trim() || 'https://github.com';
  return repository && runId ? `${server}/${repository}/actions/runs/${runId}` : reportFile;
}

function buildGitHubArtifactUrl() {
  const runUrl = buildGitHubRunUrl();
  return runUrl.startsWith('http') ? `${runUrl}/artifacts` : testResultsDir;
}

async function loadKnowledgeSuggestions(summary) {
  const rootValue = process.env.FEISHU_SOLUTION_LIBRARY_ROOT?.trim();
  if (!rootValue) {
    return { status: 'not-configured', matches: [], documentCount: 0 };
  }

  const cli = resolveLarkCli();
  const rootResponse = parseCommandJson((await runCommand(cli, [
    'wiki',
    '+node-get',
    '--node-token',
    rootValue,
    '--as',
    'user',
    '--format',
    'json'
  ])).stdout);
  const rootNode = rootResponse.data?.node ?? rootResponse.data;
  if (!rootResponse.ok || !rootNode?.space_id || !rootNode?.node_token) {
    throw new Error('无法解析故障知识库根节点。');
  }

  const nodes = await listKnowledgeNodes(cli, rootNode.space_id, rootNode.node_token);
  const documents = await fetchKnowledgeDocuments(cli, nodes);
  return {
    status: 'ok',
    matches: matchKnowledgeDocuments(summary, documents),
    documentCount: documents.length
  };
}

async function listKnowledgeNodes(cli, spaceId, rootNodeToken) {
  const queue = [rootNodeToken];
  const visitedParents = new Set();
  const seenNodes = new Set();
  const documents = [];

  while (queue.length > 0) {
    const parentNodeToken = queue.shift();
    if (!parentNodeToken || visitedParents.has(parentNodeToken)) {
      continue;
    }
    visitedParents.add(parentNodeToken);

    const response = parseCommandJson((await runCommand(cli, [
      'wiki',
      '+node-list',
      '--space-id',
      String(spaceId),
      '--parent-node-token',
      parentNodeToken,
      '--page-all',
      '--page-limit',
      '0',
      '--as',
      'user',
      '--format',
      'json'
    ])).stdout);
    if (!response.ok) {
      throw new Error(`无法读取知识库子节点：${parentNodeToken}`);
    }

    for (const node of response.data?.nodes ?? []) {
      if (!node.node_token || seenNodes.has(node.node_token)) {
        continue;
      }
      seenNodes.add(node.node_token);
      if (['doc', 'docx'].includes(node.obj_type) && node.obj_token) {
        documents.push(node);
      }
      if (node.has_child) {
        queue.push(node.node_token);
      }
    }
  }
  return documents;
}

async function fetchKnowledgeDocuments(cli, nodes) {
  const documents = [];
  for (let index = 0; index < nodes.length; index += knowledgeFetchConcurrency) {
    const batch = nodes.slice(index, index + knowledgeFetchConcurrency);
    const results = await Promise.all(batch.map(async (node) => {
      try {
        const response = parseCommandJson((await runCommand(cli, [
          'docs',
          '+fetch',
          '--doc',
          node.obj_token,
          '--doc-format',
          'markdown',
          '--detail',
          'simple',
          '--as',
          'user',
          '--format',
          'json'
        ])).stdout);
        const content = response.data?.document?.content;
        return response.ok && typeof content === 'string' ? { ...node, content } : null;
      } catch (error) {
        console.warn(`[feishu-doc] 知识文档读取失败（${node.title ?? node.obj_token}）：${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    }));
    documents.push(...results.filter(Boolean));
  }
  return documents;
}

function matchKnowledgeDocuments(summary, documents) {
  const failureText = (summary.failureDetails ?? [])
    .map((item) => `${item.title} ${item.analysis ?? ''} ${item.reason}`)
    .join(' ');
  const terms = extractSearchTerms(failureText);

  return documents
    .map((document) => {
      const title = document.title ?? '';
      const searchable = `${title} ${document.content}`.toLowerCase();
      const matchedTerms = terms.filter((term) => searchable.includes(term.toLowerCase()));
      const titleHits = matchedTerms.filter((term) => title.toLowerCase().includes(term.toLowerCase())).length;
      return {
        ...document,
        score: matchedTerms.length + titleHits * 3,
        matchedTerms,
        excerpt: buildKnowledgeExcerpt(document.content, matchedTerms)
      };
    })
    .filter((document) => document.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

function extractSearchTerms(text) {
  const domainTerms = [
    '429', 'rate limit', 'legal-rate-limited', 'timeout', 'locator', 'strict mode',
    'popup', 'create', 'loading customizer', 'generate', '2d', '3d', 'canvas',
    'model-viewer', 'add to cart', 'checkout', 'history', 'delete record', 'prompt',
    'browser', 'network'
  ].filter((term) => text.toLowerCase().includes(term));
  const tokens = text.match(/[a-z][a-z0-9_-]{2,}|\b\d{3,}\b|[\u4e00-\u9fff]{2,8}/gi) ?? [];
  const ignored = new Set([
    'error', 'expected', 'received', 'failed', 'waiting', 'element', 'visible',
    'playwright', 'locator', '用例', '失败', '执行', '页面', '元素', '等待', '查看'
  ]);
  return [...new Set([...domainTerms, ...tokens.map((item) => item.toLowerCase())])]
    .filter((term) => !ignored.has(term) && term.length >= 2)
    .slice(0, 40);
}

function buildKnowledgeExcerpt(content, matchedTerms) {
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`\[\]()~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const lower = plain.toLowerCase();
  const positions = matchedTerms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((position) => position >= 0);
  const start = positions.length > 0 ? Math.max(0, Math.min(...positions) - 120) : 0;
  const excerpt = plain.slice(start, start + 700);
  return `${start > 0 ? '...' : ''}${excerpt}${start + 700 < plain.length ? '...' : ''}`;
}

function resolveLarkCli() {
  const configured = process.env.LARK_CLI_PATH?.trim();
  if (configured) {
    return configured;
  }

  for (const candidate of ['/opt/homebrew/bin/lark-cli', '/usr/local/bin/lark-cli']) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return 'lark-cli';
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    child.stdout?.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.once('error', (error) => {
      finish(new Error(`无法启动 ${path.basename(command)}：${error.message}`));
    });
    child.once('exit', (code, signal) => {
      if (code === 0) {
        finish(null, { stdout, stderr });
        return;
      }
      const detail = formatCommandOutput(stderr || stdout);
      const status = signal ? `signal ${signal}` : `exit ${code ?? 'unknown'}`;
      finish(new Error(`${path.basename(command)} 执行失败（${status}）：${detail || '无错误输出'}`));
    });

    timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error(`${path.basename(command)} 执行超过 ${commandTimeoutMs / 1000} 秒，已终止。`));
    }, commandTimeoutMs);
  });
}

function appendBounded(current, chunk) {
  return `${current}${chunk}`.slice(-maxCommandOutputBytes);
}

function parseCommandJson(output) {
  try {
    return JSON.parse(output.trim());
  } catch (error) {
    throw new Error(`无法解析 lark-cli 返回结果：${formatCommandOutput(output) || 'stdout 为空'}`);
  }
}

function formatCommandOutput(output) {
  return String(output).replace(/\s+/g, ' ').trim().slice(0, 800);
}

function parseWikiNodeToken(value) {
  if (!value) {
    return null;
  }
  const matched = value.match(/\/wiki\/([^/?#]+)/i);
  return matched?.[1] ?? value;
}

function buildExecutionRecord({ title, testExitCode, mode, startedAt, finishedAt, summary, knowledgeResult }) {
  const passed = testExitCode === 0;
  const stats = summary.stats;
  const details = summary.failureDetails ?? [];
  const failureRows = details.length > 0
    ? details.map((item) => `<tr><td>${escapeXml(item.title)}</td><td>${escapeXml(item.analysis)}</td><td>${escapeXml(item.reason)}</td></tr>`).join('')
    : passed
      ? '<tr><td colspan="3">无失败用例</td></tr>'
      : `<tr><td>测试执行或报告生成</td><td>当前证据不足以生成自动分析。</td><td>${escapeXml(summary.readError ?? '测试进程返回失败，但 JSON 报告中没有失败详情，请查看本机日志和 HTML 报告。')}</td></tr>`;
  const recommendations = buildFixSuggestions(summary, testExitCode);
  const recommendationItems = recommendations.map((item) => `<li>${escapeXml(item)}</li>`).join('');
  const knowledgeSection = buildKnowledgeSection(knowledgeResult);
  const modeLabel = mode === 'all' ? '全部 5 条（真实生成）' : '安全用例 TC-01、TC-02';
  const resultLabel = passed ? '成功' : '失败';
  const resultColor = passed ? 'green' : 'red';
  const total = stats
    ? (stats.expected ?? 0) + (stats.unexpected ?? 0) + (stats.flaky ?? 0) + (stats.skipped ?? 0)
    : 0;
  const statistics = stats
    ? `共 ${total} 条，通过 ${stats.expected ?? 0}，失败 ${stats.unexpected ?? 0}，不稳定 ${stats.flaky ?? 0}，跳过 ${stats.skipped ?? 0}`
    : `未能读取测试报告：${summary.readError ?? '未知原因'}`;

  return [
    `<title>${escapeXml(title)}</title>`,
    '<h1>UI 自动化失败记录</h1>',
    `<p><b>执行时间：</b>${escapeXml(formatChinaTime(finishedAt))}</p>`,
    `<p><b>执行范围：</b>${escapeXml(modeLabel)}</p>`,
    `<p><b>开始时间：</b>${escapeXml(formatChinaTime(startedAt))}</p>`,
    `<p><b>耗时：</b>${escapeXml(formatDuration(finishedAt.getTime() - startedAt.getTime()))}</p>`,
    `<p><b>执行结果：</b><span text-color="${resultColor}">${resultLabel}</span></p>`,
    `<p><b>测试统计：</b>${escapeXml(statistics)}</p>`,
    '<h2>失败原因</h2>',
    `<table><thead><tr><th background-color="light-gray">用例</th><th background-color="light-gray">自动分析</th><th background-color="light-gray">原始错误</th></tr></thead><tbody>${failureRows}</tbody></table>`,
    '<h2>初步判断与修复建议</h2>',
    `<ul>${recommendationItems}</ul>`,
    knowledgeSection,
    '<h2>本机证据</h2>',
    `<p><b>HTML 报告：</b>${escapeXml(reportFile)}</p>`,
    `<p><b>失败附件：</b>${escapeXml(testResultsDir)}</p>`
  ].join('');
}

function buildKnowledgeSection(result) {
  if (!result || result.status === 'preview') {
    return '<h2>知识库解决方案</h2><p>预览模式未连接飞书知识库。</p>';
  }
  if (result.status === 'not-configured') {
    return '<h2>知识库解决方案</h2><p>未配置故障知识库节点，本次仅提供框架内置建议。</p>';
  }
  if (result.status === 'error') {
    return `<h2>知识库解决方案</h2><p>知识库查询失败：${escapeXml(result.error)}</p>`;
  }
  if ((result.matches ?? []).length === 0) {
    return `<h2>知识库解决方案</h2><p>已检索 ${result.documentCount ?? 0} 篇文档，未找到与本次错误直接相关的记录。</p>`;
  }

  const matches = result.matches.map((item) => [
    `<p><b>相关文档：</b><cite type="doc" doc-id="${escapeXml(item.obj_token)}"></cite></p>`,
    `<p><b>匹配关键词：</b>${escapeXml(item.matchedTerms.slice(0, 8).join('、'))}</p>`,
    `<blockquote>${escapeXml(item.excerpt || '文档没有可展示的正文摘要。')}</blockquote>`
  ].join('')).join('<hr/>');
  return `<h2>知识库解决方案</h2><p>已检索 ${result.documentCount} 篇文档，以下内容与本次失败最相关。</p>${matches}`;
}

function buildFixSuggestions(summary, testExitCode) {
  if (testExitCode === 0 && (summary.failures ?? []).length === 0) {
    return ['全部用例通过，继续观察下一次定时执行结果。'];
  }

  const reasons = (summary.failureDetails ?? []).map((item) => item.reason).join('\n');
  const suggestions = [];
  if (/legal-rate-limited|HTTP 429/i.test(reasons)) {
    suggestions.push('确认本机网络未被站点限流；不要切换回 GitHub 托管 Runner。');
  }
  if (/browserType\.launch|Target page, context or browser has been closed/i.test(reasons)) {
    suggestions.push('检查 launchd 用户是否可启动 Chromium，并在本机终端执行安全冒烟以复现浏览器启动问题。');
  }
  if (/Timeout|locator|element\(s\) not found/i.test(reasons)) {
    suggestions.push('查看失败截图和 trace，确认页面元素是否改版；优先更新稳定定位器，再调整等待时间。');
  }
  if (/生成|Generate|2D|3D/i.test(reasons)) {
    suggestions.push('检查生成任务是否进入 History，并确认 2D 图片或 3D model-viewer 的视觉状态后再修改断言。');
  }
  if (/History|delete record|deleteRecordDialog|confirmDeleteRecordButton/i.test(reasons)) {
    suggestions.push('检查 Gallery 最新记录排序、删除弹窗可访问名称和删除后的列表刷新状态。');
  }
  if (suggestions.length === 0) {
    suggestions.push('查看 HTML 报告、失败截图和 trace，依据首个失败步骤定位环境或页面变化。');
  }
  return [...new Set(suggestions)];
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function formatRecordTime(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date).replaceAll('/', '-').replaceAll(':', '-').replace(/\s+/g, ' ');
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
