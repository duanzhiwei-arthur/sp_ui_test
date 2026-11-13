import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failureMentionText, FAILURE_MENTION_TARGETS, resolveFailureMentions } from './failure-mentions.mjs';

const names = ['段志伟', '吴奇波', '王亚珍', '邓雄飞', '李国庆', '陈柯男', '余快'];
const members = names.map((name, index) => ({ name, member_id: `ou_person${index}` }));
const config = { receiveIdType: 'chat_id', receiveId: 'oc_group' };

test('only the seven verified people are mentioned, with aliases and no @all', () => {
  const text = resolveFailureMentions([...members, { name: '其他同事', member_id: 'ou_other' }]);
  assert.equal((text.match(/<at /g) ?? []).length, 7);
  for (const target of FAILURE_MENTION_TARGETS) assert.ok(text.includes(`>${target.name}</at>`));
  assert.doesNotMatch(text, /user_id="all"|ou_other/);
});

test('missing, ambiguous, duplicate or invalid app IDs cannot produce partial or all-person mentions', () => {
  for (const list of [members.slice(1), [...members, members[0]],
    members.map((row, index) => index === 1 ? { ...row, member_id: members[0].member_id } : row),
    members.map((row, index) => index === 1 ? { ...row, member_id: 'all' } : row)]) {
    assert.throws(() => resolveFailureMentions(list), /无法唯一核实/);
  }
});

test('only final group failures resolve members; success, private reports and disabled settings do not', async () => {
  const blocked = async () => { throw Error('No API calls expected'); };
  for (const [target, failed, env] of [
    [config, false, {}], [{ ...config, receiveIdType: 'open_id' }, true, {}],
    [config, true, { FEISHU_PRIVATE_REPORT: 'true' }],
    [config, true, { FEISHU_FAILURE_MENTIONS_ENABLED: 'false' }],
    [config, true, { FEISHU_MENTION_ALL_ON_FAILURE: 'false' }],
  ]) assert.equal(await failureMentionText(target, failed, env, blocked), '');
  let calls = 0;
  assert.equal(await failureMentionText(config, true, {}, async () => {
    calls++; return { data: { chat_mode: 'p2p' } };
  }), '');
  assert.equal(calls, 1);
});

test('the sending app resolves every page before mentioning, never using cached IDs from another app', async () => {
  const urls = [];
  const text = await failureMentionText(config, true, {}, async url => {
    urls.push(url);
    if (!url.includes('/members?')) return { data: { chat_mode: 'group' } };
    if (!url.includes('page_token=')) return { data: { items: members.slice(0, 3), has_more: true, page_token: 'next-page' } };
    return { data: { items: members.slice(3), has_more: false } };
  });
  assert.equal(urls.length, 3);
  assert.ok(urls[2].includes('page_token=next-page'));
  assert.match(text, /ou_person6/);
  assert.doesNotMatch(text, /user_id="all"/);
});

test('broken and repeating pagination cannot silently skip the rest of the group', async () => {
  for (const reply of [{ data: {} }, { data: { items: [], has_more: true } },
    { data: { items: members, has_more: true, page_token: 'same-page' } }]) {
    await assert.rejects(failureMentionText(config, true, {}, async url =>
      url.includes('/members?') ? reply : { data: { chat_mode: 'group' } }), /群成员/);
  }
});
