import 'dotenv/config';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditPath = path.resolve(process.env.TRACKING_AUDIT_OUTPUT ?? 'test-results/tracking-catalog-audit.json');
const parentToken = parseWikiNodeToken(process.env.FEISHU_TRACKING_RECORDS_PARENT?.trim());
const label = process.env.TRACKING_RECORD_LABEL?.trim() || '埋点自动化';
const feishuApiBase = 'https://open.feishu.cn';
const startedAt = new Date();
const playwrightArgs = ['test', '--config=playwright.tracking.config.ts', ...splitArgs(process.env.TRACKING_PLAYWRIGHT_ARGS)];
const recordExisting = process.argv.includes('--record-existing');
const testExitCode = recordExisting ? 0 : await run('npx', ['playwright', ...playwrightArgs]);
const finishedAt = new Date();

let report;
try {
  report = JSON.parse(await readFile(auditPath, 'utf8'));
} catch (error) {
  report = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    results: [],
    readError: error instanceof Error ? error.message : String(error)
  };
}
if (recordExisting && Number(report.failed ?? 0) > 0) {
  report.replayed = true;
}

try {
  const url = await createTrackingRecord({ label, report, testExitCode, startedAt, finishedAt, parentToken });
  console.log(`[feishu-tracking-doc] 埋点执行记录已创建：${url}`);
} catch (error) {
  console.error(`[feishu-tracking-doc] 埋点执行记录创建失败：${error instanceof Error ? error.message : String(error)}`);
}
process.exitCode = recordExisting ? 0 : testExitCode;

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: projectRoot, env: process.env, stdio: 'inherit' });
    child.once('error', () => resolve(1));
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

async function createTrackingRecord({ label, report, testExitCode, startedAt, finishedAt, parentToken: parent }) {
  if (!parent) throw new Error('未配置 FEISHU_TRACKING_RECORDS_PARENT。');
  const config = readAppConfig();
  const token = await getTenantAccessToken(config);
  const parentNode = await fetchFeishu(`/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(parent)}`, { headers: appHeaders(token) });
  const node = parentNode.data?.node;
  if (!node?.space_id || !node?.node_token) throw new Error('无法读取埋点记录父节点。');

  const title = `${label}执行记录 - ${formatRecordTime(finishedAt)}`;
  const created = await fetchFeishu(`/open-apis/wiki/v2/spaces/${encodeURIComponent(node.space_id)}/nodes`, {
    method: 'POST', headers: appHeaders(token),
    body: JSON.stringify({ obj_type: 'docx', node_type: 'origin', parent_node_token: node.node_token, title })
  });
  const documentId = created.data?.node?.obj_token;
  if (!documentId) throw new Error('飞书未返回埋点执行记录 Docx token。');

  await fetchFeishu(`/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children`, {
    method: 'POST', headers: appHeaders(token),
    body: JSON.stringify({ children: buildBlocks({ label, report, testExitCode, startedAt, finishedAt }) })
  });
  return `https://a9ihi0un9c.feishu.cn/docx/${documentId}`;
}

function buildBlocks({ label, report, testExitCode, startedAt, finishedAt }) {
  const total = Number(report.total ?? 0);
  const passed = Number(report.passed ?? 0);
  const failed = Number(report.failed ?? 0);
  const skipped = Number(report.skipped ?? 0);
  const status = testExitCode === 0 && failed === 0 && !report.readError ? '执行通过' : '发现埋点异常';
  const failedRows = (report.results ?? []).filter((item) => item.status === 'failed').slice(0, 15);
  const blocks = [
    headingBlock(`JuJuBit ${label} · ${status}`, 1),
    textBlock(`状态：${status}${report.replayed ? '（补写记录）' : ''}    总目录：${total}`),
    headingBlock('执行概览', 2),
    textBlock(`通过率：${total === 0 ? '0.0' : ((passed / total) * 100).toFixed(1)}%（${passed}/${total}）`),
    textBlock(`失败：${failed}    跳过：${skipped}    耗时：${formatDuration(finishedAt - startedAt)}`),
    headingBlock('运行信息', 2),
    textBlock(`目标地址：${report.targetUrl ?? process.env.TRACKING_BASE_URL ?? '未配置'}`),
    textBlock(`分支：${process.env.GITHUB_REF_NAME ?? '本地'}    执行人：${process.env.GITHUB_ACTOR ?? '本机'}`),
    textBlock(`开始时间：${formatChinaTime(startedAt)}    完成时间：${formatChinaTime(finishedAt)}`),
    headingBlock('失败摘要', 2)
  ];
  if (report.readError) blocks.push(textBlock(`报告读取失败：${report.readError}`));
  if (failedRows.length === 0) blocks.push(textBlock('无失败埋点。'));
  for (const item of failedRows) blocks.push(textBlock(`${item.id ?? '未编号'}｜${item.name ?? '未命名事件'}｜${shorten(item.reason, 420)}`));
  if (failed > failedRows.length) blocks.push(textBlock(`其余 ${failed - failedRows.length} 条失败项请查看本地 JSON 审计报告。`));
  blocks.push(headingBlock('本地报告', 2));
  blocks.push(textBlock(`结构化审计：${path.relative(projectRoot, auditPath)}`));
  blocks.push(textBlock('HTML 报告：playwright-tracking-report/index.html'));
  return blocks.slice(0, 50);
}

function headingBlock(content, level) { const key = `heading${level}`; return { block_type: level === 1 ? 3 : 4, [key]: { elements: [textRun(content)] } }; }
function textBlock(content) { return { block_type: 2, text: { elements: [textRun(content)] } }; }
function textRun(content) { return { text_run: { content: shorten(content, 1500), text_element_style: {} } }; }
function shorten(value, length) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length); }
function parseWikiNodeToken(value) { return value?.match(/\/wiki\/([^/?#]+)/i)?.[1] ?? value; }
function splitArgs(value) { return value?.trim() ? value.trim().split(/\s+/) : []; }
function formatDuration(ms) { const total = Math.max(0, Math.round(Number(ms) / 1000)); const minutes = Math.floor(total / 60); const seconds = total % 60; return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`; }
function formatChinaTime(date) { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date); }
function formatRecordTime(date) { return formatChinaTime(date).replaceAll('/', '-').replaceAll(':', '-').replace(/\s+/g, ' '); }

function readAppConfig() {
  const appId = process.env.FEISHU_APP_ID?.trim(); const appSecret = process.env.FEISHU_APP_SECRET?.trim();
  if (!appId || !appSecret) throw new Error('需要 FEISHU_APP_ID 和 FEISHU_APP_SECRET。');
  return { appId, appSecret };
}
async function getTenantAccessToken(config) {
  const body = await fetchFeishu('/open-apis/auth/v3/tenant_access_token/internal', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }) });
  if (!body.tenant_access_token) throw new Error('飞书未返回 tenant_access_token。'); return body.tenant_access_token;
}
function appHeaders(token) { return { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' }; }
async function fetchFeishu(endpoint, options = {}) {
  const response = await fetch(`${feishuApiBase}${endpoint}`, options); const body = await response.json().catch(() => ({}));
  if (!response.ok || (body.code !== undefined && body.code !== 0)) throw new Error(`OpenAPI 返回 HTTP ${response.status}，code=${body.code ?? 'unknown'}，msg=${body.msg ?? 'unknown'}`);
  return body;
}
