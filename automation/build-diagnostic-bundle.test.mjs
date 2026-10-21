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
