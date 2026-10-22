import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectGenerationEvidence, formatGenerationEvidence, isGenerationFailure, parseGenerationEvents } from './generation-evidence.mjs';

const sse = 'event: task_start\ndata: {"taskId":"3815068"}\n\nevent: asset_start\ndata: {"assetId":"3830283"}\n\nevent: asset_3d_start\ndata: {"assetId":"3830283","extra":{"traceId":"3502f5e1037f39ca8867ef4726ff758f","imageUrl":"https://private.invalid","token":"secret"}}\n\n';
const result = () => ({ startTime: '2026-10-21T22:24:11.911Z', duration: 362772,
  steps: [{ title: '等待 3D 完成并横向拖动 2 秒', error: { message: 'timeout' } }] });

test('generation detection uses failed steps, not the case title', () => {
  assert.equal(isGenerationFailure(result()), true);
  assert.equal(isGenerationFailure({ steps: [{ title: '生成并验证 2D 图片' }, { title: '进入 Checkout 并验证结账页', error: {} }] }), false);
  assert.equal(isGenerationFailure({ steps: [{ title: 'History 新增记录后删除最新记录', error: {} }] }), false);
});

test('SSE parser keeps only correlated task/asset/trace identifiers', () => {
  assert.deepEqual(parseGenerationEvents(sse), [{ taskId: '3815068', assetId: '3830283', traceIds: ['3502f5e1037f39ca8867ef4726ff758f'] }]);
  assert.ok(!JSON.stringify(parseGenerationEvents(sse)).includes('private.invalid'));
  const next = sse + 'event: task_start\ndata: {"taskId":"999"}\n\nevent: asset_start\ndata: {"assetId":"888"}\n\n';
  assert.equal(parseGenerationEvents(next)[1].taskId, '999');
  assert.deepEqual(parseGenerationEvents('event: asset_start\ndata: broken\n\n'), []);
  assert.deepEqual(parseGenerationEvents('event: task_start\ndata: {"taskId":"<at id=all>"}\n\n'), []);
});

test('missing trace yields explicit unknown fields and Beijing time', async () => {
  const evidence = await collectGenerationEvidence(result());
  const text = formatGenerationEvidence(evidence);
  assert.match(text, /Task ID：未采集到/);
  assert.match(text, /Asset ID：未采集到/);
  assert.match(text, /Trace ID：未采集到/);
  assert.match(text, /2026-10-22 06:24:11/);
  assert.match(text, /2026-10-22 06:30:14/);
  assert.equal(await collectGenerationEvidence({}), null);
});

test('trace is bounded to failure attempt and safe test-results paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'generation-evidence-test-'));
  try {
    const source = path.join(root, 'source');
    await mkdir(path.join(source, 'resources'), { recursive: true });
    await mkdir(path.join(root, 'test-results'), { recursive: true });
    const sha = 'a'.repeat(40) + '.dat';
    await writeFile(path.join(source, 'resources', sha), sse);
    const snapshot = start => ({ snapshot: { startedDateTime: start,
      request: { method: 'POST', url: 'https://jujubit.ai/apps/ai/activity/tasks' },
      response: { content: { mimeType: 'text/event-stream', _sha1: sha } } } });
    await writeFile(path.join(source, '0-trace.network'), [snapshot('2026-10-21T22:00:00Z'), snapshot('2026-10-21T22:24:50.751Z')].map(JSON.stringify).join('\n'));
    const zip = path.join(root, 'test-results/trace.zip');
    execFileSync('zip', ['-q', zip, '0-trace.network', `resources/${sha}`], { cwd: source });
    const run = { ...result(), attachments: [{ name: 'trace', path: zip }] };
    const evidence = await collectGenerationEvidence(run, root);
    assert.equal(evidence.records.length, 1);
    assert.equal(evidence.startedAt, '2026-10-21T22:24:50.751Z');
    assert.equal(evidence.records[0].taskId, '3815068');
    assert.match(formatGenerationEvidence(evidence), /06:24:50/);
    await symlink(path.join(source, '0-trace.network'), path.join(root, 'test-results/outside.zip'));
    const rejected = await collectGenerationEvidence({ ...result(), attachments: [{ name: 'trace', path: path.join(root, 'test-results/outside.zip') }] }, root);
    assert.equal(rejected.records.length, 0);
    assert.ok(rejected.gap);
  } finally { await rm(root, { recursive: true, force: true }); }
});
