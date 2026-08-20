import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const inputPath = resolve(process.argv[2] ?? 'test-results/tracking-catalog-audit.json');
const outputPath = resolve(process.argv[3] ?? 'test-results/tracking-catalog-report.xml');
const report = JSON.parse(readFileSync(inputPath, 'utf8'));

if (report.total !== 119 || report.passed + report.failed + report.skipped !== report.total) {
  throw new Error(`Invalid tracking result totals: ${report.passed} + ${report.failed} + ${report.skipped} != ${report.total}`);
}

const rows = report.results.map((result) => `
  <tr>
    <td vertical-align="top">${escapeXml(result.kind === 'business' ? '业务' : '异常')}</td>
    <td vertical-align="top"><code>${escapeXml(result.name)}</code></td>
    <td vertical-align="top">${escapeXml(result.params)}</td>
    <td vertical-align="top">${escapeXml(result.platforms)}</td>
    <td vertical-align="top">${escapeXml(result.action)}</td>
    <td vertical-align="top">${escapeXml(result.statusLabel)}</td>
    <td vertical-align="top">${escapeXml(result.observed.map((item) => `${item.platform}: ${item.receipt}`).join('；') || '不适用')}</td>
    <td vertical-align="top">${escapeXml(result.reason)}</td>
  </tr>`).join('');

const faultRows = (report.steps ?? [])
  .filter((step) => Array.isArray(step.faultEvidence) && step.faultEvidence.length > 0)
  .flatMap((step) => step.faultEvidence.map((fault) => `
  <tr>
    <td vertical-align="top"><code>${escapeXml(step.id)}</code></td>
    <td vertical-align="top"><code>${escapeXml(fault.id)}</code></td>
    <td vertical-align="top">${escapeXml(fault.method)} ${escapeXml(fault.url)}</td>
    <td vertical-align="top">${escapeXml(fault.mode)}</td>
    <td vertical-align="top">${escapeXml(fault.status ?? '网络中止')}</td>
  </tr>`)).join('');

const generatedAt = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
}).format(new Date(report.generatedAt));

const xml = `<h1>最终执行结果（119 条完整目录）</h1>
<p><b>测试地址：</b><a href="${escapeXml(report.targetUrl)}">${escapeXml(report.targetUrl)}</a></p>
<p><b>执行时间：</b>${escapeXml(generatedAt)}（Asia/Shanghai）</p>
<p><b>结果口径：</b>“是否通过”只验证前端埋点：点击/曝光后事件出现、各平台浏览器请求已发起、仅上报 1 次、必填参数完整且无敏感字段。HTTP 回执仅记录在“平台接收”，不作为前端埋点失败条件；GA4 Beacon 的服务端回执通常无法由浏览器观察。生产环境不制造故障、不删除生产历史资产。</p>
<table>
  <thead><tr><th>总数</th><th>通过</th><th>失败</th><th>跳过</th></tr></thead>
  <tbody><tr><td>${report.total}</td><td>✅ ${report.passed}</td><td>❌ ${report.failed}</td><td>${report.skipped}</td></tr></tbody>
</table>
<h2>逐条结果</h2>
<table>
  <thead>
    <tr>
      <th vertical-align="top">埋点类型</th>
      <th vertical-align="top">标识</th>
      <th vertical-align="top">参数</th>
      <th vertical-align="top">上报平台</th>
      <th vertical-align="top">动作</th>
      <th vertical-align="top">是否通过</th>
      <th vertical-align="top">平台接收</th>
      <th vertical-align="top">原因</th>
    </tr>
  </thead>
  <tbody>${rows}
  </tbody>
</table>`;

const faultSection = faultRows
  ? `<h2>故障注入证据</h2>
<table><thead><tr><th>场景</th><th>规则</th><th>命中请求</th><th>方式</th><th>注入状态</th></tr></thead><tbody>${faultRows}</tbody></table>`
  : '';

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${xml}${faultSection}\n`, 'utf8');
console.log(JSON.stringify({ inputPath, outputPath, ...pickCounts(report) }));

function pickCounts(value) {
  return {
    total: value.total,
    passed: value.passed,
    failed: value.failed,
    skipped: value.skipped
  };
}

function escapeXml(value) {
  return cleanText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function cleanText(value) {
  return String(value)
    .replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}
