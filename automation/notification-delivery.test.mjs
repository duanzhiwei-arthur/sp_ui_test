import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
