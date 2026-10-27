import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { finalSummary, finalExitCode, mergeRecheckResult, recheckArgs, recheckableCases, recheckMessage } from './failure-recheck.mjs';

test('all failed cases in the requested scope are eligible, including generation and experiments', () => {
  const cases = [{ title: 'TC-00: 首页', status: 'failed' }, { title: 'TC-01: Create', status: 'failed' },
    { title: 'TC-03: 生成', status: 'failed' }, { title: 'TC-05: History', status: 'failed' }];
  for (const mode of ['daily', 'safe', 'all', 'experiment', 'homepage-clickable']) assert.deepEqual(recheckableCases(mode, cases), cases);
  assert.deepEqual(recheckableCases('daily', [{title:'TC-02: pass',status:'passed'},{title:'TC-06: skip',status:'skipped'}]), []);
  assert.match(recheckArgs('daily', cases.slice(0, 1)).at(-1), /TC-00/);
});

test('a safe failure that passes the second run is marked flaky, not silently passed', () => {
  const summary = { caseResults: [{ title: 'TC-01: Create', status: 'failed' }] };
  const merged = mergeRecheckResult(summary, { caseResults: [{ title: 'TC-01: Create', status: 'passed' }] }, summary.caseResults);
  assert.deepEqual(merged.recheck.flaky, ['TC-01: Create']);
  assert.match(recheckMessage(merged), /偶发/);
});

test('a safe failure that remains failing stays a failure', () => {
  const summary = { caseResults: [{ title: 'TC-00: 首页', status: 'failed' }] };
  const merged = mergeRecheckResult(summary, { caseResults: [{ title: 'TC-00: 首页', status: 'failed' }] }, summary.caseResults);
  assert.equal(merged.recheck.cases[0].finalStatus, 'failed-on-recheck');
  assert.match(recheckMessage(merged), /仍失败/);
});

test('mixed outcomes report recovered, persistent and inconclusive cases', () => {
  const cases = ['TC-00: 首页', 'TC-01: Create', 'TC-02: 切换'].map(title => ({ title, status: 'failed' }));
  const summary = { caseResults: cases };
  const merged = mergeRecheckResult(summary, { caseResults: [
    { title: cases[0].title, status: 'passed' }, { title: cases[1].title, status: 'failed' }
  ] }, cases);
  assert.deepEqual(merged.caseResults, cases);
  assert.match(recheckMessage(merged), /复核通过/);
  assert.match(recheckMessage(merged), /复核仍失败/);
  assert.match(recheckMessage(merged), /证据不足/);
});

test('missing, skipped, duplicate or globally broken reports cannot confirm recovery', () => {
  const cases = [{ title: 'TC-01: Create', status: 'failed' }];
  for (const report of [
    { readError: 'missing report' }, { caseResults: [{ ...cases[0], status: 'skipped' }] },
    { caseResults: [{ ...cases[0], status: 'passed' }], reportErrors: ['teardown failed'] },
    { caseResults: [{ ...cases[0], status: 'passed' }, { ...cases[0], status: 'failed' }] }
  ]) {
    assert.equal(mergeRecheckResult({}, report, cases).recheck.cases[0].finalStatus, 'inconclusive');
  }
});

test('selection escapes regex characters and prevents empty or prefix matches', () => {
  assert.throws(() => recheckArgs('safe', []));
  const pattern = new RegExp(recheckArgs('safe', [{ title: 'TC-01: Create (a+b)' }]).at(-1));
  assert.ok(pattern.test('suite TC-01: Create (a+b)'));
  assert.ok(!pattern.test('suite TC-01: Create (a+b) extra'));
});

test('runner previews are read-only and second attempt isolates reports with zero retries', () => {
  const source = readFileSync(new URL('./run-and-notify.mjs', import.meta.url), 'utf8');
  const preview = source.slice(source.indexOf("if (process.argv.includes('--execution-record-preview')"), source.indexOf('// Recheck after dependency'));
  assert.doesNotMatch(preview, /await run\(/);
  assert.match(source, /async function loadSummary\(file = resultsFile\)/);
  assert.match(source, /return readSummary\(file\)/);
  assert.match(source, /'--retries=0',[\s\n]*'--output'/);
  assert.match(source, /failure-recheck-artifacts/);
  assert.match(source, /PLAYWRIGHT_HTML_OUTPUT_DIR/);
});

test('persisted review is visible in real card and document previews without running tests', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'failure-recheck-preview-'));
  try {
    const title = 'TC-01: Create';
    const report = { stats: { expected: 0, unexpected: 1, flaky: 0, skipped: 0, duration: 1000 },
      suites: [{ specs: [{ title, ok: false, tests: [{ status: 'unexpected',
        results: [{ status: 'failed', error: { message: 'fixture failure' }, attachments: [] }] }] }] }],
      recheck: { enabled: true, cases: [{ title, initialStatus: 'failed', finalStatus: 'passed-on-recheck' }] } };
    const file = path.join(dir, 'results.json');
    await writeFile(file, JSON.stringify(report));
    for (const flag of ['--notification-card-preview', '--execution-record-preview']) {
      const output = execFileSync(process.execPath, ['automation/run-and-notify.mjs', flag], {
        encoding: 'utf8', timeout: 15_000, env: { ...process.env, PLAYWRIGHT_RESULTS_FILE: file,
          SCHEDULED_TEST_MODE: 'daily', GITHUB_EVENT_NAME: 'workflow_dispatch', DISPATCH_DEDUPE_KEY: '' }
      });
      if (flag === '--notification-card-preview') {
        assert.match(output, /复核通过/);
        assert.match(output, /保留首次失败/);
        assert.doesNotMatch(output, /failureDetail/);
      } else assert.match(output, /没有失败，不会创建执行文档/);
      assert.doesNotMatch(output, /Running \d+ tests|\[recheck\]/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('recovered case suppresses failure alert but keeps first evidence, persistent failure uses second evidence', () => {
  const cases = ['TC-03: generate', 'TC-05: delete'].map(title => ({ title, status: 'failed' }));
  const first = { caseResults: cases, failures: cases.map(c=>c.title), stats: { unexpected: 2 },
    failureDetails: cases.map(c=>({title:c.title,reason:'first timeout',analysis:'first analysis'})),
    failureArtifacts: cases.map(c=>({title:c.title,video:'first.webm'})) };
  let merged = mergeRecheckResult(first, {caseResults:[{...cases[0],status:'passed'}]}, [cases[0]]);
  merged = mergeRecheckResult(merged, {caseResults:[cases[1]],
    failureDetails:[{title:cases[1].title,reason:'second timeout',analysis:'second analysis'}],
    failureArtifacts:[{title:cases[1].title,video:'second.webm'}]}, [cases[1]]);
  const final = finalSummary(merged);
  assert.equal(final.caseResults[0].recovered,true);
  assert.equal(final.failureDetails.length,1);
  assert.match(final.failureDetails[0].reason,/first timeout.*second timeout/);
  assert.equal(final.failureArtifacts[0].video,'second.webm');
  assert.equal(final.stats.expected,1);
  assert.equal(finalExitCode(final,1),1);
  assert.equal(first.caseResults[0].status,'failed');
  const recovered = finalSummary(mergeRecheckResult(first,{caseResults:cases.map(c=>({...c,status:'passed'}))},cases));
  assert.equal(finalExitCode(recovered,1),0);
  assert.equal(recovered.failureArtifacts.length,0);
  assert.equal(recovered.recheck.cases[0].firstFailure.reason,'first timeout');
});

test('infrastructure, empty or unconfirmed results never turn green', () => {
  assert.equal(finalExitCode({caseResults:[]},0),1);
  assert.equal(finalExitCode({caseResults:[{status:'passed'}]},1),1);
  assert.equal(finalExitCode({caseResults:[{status:'passed'}],reportErrors:[{}]},0),1);
  const first={caseResults:[{title:'TC-03: gen',status:'failed'}]};
  assert.equal(finalExitCode(finalSummary(mergeRecheckResult(first,{readError:'missing'},first.caseResults)),1),1);
});

test('second attempt is scoped to the same file, not a similarly named case elsewhere', () => {
  const args=recheckArgs('all',[{file:'tests/generation.spec.ts',title:'TC-05: delete'}]);
  assert.equal(args[0],'tests/generation.spec.ts');
  assert.equal(args[1],'--grep');
});
