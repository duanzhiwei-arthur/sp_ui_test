import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { firstGenerationFailureMessages, generationResponseIds, collectGenerationEvidence, formatGenerationEvidence, isGenerationFailure, parseGenerationEvents, summarizeGenerationStream } from './generation-evidence.mjs';

test('stream summary keeps timing and terminal observations without inventing backend failure', () => {
  const summary = summarizeGenerationStream('event: asset_3d_start\ndata: {}\n\nevent: ping\ndata: {}\n\n', {
    startedDateTime: '2026-10-21T22:24:50.751Z', time: 180093.956, response: { status: 200 }
  });
  assert.equal(summary.durationMs, 180093.956);
  assert.equal(summary.recordedEndAt, '2026-10-21T22:27:50.844Z');
  assert.equal(summary.threeDCompletionObserved, false);
  assert.equal(summary.taskTerminalObserved, false);
  assert.equal(summary.eventCounts.ping, 1);
  assert.match(summary.caveat, /不能单独证明后台失败/);
});

const sse = 'event: task_start\ndata: {"taskId":"3815068"}\n\nevent: asset_start\ndata: {"assetId":"3830283"}\n\nevent: asset_3d_start\ndata: {"assetId":"3830283","extra":{"traceId":"3502f5e1037f39ca8867ef4726ff758f","imageUrl":"https://private.invalid","token":"secret"}}\n\n';
const result = () => ({ startTime: '2026-10-21T22:24:11.911Z', duration: 362772,
  steps: [{ title: '等待 3D 完成并横向拖动 2 秒', error: { message: 'timeout' } }] });

test('generation detection uses failed steps, not the case title', () => {
  assert.equal(isGenerationFailure({error:{message:'[GENERATION_FAILED] business error'}}), true);
  assert.equal(isGenerationFailure(result()), true);
  assert.equal(isGenerationFailure({ steps: [{ title: '生成并验证 2D 图片' }, { title: '进入 Checkout 并验证结账页', error: {} }] }), false);
  assert.equal(isGenerationFailure({ steps: [{ title: 'History 新增记录后删除最新记录', error: {} }] }), false);
});

test('response identifiers are case insensitive, validated and kept separate', () => {
  assert.deepEqual(generationResponseIds([{name:'X-Trace-ID',value:'abc123'}, {name:'x-trace-id',value:'abc123'},
    {name:'x-request-id',value:'request-123'}, {name:'x-trace-id',value:'<at id=all>'}, {name:'authorization',value:'private'}]),
    {traceIds:['abc123'],requestIds:['request-123']});
});

test('first failure survives recovery, missing fields never borrow the second attempt IDs', () => {
  const summary={recheck:{cases:[{title:'TC-05',finalStatus:'passed-on-recheck',
    firstFailure:{reason:'[GENERATION_FAILED] Retry',generationEvidence:{records:[],streams:[]}},
    secondFailure:{generationEvidence:{records:[{taskId:'second-task'}]}}}]}};
  const text=firstGenerationFailureMessages(summary).join('\n');
  for(const field of ['Task ID','Asset ID','Trace ID','Request ID','错误码']) assert.ok(text.includes(`${field}：未采集到`));
  assert.match(text,/首次生成失败.*二次复核通过/);
  assert.doesNotMatch(text,/second-task/);
  assert.deepEqual(firstGenerationFailureMessages({}),[]);
});

test('terminal asset_done with errorCode is reported as explicit business failure', () => {
  const text='event: asset_done\ndata: {"assetId":"4025463","errorCode":1007,"errorMessage":"runtime run failed token=private123 https://private.invalid"}\n\nevent: task_done\ndata: {"status":4}\n\n';
  const stream=summarizeGenerationStream(text,{response:{status:200}});
  assert.equal(stream.businessErrors[0].errorCode,'1007');
  assert.doesNotMatch(JSON.stringify(stream),/private123|private.invalid/);
  assert.equal(stream.taskTerminalObserved,true);
  assert.match(formatGenerationEvidence({records:[],streams:[stream]}),/生成业务错误：1007/);
  assert.equal(summarizeGenerationStream('event: task_done\ndata: {"status":4}\n\n',{}).businessErrors.length,0);
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
      response: { headers: [{name:'X-Trace-ID',value:start==='2026-10-21T22:00:00Z'?'old-trace':'header-trace'},
        {name:'x-request-id',value:'request-123'}], content: { mimeType: 'text/event-stream', _sha1: sha } } } });
    await writeFile(path.join(source, '0-trace.network'), [snapshot('2026-10-21T22:00:00Z'), snapshot('2026-10-21T22:24:50.751Z')].map(JSON.stringify).join('\n'));
    const zip = path.join(root, 'test-results/trace.zip');
    execFileSync('zip', ['-q', zip, '0-trace.network', `resources/${sha}`], { cwd: source });
    const run = { ...result(), attachments: [{ name: 'trace', path: zip }] };
    const evidence = await collectGenerationEvidence(run, root);
    assert.equal(evidence.records.length, 1);
    assert.equal(evidence.startedAt, '2026-10-21T22:24:50.751Z');
    assert.equal(evidence.records[0].taskId, '3815068');
    assert.deepEqual(evidence.records[0].traceIds,['3502f5e1037f39ca8867ef4726ff758f','header-trace']);
    assert.deepEqual(evidence.records[0].requestIds,['request-123']);
    assert.doesNotMatch(JSON.stringify(evidence),/old-trace/);
    assert.match(formatGenerationEvidence(evidence), /06:24:50/);
    // Even when the body is unavailable, keep only header IDs from this attempt.
    const headerOnly=snapshot('2026-10-21T22:24:50.751Z');
    delete headerOnly.snapshot.response.content._sha1;
    await writeFile(path.join(source,'0-trace.network'),JSON.stringify(headerOnly));
    const headerZip=path.join(root,'test-results/header-only.zip');
    execFileSync('zip',['-q',headerZip,'0-trace.network'],{cwd:source});
    const headers=await collectGenerationEvidence({...result(),attachments:[{name:'trace',path:headerZip}]},root);
    assert.equal(headers.records[0].taskId,null);
    assert.deepEqual(headers.records[0].traceIds,['header-trace']);
    assert.match(headers.gap,/未采集到可解析的生成任务事件/);
    await symlink(path.join(source, '0-trace.network'), path.join(root, 'test-results/outside.zip'));
    const rejected = await collectGenerationEvidence({ ...result(), attachments: [{ name: 'trace', path: path.join(root, 'test-results/outside.zip') }] }, root);
    assert.equal(rejected.records.length, 0);
    assert.ok(rejected.gap);
  } finally { await rm(root, { recursive: true, force: true }); }
});
