import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectedCaseIds, selectedGrep, completeSelectedScope } from './selected-case-scope.mjs';
import { recheckableCases } from './failure-recheck.mjs';
test('selected reruns only accept distinct retained case IDs, not shell/regex/file inputs', () => {
  assert.deepEqual(selectedCaseIds('TC-03,EXP-TC-01'), ['TC-03','EXP-TC-01']);
  for (const raw of ['', '.*', 'TC-06', 'TC-01,TC-01', 'TC-01|TC-02','tests/a.spec.ts', 'TC-03; echo x']) assert.throws(() => selectedCaseIds(raw));
});
test('selected regex cannot confuse TC-00 with TC-001 or canvas/membership groups', () => {
  const pattern = new RegExp(selectedGrep(['TC-00','EXP-TC-01']));
  assert.ok(pattern.test('canvas-control TC-00: home'));
  assert.ok(pattern.test('EXP-TC-01：canvas'));
  assert.equal(pattern.test('TC-001: click'), false);
  assert.equal(pattern.test('TC-EXP-01: retired'), false);
});
test('selected completeness rejects missing, duplicate and unrelated results and retains one-case recheck', () => {
  const rows = [{ title:'TC-03: cart',status:'failed' }];
  assert.equal(completeSelectedScope(rows,['TC-03']),true);
  assert.equal(completeSelectedScope([],['TC-03']),false);
  assert.equal(completeSelectedScope([...rows,...rows],['TC-03']),false);
  assert.deepEqual(recheckableCases('selected',rows),rows);
});
