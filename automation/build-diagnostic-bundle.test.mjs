import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildBundle, collectCases, normalizeTestFile, redact, sanitizeSiteAccess, sanitizeRunAssets } from './build-diagnostic-bundle.mjs';

test('资产审计ID不被手机号脱敏破坏，未知URL和凭据不进入摘要',()=>{
 const s=sanitizeRunAssets({attemptId:'attempt-1',assets:[{assetId:'12345678901',taskId:'23456789012',imageUrl:'https://private.invalid/a?token=x'}],cookie:'secret',generationRequests:[{at:'2026-11-06T00:00:00.000Z',status:200,complete:false,requestId:'abc-123'}],unfinishedRequests:1});
 assert.equal(s.assets[0].assetId,'12345678901');assert.equal(s.unfinishedRequests,1);assert.doesNotMatch(JSON.stringify(s),/secret|private.invalid|token=/);
});
test('成功case也保留资产记录，不把遗留任务丢出轻量报告',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'qa-assets-success-'));
 try{
  await mkdir(path.join(root,'test-results'));
  await writeFile(path.join(root,'test-results/results.json'),JSON.stringify({suites:[{specs:[{title:'TC-04',tests:[{status:'expected',results:[{status:'passed',attachments:[{name:'run-assets',body:Buffer.from(JSON.stringify({attemptId:'one',assets:[],generationRequests:[{status:200,complete:false}],unfinishedRequests:1})).toString('base64')}]}]}]}]}]}));
  const bundle=await buildBundle(root,{});assert.equal(bundle.cases[0].status,'expected');assert.equal(JSON.parse(bundle.cases[0].runtimeDiagnostics[0].text).unfinishedRequests,1);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('验证页诊断保留时间与请求标识，移除Cookie、查询和未知字段', async () => {
  const evidence={code:'SITE_VERIFICATION',status:403,at:'2026-11-04T05:34:16.262Z',
    cfRay:'a5513fa7cdf23747-ATL',requestId:'5fba6bd1-0212-4e41-b3bb-8c723497c28f-1793770456',
    signal:'Browser verification',url:'https://jujubit.ai/products/customize-your-own?token=secret',cookie:'private'};
  const cleaned=sanitizeSiteAccess(evidence);
  assert.equal(cleaned.requestId,evidence.requestId);assert.equal(cleaned.at,evidence.at);
  assert.equal(cleaned.url,'https://jujubit.ai/products/customize-your-own');
  assert.doesNotMatch(JSON.stringify(cleaned),/secret|cookie|private/);
  const root=await mkdtemp(path.join(tmpdir(),'qa-site-access-'));
  try {
    await mkdir(path.join(root,'test-results'));
    await writeFile(path.join(root,'test-results/results.json'),JSON.stringify({suites:[{specs:[{title:'TC-03',tests:[{status:'unexpected',results:[{status:'failed',
      attachments:[{name:'site-access-diagnostics',body:Buffer.from(JSON.stringify(evidence)).toString('base64')}]}]}]}]}]}));
    const bundle=await buildBundle(root,{});
    assert.deepEqual(JSON.parse(bundle.cases[0].runtimeDiagnostics[0].text),cleaned);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('Playwright relative and absolute file names resolve to repository test source', () => {
  assert.equal(normalizeTestFile('full-flow-inventory.spec.ts'), 'tests/full-flow-inventory.spec.ts');
  assert.equal(normalizeTestFile('tests/full-flow-inventory.spec.ts'), 'tests/full-flow-inventory.spec.ts');
  assert.equal(normalizeTestFile('/repo/tests/a.spec.ts', '/repo'), 'tests/a.spec.ts');
  assert.equal(normalizeTestFile('../private.ts'), undefined);
});

test('nested suites retain all case statuses', () => {
  const rows = collectCases([{ suites: [{ specs: [{ title: 'TC-03', tests: [{ status: 'unexpected' }] }] }] }]);
  assert.equal(rows[0].title, 'TC-03');
  assert.equal(rows[0].status, 'unexpected');
});

test('review carries both reasons without leaking credentials or corrupting JSON', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'qa-recheck-bundle-'));
  try {
    await mkdir(path.join(root,'test-results'));
    await writeFile(path.join(root,'test-results/results.json'),JSON.stringify({suites:[], recheck:{cases:[{
      title:'TC-03',initialStatus:'failed',finalStatus:'failed-on-recheck',
      firstFailure:{reason:'token=private123 first timeout'},secondFailure:{reason:'second timeout',analysis:'https://private.invalid'}
    }]}}));
    const bundle=await buildBundle(root,{});
    assert.match(bundle.recheck.cases[0].firstReason,/first timeout/);
    assert.equal(bundle.recheck.cases[0].secondReason,'second timeout');
    assert.doesNotMatch(JSON.stringify(bundle),/private123|private.invalid/);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('diagnostic redaction removes credentials, links and personal data', () => {
  const text = redact('token="private key" Bearer secret123 gho_samplekey a@b.com https://private.test 13812345678');
  for (const value of ['private key', 'secret123', 'gho_samplekey', 'a@b.com', 'private.test', '13812345678']) assert.ok(!text.includes(value));
});

test('missing report is evidence gap, not passing test', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-diagnostic-test-'));
  try {
    const bundle = await buildBundle(root, { GITHUB_RUN_ID: '123', GITHUB_SHA: 'abc', GITHUB_RUN_ATTEMPT: '2' });
    assert.equal(bundle.cases.length, 0);
    assert.match(bundle.errors[0], /missing or invalid/);
    assert.equal(bundle.runAttempt, '2');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('includes local context but rejects symlink outside test-results', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-diagnostic-test-'));
  try {
    const caseDir = path.join(root, 'test-results', 'case');
    await mkdir(caseDir, { recursive: true });
    await writeFile(path.join(caseDir, 'error-context.md'), 'Shopping cart\nPay now\ntoken=private123');
    const report = { suites: [{ suites: [{ specs: [{ title: 'TC-03', tests: [{ status: 'unexpected', results: [{ status: 'failed', error: { message: 'Expected visible' }, attachments: [{ path: path.join(caseDir, 'test.png') }] }] }] }] }] }] };
    await writeFile(path.join(root, 'test-results/results.json'), JSON.stringify(report));
    const bundle = await buildBundle(root, {});
    assert.match(bundle.cases[0].context, /Shopping cart/);
    assert.ok(!bundle.cases[0].context.includes('private123'));
    await rm(path.join(caseDir, 'error-context.md'));
    await writeFile(path.join(root, 'outside.md'), 'DO NOT READ');
    await symlink(path.join(root, 'outside.md'), path.join(caseDir, 'error-context.md'));
    const protectedBundle = await buildBundle(root, {});
    assert.equal(protectedBundle.cases[0].contextAvailable, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bounded runtime attachments reach bot evidence, sensitive content and escaping paths do not', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-runtime-test-'));
  try {
    const resultsRoot = path.join(root, 'test-results');
    await mkdir(resultsRoot);
    const file = path.join(resultsRoot, 'runtime.json');
    await writeFile(file, JSON.stringify({ phase: 'domcontentloaded', state: { readyState: 'interactive' }, token: 'secret123', url: 'https://private.invalid/?key=x' }));
    const outside = path.join(root, 'private.json'); await writeFile(outside, 'DO NOT INCLUDE');
    const escape = path.join(resultsRoot, 'escaped.json'); await symlink(outside, escape);
    const report = { suites: [{ specs: [{ title: 'TC-00', tests: [{ status: 'unexpected', results: [{ status: 'failed',
      attachments: [{ name: 'runtime-diagnostics', path: file }, { name: 'navigation-diagnostics', path: escape },
        { name: 'navigation-diagnostics', body: Buffer.from('{"phase":"renderer","token":"privateInline"}').toString('base64') }] }] }] }] }] };
    await writeFile(path.join(resultsRoot, 'results.json'), JSON.stringify(report));
    const bundle = await buildBundle(root, {});
    assert.equal(bundle.cases[0].runtimeDiagnostics.length, 2);
    assert.match(bundle.cases[0].runtimeDiagnostics[0].text, /readyState/);
    assert.match(bundle.cases[0].runtimeDiagnostics[1].text, /renderer/);
    assert.doesNotMatch(JSON.stringify(bundle), /secret123|privateInline|private.invalid|DO NOT INCLUDE/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
