import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBrowserEvidence, formatBrowserEvidence } from './generation-browser-evidence.mjs';
import { collectGenerationEvidence, firstGenerationFailureMessages } from './generation-evidence.mjs';
import { sanitizeRunAssets } from './build-diagnostic-bundle.mjs';

const evidence = { timeline: [{ at:'2026-11-20T09:25:06.000Z',event:'asset_2d_done',taskId:'123',assetId:'456',secret:'bad' }],
  frontend: { available:true,progress:[{kind:'model',percent:95}],
    images:[{visible:false,complete:true,naturalWidth:1024,url:'https://private.test/x?token=secret'}],
    models:[{visible:true,loaded:false,status:503,url:'private'}] } };
test('browser evidence uses explicit allowlist and never claims server outcome', () => {
  const clean=sanitizeBrowserEvidence(evidence);
  assert.doesNotMatch(JSON.stringify(clean),/private|secret|token/);
  const text=formatBrowserEvidence(evidence).join('\n');
  assert.match(text,/model 95%/);assert.match(text,/HTTP=503/);
  assert.match(text,/不等于后台未结束/);
  assert.deepEqual(sanitizeRunAssets({browserEvidence:evidence}).browserEvidence,clean);
});
test('no browser evidence remains backward compatible',()=>{
  assert.equal(sanitizeBrowserEvidence(undefined),undefined);
  assert.deepEqual(formatBrowserEvidence(undefined),[]);
});
test('first-attempt browser evidence survives missing trace and successful recheck',async()=>{
  const result={status:'failed',startTime:'2026-11-20T09:25:00.000Z',duration:300000,
    error:{message:'[GENERATION_TIMEOUT] timed out'},attachments:[{name:'run-assets',body:Buffer.from(JSON.stringify({browserEvidence:evidence})).toString('base64')}]};
  const collected=await collectGenerationEvidence(result);
  const text=firstGenerationFailureMessages({recheck:{cases:[{title:'EXP-TC-01',finalStatus:'passed-on-recheck',
    firstFailure:{reason:result.error.message,generationEvidence:collected}}]}}).join('\n');
  assert.match(text,/二次复核通过/);assert.match(text,/asset_2d_done/);assert.match(text,/未主动查询后台终态/);
  assert.doesNotMatch(text,/private|secret/);
});
