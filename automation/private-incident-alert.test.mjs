import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { incident, trustedRun, sendPrivateAlert } from './private-incident-alert.mjs';

const repo = 'duanzhiwei-arthur/sp_ui_test';
const run = { id: 123, run_attempt: 1, status: 'completed', conclusion: 'failure', created_at: '2026-11-25T03:00:00Z',
  head_sha: 'abcdef123456', path: '.github/workflows/ui-regression.yml', head_branch: 'main', repository: { full_name: repo }, head_repository: { full_name: repo } };
test('only allow trusted default-branch runs, never forks or other workflows', () => {
  assert.equal(trustedRun(run, repo), true);
  for (const override of [{ head_branch: 'feature' }, { head_repository: {full_name:'fork/repo'} }, { path: '.github/workflows/feishu-coding.yml' }, { status: 'in_progress' }]) {
    assert.equal(trustedRun({...run,...override}, repo), false);
  }
});
test('success, recovered runs and deliberate cancellations do not send extra private alerts', () => {
  for (const conclusion of ['success','cancelled','skipped']) assert.equal(incident({...run,conclusion}), null);
});
test('assertion failures are delivered privately even if group policy suppresses them', () => {
  const text = incident(run, [], {cases:[{title:'TC-01',status:'unexpected',error:'Locator: Create not found'}], recheck:{cases:[{title:'TC-01',finalStatus:'failed-on-recheck',firstReason:'Locator: old',secondReason:'Locator: Create not found'}]}});
  assert.match(text,/TC-01/); assert.match(text,/断言或交互/); assert.match(text,/failed-on-recheck/);
});
test('network and verification classification are retained without backend blame', () => {
  for (const [reason,label] of [['[SITE_VERIFICATION]','人机验证'],['net::ERR_CONNECTION_RESET','网络问题']]) {
    assert.match(incident(run,[],{cases:[{title:'TC-03',status:'unexpected',error:reason}]}),new RegExp(label));
  }
});
test('setup failure with no diagnostic still alerts with job and step', () => {
  const text=incident(run,[{name:'regression',conclusion:'failure',steps:[{name:'npm ci',conclusion:'failure'}]}]);
  assert.match(text,/npm ci/); assert.match(text,/诊断报告未取得/);
});
test('successful tests with a notification error still alert, and recovered cases are not called failures', () => {
  const text=incident({...run,conclusion:'success'},[],{notificationError:'send failed',cases:[{title:'TC-03',status:'unexpected',error:'old'}],recheck:{cases:[{title:'TC-03',finalStatus:'passed-on-recheck'}]}});
  assert.match(text,/结果通知异常/); assert.doesNotMatch(text,/用例：TC-03/);
});
test('retains explicit generation IDs and removes arbitrary secrets from reasons', () => {
  const text=incident(run,[],{cases:[{title:'TC-03',status:'unexpected',error:'[GENERATION_FAILED] token=secret-value https://private.invalid/x',generationEvidence:{records:[{taskId:4009974,assetId:4025463,traceIds:['0511488dbeb53fcaa223c226f8db82d5'],requestIds:['b48be519-4376-47fa-a79c-ea15bbb0c784-1793186946']}]}}]});
  assert.match(text,/Task ID：4009974/); assert.match(text,/Request ID：b48be519/);
  assert.doesNotMatch(text,/secret-value|private.invalid/);
});
const env={FEISHU_APP_ID:'app',FEISHU_APP_SECRET:'secret',FEISHU_PRIVATE_ALERT_OPEN_ID:'ou_owner'};
test('never sends to a group, and never issues a request with missing config', async () => {
  await assert.rejects(sendPrivateAlert({...env,FEISHU_PRIVATE_ALERT_OPEN_ID:'oc_group'},'text','key',()=>{throw Error('must not call')}),/open_id/);
  await assert.rejects(sendPrivateAlert({...env,FEISHU_APP_SECRET:''},'text','key'),/凭据/);
});
test('private delivery has stable per-run idempotency key and requires message ID', async () => {
  const calls=[];
  const fake=async (url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>url.includes('/auth/')?{code:0,tenant_access_token:'token'}:{code:0,data:{message_id:'om_ok'}}};};
  assert.equal(await sendPrivateAlert(env,'text','run:1',fake),'om_ok');
  await sendPrivateAlert(env,'text','run:1',fake);
  assert.equal(calls[1].body.uuid,calls[3].body.uuid); assert.match(calls[1].url,/receive_id_type=open_id/);
  assert.equal(calls[1].body.receive_id,'ou_owner');
  await assert.rejects(sendPrivateAlert(env,'text','run:2',async()=>({ok:true,json:async()=>({code:0,tenant_access_token:'token',data:{}})})),/消息ID/);
});
test('watcher has no install/test/dispatch steps, checks out trusted main, and has read-only permissions', () => {
  const yaml=readFileSync(new URL('../.github/workflows/private-incident-alert.yml',import.meta.url),'utf8');
  assert.match(yaml,/workflow_run:/); assert.match(yaml,/ref: main/); assert.match(yaml,/contents: read/);
  assert.doesNotMatch(yaml,/npm ci|npm run test|actions: write|ref:.*head_sha/);
});
