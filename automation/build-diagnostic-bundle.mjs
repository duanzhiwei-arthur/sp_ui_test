import { readFile, mkdir, writeFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { collectGenerationEvidence } from './generation-evidence.mjs';
import { failureCategory } from './failure-category.mjs';

// Text-only evidence for the read-only bot. Videos stay in separate artifacts.
export function redact(text) {
  return String(text ?? '').replace(/\u001b\[[0-9;]*m/gu, '')
    .replace(/\b(?:sk-|gh[pousr]_|github_pat_)[\w-]+/gu, '[SECRET]')
    .replace(/(authorization|cookie|token|secret|password|api[_-]?key)["']?\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|(?:Bearer\s+)?[^\s,;]+)/giu, '$1=[REDACTED]')
    .replace(/\bBearer\s+[\w.+/=-]+/giu, 'Bearer [SECRET]')
    .replace(/https?:\/\/[^\s"'<>]+/gu, '[URL]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, '[EMAIL]')
    .replace(/\b\+?\d[\d ()-]{8,}\d\b/gu, '[NUMBER]');
}

export function collectCases(suites = []) {
  return suites.flatMap(suite => [
    ...(suite.specs ?? []).map(spec => ({
      title: spec.title, file: spec.file ?? suite.file, line: spec.line,
      status: spec.tests?.map(test => test.status).join(',') ?? 'unknown',
      results: spec.tests?.flatMap(test => test.results ?? []) ?? []
    })), ...collectCases(suite.suites)
  ]);
}

export function normalizeTestFile(file, root = process.cwd()) {
  if (typeof file !== 'string') return undefined;
  // Playwright's JSON paths are normally relative to testDir, not repo root.
  const relative = path.isAbsolute(file) ? path.relative(root, file) : file;
  const normalized = relative.replaceAll('\\', '/');
  if (!/^[\w./-]+\.ts$/u.test(normalized) || normalized.split('/').includes('..')) return undefined;
  return normalized.startsWith('tests/') ? normalized : `tests/${normalized}`;
}

// 新附件采用字段允许列表：保留排查标识，不让通用手机号脱敏破坏时间/Request ID。
export function sanitizeSiteAccess(value) {
  if (!value || !['SITE_VERIFICATION','SITE_RATE_LIMITED','SITE_ACCESS_DENIED'].includes(value.code)) return {};
  const result = { code: value.code };
  if (Number.isInteger(value.status) && value.status >= 0 && value.status <= 599) result.status = value.status;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.at ?? '')) result.at = value.at;
  if (/^[a-f0-9]{16}-[A-Z]{3}$/.test(value.cfRay ?? '')) result.cfRay = value.cfRay;
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?:-\d{10})?$/.test(value.requestId ?? '')) result.requestId = value.requestId;
  if (/^\d{1,6}$/.test(value.retryAfter ?? '')) result.retryAfter = value.retryAfter;
  if (['Verification failed.','Browser verification','Challenge page',''].includes(value.signal)) result.signal = value.signal;
  try {
    const url = new URL(value.url);
    if (['https://jujubit.ai','https://www.jujubit.ai'].includes(url.origin)) {
      result.url = url.origin + (/^\/(?:products\/customize-your-own|cart)?\/?$/.test(url.pathname) ? url.pathname : '/[path-redacted]');
    }
  } catch { /* 未知URL不对外携带。 */ }
  return result;
}

export function sanitizeRunAssets(value) {
  const id = v => (typeof v === 'string' || Number.isSafeInteger(v)) && /^[a-zA-Z0-9_-]{1,128}$/.test(String(v)) ? String(v) : undefined;
  const at = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) ? v : undefined;
  const array = v => Array.isArray(v) ? v.slice(0,100) : [];
  return {version:1,attemptId:id(value?.attemptId),taskIds:array(value?.taskIds).map(id).filter(Boolean),
    generationRequests:array(value?.generationRequests).map(r=>({at:at(r.at),status:Number.isInteger(r.status)?r.status:undefined,traceId:id(r.traceId),requestId:id(r.requestId),complete:r.complete===true})),
    assets:array(value?.assets).map(a=>({assetId:id(a.assetId),taskId:id(a.taskId),traceId:id(a.traceId),terminal:a.terminal===true,deleted:a.deleted===true,imageObserved:a.imageObserved===true})),
    unfinishedRequests:Number.isSafeInteger(value?.unfinishedRequests)?value.unfinishedRequests:undefined,
    gaps:array(value?.gaps).map(g=>redact(g).slice(0,300)),
    caveat:'仅当前case/attempt实测；没有终态不代表后台已取消或失败。'};
}
export function sanitizeGaCookie(value) {
  const clean = value && typeof value === 'object' ? value : {};
  const stringValue = v => typeof v === 'string' && v.length <= 512 ? v : null;
  return { version: 1, case: stringValue(clean.case), retry: Number.isSafeInteger(clean.retry) ? clean.retry : null,
    cookieValue: stringValue(clean.cookieValue), cookieClientId: stringValue(clean.cookieClientId) };
}
const attachmentText = (name, text) => name === 'ga-cookie-diagnostics'
  ? JSON.stringify(sanitizeGaCookie(JSON.parse(text))) : name === 'site-access-diagnostics'
  ? JSON.stringify(sanitizeSiteAccess(JSON.parse(text))) : name === 'run-assets'
    ? JSON.stringify(sanitizeRunAssets(JSON.parse(text))) : redact(text).slice(0, 20000);

export async function buildBundle(root = process.cwd(), env = process.env) {
  const resultsRoot = path.join(root, 'test-results');
  const output = path.join(root, 'diagnostic-evidence');
  await mkdir(output, { recursive: true });
  let report;
  try { report = JSON.parse(await readFile(path.join(resultsRoot, 'results.json'), 'utf8')); }
  catch { report = { errors: [{ message: 'Playwright JSON missing or invalid; consult workflow jobs/logs. Test may not have started.' }] }; }
  const cases = [];
  for (const item of collectCases(report.suites).slice(0, 50)) {
    const result = item.results.findLast(r => ['failed', 'timedOut', 'interrupted'].includes(r.status));
    const evidenceResult = result ?? item.results.at(-1);
    let context = '';
    const runtimeDiagnostics = [];
    if (evidenceResult) {
      for (const attachment of (evidenceResult.attachments ?? []).filter(a => (result ? ['runtime-diagnostics', 'navigation-diagnostics', 'site-access-diagnostics', 'run-assets', 'ga-cookie-diagnostics'] : ['run-assets', 'ga-cookie-diagnostics']).includes(a.name)).slice(0, 8)) {
        try {
          // testInfo.attach({ body }) is emitted inline/base64 by the JSON reporter.
          // Support both reporter forms rather than silently dropping that evidence.
          if (typeof attachment.body === 'string') {
            if (attachment.body.length > 350_000) continue;
            const text = Buffer.from(attachment.body, 'base64').toString('utf8');
            if (Buffer.byteLength(text) > 256 * 1024) continue;
            JSON.parse(text);
            runtimeDiagnostics.push({ name: attachment.name, text: attachmentText(attachment.name, text) });
            continue;
          }
          const file = await realpath(path.resolve(root, attachment.path));
          if (!file.startsWith((await realpath(resultsRoot)) + path.sep) || (await stat(file)).size > 256 * 1024) continue;
          runtimeDiagnostics.push({ name: attachment.name, text: attachmentText(attachment.name, await readFile(file, 'utf8')) });
        } catch { runtimeDiagnostics.push({ name: attachment.name, gap: '运行时诊断附件不可读' }); }
      }
      // Derive the sibling error-context from a reported artifact, never accept
      // arbitrary report paths or symlinks escaping the results directory.
      for (const attachment of result?.attachments ?? []) {
        if (!attachment.path) continue;
        const file = path.resolve(root, attachment.path);
        if (!file.startsWith(resultsRoot + path.sep)) continue;
        const candidate = path.join(path.dirname(file), 'error-context.md');
        try {
          if (!(await realpath(candidate)).startsWith((await realpath(resultsRoot)) + path.sep)) continue;
          context = redact(await readFile(candidate, 'utf8')).slice(0, 20000);
          break;
        } catch { /* Not every attachment has context. Explicit empty below. */ }
      }
    }
    cases.push({ title: redact(item.title), file: normalizeTestFile(item.file, root), line: item.line, status: item.status,
      failureCategory: result ? failureCategory(result.error?.message) : undefined,
      error: redact(result?.error?.message ?? result?.errors?.map(e => e.message).join('\n')).slice(0, 8000),
      failedSteps: (result?.steps ?? []).filter(step => step.error).map(step => redact(step.title)),
      generationEvidence: await collectGenerationEvidence(result, root),
      runtimeDiagnostics,
      context, contextAvailable: Boolean(context) });
  }
  const bundle = { version: 1, runId: env.GITHUB_RUN_ID, headSha: env.GITHUB_SHA,
    runAttempt: env.GITHUB_RUN_ATTEMPT, stats: report.stats,
    // Raw cases above remain first-attempt evidence; never claim recovery was
    // a clean first pass. Preserve both attempts for the read-only bot.
    recheck: report.recheck ? { enabled: true, cases: (report.recheck.cases ?? []).slice(0, 50).map(item => ({
      title: redact(item.title), initialStatus: item.initialStatus, finalStatus: item.finalStatus,
      firstReason: redact(item.firstFailure?.reason).slice(0, 4000),
      secondReason: redact(item.secondFailure?.reason ?? item.evidenceGap).slice(0, 4000),
      secondAnalysis: redact(item.secondFailure?.analysis).slice(0, 4000)
    })) } : undefined,
    errors: (report.errors ?? []).map(e => redact(e.message).slice(0, 4000)), cases };
  await writeFile(path.join(output, 'diagnostic.json'), JSON.stringify(bundle, null, 2));
  return bundle;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const bundle = await buildBundle();
  console.log(`[diagnostic] Prepared ${bundle.cases.length} cases; no screenshots/video or credentials included.`);
}
