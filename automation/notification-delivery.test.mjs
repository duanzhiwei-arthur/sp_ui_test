import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FAILURE_MENTION_TARGETS } from './failure-mentions.mjs';

// Runs only the notification-test branch. All fetches are mocked in a child
// process; no tests execute and no live Feishu messages are ever sent.
for (const [name, trigger, state, expected] of [
  ['paused schedule', 'schedule', 'paused', ['read-state']],
  ['enabled schedule', 'schedule', 'enabled', ['read-state', 'tenant-token', 'send-interactive']],
  ['manual run while paused', 'workflow_dispatch', 'paused', ['tenant-token', 'send-interactive']],
]) {
  test(`actual notification entry: ${name}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'notification-delivery-test-'));
    const log = path.join(directory, 'calls.txt');
    const preload = path.join(directory, 'mock-fetch.mjs');
    const results = path.join(directory, 'results.json');
    await writeFile(results, JSON.stringify({ stats: { expected: 1, unexpected: 0, duration: 1000 }, suites: [] }));
    await writeFile(log, '');
    await writeFile(preload, `
      import { appendFileSync } from 'node:fs';
      globalThis.fetch = async (url, init) => {
        const log = value => appendFileSync(${JSON.stringify(log)}, value + '\\n');
        if (url.startsWith('https://api.github.com/repos/owner/repo/actions/variables/')) {
          log('read-state'); return Response.json({ value: ${JSON.stringify(state)} });
        }
        if (url === 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal') {
          log('tenant-token'); return Response.json({ code: 0, tenant_access_token: 'fake-only' });
        }
        if (url.endsWith('/chats/oc_mock')) return Response.json({ code: 0, data: { chat_mode: 'group' } });
        if (url.startsWith('https://open.feishu.cn/open-apis/im/v1/messages?')) {
          log('send-' + JSON.parse(init.body).msg_type);
          return Response.json({ code: 0, data: { message_id: 'om_mock' } });
        }
        throw new Error('Unexpected network request blocked by test');
      };
    `);
    const entry = fileURLToPath(new URL('./run-and-notify.mjs', import.meta.url));
    const child = spawnSync(process.execPath, ['--import', preload, entry, '--notification-test'], {
      cwd: directory, encoding: 'utf8', timeout: 10_000,
      env: {
        PATH: process.env.PATH, DOTENV_CONFIG_PATH: path.join(directory, 'no-env'),
        GITHUB_EVENT_NAME: trigger, GITHUB_REPOSITORY: 'owner/repo',
        SCHEDULED_TEST_MODE: 'daily', PLAYWRIGHT_RESULTS_FILE: results,
        FEISHU_APP_ID: 'cli_fake', FEISHU_APP_SECRET: 'fake-only',
        FEISHU_RECEIVE_ID_TYPE: 'chat_id', FEISHU_RECEIVE_ID: 'oc_mock',
        FEISHU_NOTIFICATION_TOKEN: 'fake-only', FEISHU_MENTION_ALL_ON_FAILURE: 'false',
      },
    });
    assert.equal(child.status, 0, `${child.error || ''}\n${child.stdout}\n${child.stderr}`);
    assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n'), expected);
  });
}

for (const broken of [false, true]) {
  test(`actual failure entry sends card with ${broken ? 'unavailable roster and no mentions' : 'only seven verified mentions'}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'failure-mentions-delivery-'));
    const results = path.join(directory, 'results.json'), log = path.join(directory, 'messages.jsonl');
    const preload = path.join(directory, 'mock-fetch.mjs');
    await writeFile(log, '');
    await writeFile(results, JSON.stringify({ stats: { expected: 0, unexpected: 1, skipped: 0, flaky: 0, duration: 1000 }, errors: [],
      suites: [{ specs: [{ title: 'TC-00: failure', tests: [{ status: 'unexpected', results: [{ status: 'failed', error: { message: 'controlled failure' }, attachments: [] }] }] }] }] }));
    const members = FAILURE_MENTION_TARGETS.map((target, i) => ({ name: target.aliases.at(-1), member_id: `ou_test${i}` }));
    await writeFile(preload, `
      import {appendFileSync} from 'node:fs';
      globalThis.fetch = async (url, init) => {
        if(url.includes('/auth/v3/'))return Response.json({code:0,tenant_access_token:'fake'});
        if(url.endsWith('/chats/oc_mock'))return Response.json({code:0,data:{chat_mode:'group'}});
        if(url.includes('/members?'))return Response.json({code:0,data:{items:${JSON.stringify(broken ? members.slice(1) : members)},has_more:false}});
        if(url.includes('/im/v1/messages?')) {appendFileSync(${JSON.stringify(log)},init.body+'\\n');return Response.json({code:0,data:{message_id:'om_fake'}});}
        throw Error('Unexpected API blocked');
      };`);
    const child = spawnSync(process.execPath, ['--import', preload, fileURLToPath(new URL('./run-and-notify.mjs', import.meta.url)), '--notification-test'], {
      cwd: directory, encoding: 'utf8', timeout: 10000,
      env: { PATH: process.env.PATH, DOTENV_CONFIG_PATH: path.join(directory, 'no-env'), GITHUB_EVENT_NAME: 'workflow_dispatch',
        SCHEDULED_TEST_MODE: 'safe', PLAYWRIGHT_RESULTS_FILE: results,
        FEISHU_APP_ID: 'cli_fake', FEISHU_APP_SECRET: 'fake', FEISHU_RECEIVE_ID_TYPE: 'chat_id', FEISHU_RECEIVE_ID: 'oc_mock' },
    });
    assert.equal(child.status, 0, child.stderr);
    const lines = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(lines.at(-1).msg_type, 'interactive');
    assert.equal(lines.filter(row => row.msg_type === 'text').length, broken ? 0 : 1);
    assert.doesNotMatch(JSON.stringify(lines), /user_id=\\"all/);
    if (!broken) assert.equal((JSON.parse(lines[0].content).text.match(/<at /g) ?? []).length, 7);
  });
}

for (const [mode, reason, shouldSend] of [['group', 'Error: expect(locator).toBeVisible() failed', false],
  ['p2p', 'Error: expect(locator).toBeVisible() failed', true], ['group', '[SITE_VERIFICATION] blocked', true],
  ['group', '[READ_TRANSPORT] timeout', true]]) {
  test(`group policy real entry ${mode}: ${reason}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'group-policy-'));
    const log = path.join(directory, 'messages'), preload = path.join(directory, 'mock.mjs'), results = path.join(directory, 'results.json');
    await writeFile(log, '');
    await writeFile(results, JSON.stringify({ stats: { expected: 0, unexpected: 1, duration: 1 }, suites: [{ specs: [{ title: 'TC-00: test', tests: [{ status: 'unexpected', results: [{ status: 'failed', error: { message: reason }, attachments: [] }] }] }] }] }));
    await writeFile(preload, `import {appendFileSync} from 'node:fs';globalThis.fetch=async(url,init)=>{
      if(url.includes('/auth/v3/'))return Response.json({code:0,tenant_access_token:'fake'});
      if(url.endsWith('/chats/oc_mock'))return Response.json({code:0,data:{chat_mode:${JSON.stringify(mode)}}});
      if(url.includes('/im/v1/messages?')){appendFileSync(${JSON.stringify(log)},init.body+'\\n');return Response.json({code:0,data:{message_id:'om_fake'}});}
      throw Error('Unexpected API');};`);
    const child = spawnSync(process.execPath, ['--import', preload, fileURLToPath(new URL('./run-and-notify.mjs', import.meta.url)), '--notification-test'], {
      cwd: directory, encoding: 'utf8', timeout: 10000, env: { PATH: process.env.PATH, DOTENV_CONFIG_PATH: path.join(directory, 'no-env'),
        SCHEDULED_TEST_MODE: 'safe', PLAYWRIGHT_RESULTS_FILE: results, FEISHU_APP_ID: 'cli_fake', FEISHU_APP_SECRET: 'fake',
        FEISHU_RECEIVE_ID_TYPE: 'chat_id', FEISHU_RECEIVE_ID: 'oc_mock', FEISHU_FAILURE_MENTIONS_ENABLED: 'false' } });
    assert.equal(child.status, 0, child.stderr);
    const sent = await readFile(log, 'utf8');
    assert.equal(Boolean(sent), shouldSend);
    if (reason.includes('SITE_VERIFICATION')) assert.match(sent, /人机验证阻断/);
    if (reason.includes('READ_TRANSPORT')) assert.match(sent, /网络问题/);
  });
}
