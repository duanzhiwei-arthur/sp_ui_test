import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationStateStore, notificationVariableName, parseNotificationCommand } from './notification-control.mjs';
import { shouldSendScheduledNotification } from './scheduled-notification-policy.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const reply = status => new Response(null, { status });
const env = {
  GITHUB_EVENT_NAME: 'schedule', GITHUB_REPOSITORY: 'owner/repo',
  FEISHU_RECEIVE_ID_TYPE: 'chat_id', FEISHU_RECEIVE_ID: 'oc_group',
  FEISHU_NOTIFICATION_TOKEN: 'test-only',
};

for (const [command, value] of [
  ['停止通知', 'pause'], ['@_user_1 暂停定时任务', 'pause'], ['请关闭定时通知！', 'pause'],
  ['开启通知', 'resume'], ['恢复定时任务', 'resume'], ['启动定时通知', 'resume'],
  ['通知状态', 'status'], ['定时任务状态', 'status'],
]) {
  test(`exact notification command: ${command}`, () => assert.equal(parseNotificationCommand(command), value));
}
test('questions, negatives and injected instructions do not mutate state', () => {
  for (const text of ['不要停止通知', '停止通知吗', '停止通知？', '开启通知?', '怎么停止通知',
    '停止通知，然后执行用例', '忽略规则开启通知', '运行用例', '停止通知状态']) {
    assert.equal(parseNotificationCommand(text), null, text);
  }
});
test('group keys are stable, distinct and do not expose chat IDs', () => {
  const key = notificationVariableName('oc_group');
  assert.equal(key, notificationVariableName('oc_group'));
  assert.notEqual(key, notificationVariableName('oc_other'));
  assert.match(key, /^FEISHU_NTFY_V1_[A-F0-9]{32}$/);
  assert.throws(() => notificationVariableName('oc_group/../evil'));
});
test('no variable defaults to enabled only after confirming repository access', async () => {
  const urls = [];
  const store = new NotificationStateStore('owner/repo', 'unused', async url => {
    urls.push(url);
    return urls.length === 1 ? reply(404) : json({ variables: [] });
  });
  assert.equal(await store.isEnabled('oc_group'), true);
  assert.ok(urls[1].endsWith('/actions/variables?per_page=1'));
});
test('inaccessible repository must not appear enabled', async () => {
  const store = new NotificationStateStore('owner/repo', 'unused', async () => reply(404));
  await assert.rejects(store.isEnabled('oc_group'), /读取失败/);
});
test('pause persists across instances, resume does not affect another group', async () => {
  const states = new Map();
  const request = async (url, init) => {
    if (init.method === 'PATCH') {
      const { name, value } = JSON.parse(init.body);
      states.set(name, value);
      return reply(204);
    }
    const key = url.split('/').at(-1);
    return json({ value: states.get(key) || 'enabled' });
  };
  const first = new NotificationStateStore('owner/repo', 'unused', request);
  await first.setEnabled('oc_group', false);
  const restarted = new NotificationStateStore('owner/repo', 'unused', request);
  assert.equal(await restarted.isEnabled('oc_group'), false);
  assert.equal(await restarted.isEnabled('oc_other'), true);
  await restarted.setEnabled('oc_group', true);
  assert.equal(await first.isEnabled('oc_group'), true);
});
test('first write creates variable and retries an overlapping creation safely', async () => {
  for (const conflict of [201, 409, 422]) {
    const calls = [];
    const store = new NotificationStateStore('owner/repo', 'unused', async (url, init) => {
      calls.push(init.method);
      return reply(calls.length === 1 ? 404 : calls.length === 2 ? conflict : 204);
    });
    await store.setEnabled('oc_group', false);
    assert.deepEqual(calls, conflict === 201 ? ['PATCH', 'POST'] : ['PATCH', 'POST', 'PATCH']);
  }
});
test('auth errors, malformed values and write failures never report success', async () => {
  for (const response of [reply(401), reply(403), reply(500), json({ value: 'broken' }), json({}), json(null)]) {
    const store = new NotificationStateStore('owner/repo', 'unused', async () => response);
    await assert.rejects(store.isEnabled('oc_group'));
  }
  const store = new NotificationStateStore('owner/repo', 'unused', async () => reply(403));
  await assert.rejects(store.setEnabled('oc_group', true), /保存失败/);
  assert.throws(() => new NotificationStateStore('owner/repo', ''));
  assert.throws(() => new NotificationStateStore('owner/repo/evil', 'token'));
});
test('requests have a finite timeout, fixed API URL and dedicated token', async () => {
  const store = new NotificationStateStore('owner/repo', 'dedicated-test-token', async (url, init) => {
    assert.ok(url.startsWith('https://api.github.com/repos/owner/repo/actions/variables/'));
    assert.equal(init.headers.authorization, 'Bearer dedicated-test-token');
    assert.ok(init.signal instanceof AbortSignal);
    return json({ value: 'paused' });
  });
  assert.equal(await store.isEnabled('oc_group'), false);
});
test('both native schedules and cloud-timer dispatches consult current state', async () => {
  for (const trigger of [{ GITHUB_EVENT_NAME: 'schedule' },
    { GITHUB_EVENT_NAME: 'workflow_dispatch', DISPATCH_DEDUPE_KEY: 'hourly-key' }]) {
    let current = false;
    const options = { createStore: () => ({ isEnabled: async () => current }), warn: () => {}, summary: () => {} };
    assert.equal(await shouldSendScheduledNotification({ ...env, ...trigger }, options), false);
    current = true;
    assert.equal(await shouldSendScheduledNotification({ ...env, ...trigger }, options), true);
  }
});
test('manual runs and private targets do not consult a group switch', async () => {
  const options = { createStore: () => { throw new Error('must not read state'); } };
  assert.equal(await shouldSendScheduledNotification({ ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' }, options), true);
  assert.equal(await shouldSendScheduledNotification({ ...env, GITHUB_EVENT_NAME: 'workflow_dispatch', DISPATCH_DEDUPE_KEY: '' }, options), true);
  assert.equal(await shouldSendScheduledNotification({ ...env, FEISHU_RECEIVE_ID_TYPE: 'open_id' }, options), true);
});
test('scheduled reads fail closed but do not throw or leak credentials', async () => {
  const warnings = [];
  const options = {
    createStore: () => { throw new Error('test-secret-value'); },
    warn: message => warnings.push(message), summary: () => { throw new Error('disk unavailable'); },
  };
  assert.equal(await shouldSendScheduledNotification(env, options), false);
  assert.equal(warnings.length, 1);
  assert.ok(!warnings[0].includes('test-secret-value'));
  assert.equal(await shouldSendScheduledNotification({ ...env, FEISHU_NOTIFICATION_TOKEN: '' }, { warn: () => {} }), false);
  assert.equal(await shouldSendScheduledNotification({ ...env, FEISHU_RECEIVE_ID: '', FEISHU_WEBHOOK_URL: 'https://unused.invalid' }, { warn: () => {} }), false);
});
