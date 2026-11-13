import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { allowedPath, validateProposal, authorizePublish, taskName, REPOSITORY } from './coding-agent/policy.mjs';
import { repositoryReader, generateProposal } from './coding-agent/generate.mjs';
import { GitHub } from './coding-agent/github.mjs';
import { materialize } from './coding-agent/worker.mjs';
const base = 'a'.repeat(40), head = 'b'.repeat(40), taskId = 'c'.repeat(24), owner = 'ou_owner';
const proposal = files => ({ baseSha: base, summary: '测试改动', files });

test('coding paths cannot access secrets, workflows, own executor or permissions', () => {
  for (const name of ['tests/example.spec.ts', 'automation/result-card.mjs', 'experiments/canvas-v3/board.ts', 'README.md']) assert.equal(allowedPath(name), true, name);
  for (const name of ['.env', '.github/workflows/ci.yml', 'package.json', 'package-lock.json', 'AGENTS.md',
    '/tmp/secret', '../README.md', 'tests/../README.md', 'tests/.env', 'tests/a//b.ts',
    'automation/coding-agent/worker.mjs', 'automation/notification-control.mjs', 'tests/AGENTS.md',
    'automation/feishu-experiment-command.mjs', 'tests/secret.json', 'node_modules/a.js', 'tests/file.js']) assert.equal(allowedPath(name), false, name);
  assert.throws(() => taskName('../../etc'));
});
test('proposal validation rejects duplicates, credentials, wrong base and oversized writes', () => {
  assert.equal(validateProposal(proposal([{ path: 'README.md', content: 'ok' }]), base).files.length, 1);
  for (const files of [[], [{ path: '.env', content: 'evil' }],
    [{ path: 'README.md', content: 'ok' }, { path: 'README.md', content: 'dup' }],
    [{ path: 'README.md', content: 'ghp_' + 's'.repeat(40) }],
    [{ path: 'README.md', content: 'x'.repeat(100001) }]]) assert.throws(() => validateProposal(proposal(files), base));
  assert.throws(() => validateProposal(proposal([{ path: 'README.md', content: 'ok' }]), head));
});
test('publish needs exact owner, task, commit, successful run and unchanged main', () => {
  const record = { owner, taskId, headSha: head, baseSha: base, state: 'ready', runId: '123' };
  const context = { owner, taskId, expectedSha: head, mainSha: base, branchSha: head, successfulRun: true };
  assert.equal(authorizePublish(record, context), 'publish');
  assert.equal(authorizePublish(record, { ...context, mainSha: head }), 'already-published');
  for (const patch of [{ owner: 'ou_other' }, { taskId: 'd'.repeat(24) }, { expectedSha: base },
    { branchSha: base }, { mainSha: 'e'.repeat(40) }, { successfulRun: false }]) assert.throws(() => authorizePublish(record, { ...context, ...patch }));
  assert.throws(() => authorizePublish({ ...record, state: 'failed' }, context));
});
test('GitHub adapter fixes repository scope and requires confirmed variable absence', async () => {
  let calls = 0;
  const gh = new GitHub('fake', async () => { calls++; return new Response(null, { status: 404 }); });
  await assert.rejects(gh.call('/contents/file', { repo: 'attacker/repo' }));
  assert.equal(calls, 0);
  await assert.rejects(gh.variable('FEISHU_CODE_OWNER_V1'), /权限配置/);
});
async function repo() {
  const root = await mkdtemp(path.join(tmpdir(), 'coding-policy-test-'));
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']); git(['config', 'user.email', 'test@example.invalid']); git(['config', 'user.name', 'Test']);
  await writeFile(path.join(root, 'README.md'), 'original');
  await writeFile(path.join(root, '.env'), 'TOP_SECRET');
  await mkdir(path.join(root, 'tests')); await writeFile(path.join(root, 'tests/a.ts'), 'export const value = 1;');
  await symlink('/tmp', path.join(root, 'tests/link'));
  git(['add', 'README.md', '.env', 'tests']); git(['commit', '-qm', 'fixture']);
  return { root, sha: git(['rev-parse', 'HEAD']) };
}
test('repository reader uses committed regular blobs only, ignores local secret/edits and symlinks', async () => {
  const { root, sha } = await repo();
  await writeFile(path.join(root, 'README.md'), 'LOCAL_SECRET');
  const reader = repositoryReader(root, sha);
  assert.equal(reader.read('README.md'), 'original');
  assert.throws(() => reader.read('.env'));
  assert.throws(() => reader.read('tests/link/README.md'));
  assert.throws(() => reader.read('../../etc/passwd'));
});
test('materialization refuses writes through a committed symlink', async () => {
  const { root, sha } = await repo();
  const candidate = path.join(root, 'candidate');
  await assert.rejects(materialize(root, candidate, {
    baseSha: sha, summary: 'bad', files: [{ path: 'tests/link/escape.ts', content: 'bad' }],
  }), /符号链接/);
});
test('model can read code but cannot request shell/network/publish tools', async () => {
  let turn = 0;
  const reader = { list: () => ['README.md'], read: name => { assert.equal(name, 'README.md'); return 'original'; } };
  const result = await generateProposal({ request: '更正说明文字', baseSha: base, reader,
    endpoint: 'https://model.example.invalid/v1', key: 'fake', model: 'existing-model',
    fetcher: async (url, init) => {
      assert.equal(url, 'https://model.example.invalid/v1/chat/completions');
      const body = JSON.parse(init.body);
      assert.deepEqual(body.tools.map(tool => tool.function.name), ['read_file']);
      if (turn++ === 0) return Response.json({ choices: [{ message: { tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] } }] });
      assert.equal(body.messages.at(-1).content, 'original');
      return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: '修改说明', files: [{ path: 'README.md', content: 'new' }] }) } }] });
    } });
  assert.equal(result.files[0].content, 'new');
});
test('model cannot replace an unread original or inject a workflow change', async () => {
  for (const file of [{ path: 'README.md', content: 'new' }, { path: '.github/workflows/evil.yml', content: 'evil' }]) {
    await assert.rejects(generateProposal({ request: '修改文字', baseSha: base,
      reader: { list: () => ['README.md'], read: () => 'original' },
      endpoint: 'https://model.example.invalid/v1', key: 'fake', model: 'existing-model',
      fetcher: async () => Response.json({ choices: [{ message: { content: JSON.stringify({ summary: 'summary', files: [file] }) } }] }),
    }));
  }
});
test('workflow never gives generated code a token, network or writable host mount', async () => {
  const file = new URL('../.github/workflows/feishu-coding.yml', import.meta.url);
  const text = await readFile(file, 'utf8').catch(() => '');
  // Replica intentionally does not copy workflows.
  if (!text) return;
  assert.match(text, /persist-credentials: false/);
  assert.match(text, /--network none --read-only --cap-drop ALL/);
  assert.match(text, /--security-opt no-new-privileges/);
  assert.match(text, /--user 65534:65534/);
  assert.match(text, /\.coding-candidate:\/work:ro/);
  const block = text.slice(text.indexOf('docker run'), text.indexOf('- name: Persist draft'));
  assert.ok(!/FEISHU|LLM|GITHUB_TOKEN|docker\.sock/.test(block));
  assert.ok(!/npm (?:test|run)|playwright test/.test(block));
});

test('GitHub creation endpoints may return empty 201 bodies', async () => {
  let calls = 0;
  const gh = new GitHub('fake', async (url, init) => {
    calls++;
    if (init.method === 'POST') return new Response(null, { status: 201 });
    if (url.endsWith('?per_page=1')) return Response.json({ total_count: 0 });
    return new Response(null, { status: 404 });
  });
  assert.equal(await gh.setVariable('FEISHU_CODE_TASK_' + 'A'.repeat(24), { state: 'ready' }), null);
  assert.equal(calls, 3);
});
