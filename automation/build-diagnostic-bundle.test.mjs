import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildBundle, collectCases, normalizeTestFile, redact } from './build-diagnostic-bundle.mjs';

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
