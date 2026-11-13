import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupFailureKind, groupFailurePolicy, buildGroupFailureCard } from './group-failure-policy.mjs';
const summary = reason => ({ caseResults: [{ title: 'TC-00: test', status: 'failed', gaCookie: { cookieValue: 'GA1.1.1.2', cookieClientId: '1.2' } }], failureDetails: [{ title: 'TC-00: test', reason }] });
test('explicit challenge and network evidence take precedence over assertions', () => {
  assert.equal(groupFailureKind('expect(locator).toBeVisible() [SITE_VERIFICATION]'), '人机验证阻断');
  assert.equal(groupFailureKind('expect(locator).toBeVisible() net::ERR_CONNECTION_RESET'), '网络问题');
  assert.equal(groupFailureKind('[SITE_ACCESS_DENIED] HTTP403'), '访问被拒绝');
  assert.equal(groupFailureKind('[GENERATION_TIMEOUT]'), '生成等待超时（原因待查）');
  assert.equal(groupFailureKind('[NAV_DOM_READY]'), '页面就绪异常（原因待查）');
});
test('only pure assertion/interaction failures are suppressed; never suppress confirmed business or missing evidence', () => {
  for (const reason of ['Error: expect(locator).toBeVisible() failed', '[UI_VIEW_TIMEOUT]', '[UI_INPUT_RESET]']) assert.equal(groupFailurePolicy(summary(reason)).suppress, true);
  for (const reason of ['', '[CART_ASSET] expect(received)', '[GENERATION_FAILED]', '[SITE_VERIFICATION]', 'unknown error', '[READ_TRANSPORT]']) assert.equal(groupFailurePolicy(summary(reason)).suppress, false);
  assert.equal(groupFailurePolicy({ ...summary('expect(received)'), readError: 'missing report' }).suppress, false);
});
test('mixed failures and first-attempt challenge are not swallowed by a later assertion', () => {
  const input = summary('expect(locator).toBeVisible()');
  input.recheck = { cases: [{ title: input.caseResults[0].title, firstFailure: { reason: '[SITE_VERIFICATION]' }, secondFailure: { reason: 'expect(locator).toBeVisible()' } }] };
  const policy = groupFailurePolicy(input);
  assert.equal(policy.suppress, false);
  assert.deepEqual(policy.reportable[0].kinds, ['人机验证阻断']);
  const card = buildGroupFailureCard(input, policy, 'https://github.com/run');
  assert.match(card.header.title.content, /人机验证/);
  assert.match(JSON.stringify(card), /cookieValue=GA1.1.1.2/);
});
