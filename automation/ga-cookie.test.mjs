import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gaCookieRows } from './ga-cookie.mjs';
import { mergeRecheckResult, finalSummary } from './failure-recheck.mjs';

test('复核后卡片保留首次和复核各自Cookie，不借值、不改业务状态', () => {
  const item={title:'TC-001',file:'tests/home-clickable.spec.ts',status:'failed',gaCookie:{cookieValue:'GA1.1.10.20',cookieClientId:'10.20'}};
  const merged=finalSummary(mergeRecheckResult({caseResults:[item]}, {caseResults:[{...item,status:'passed',gaCookie:{cookieValue:'GA1.1.30.40',cookieClientId:'30.40'}}]}, [item]));
  const rows=gaCookieRows(merged);
  assert.equal(rows.length,2);assert.match(rows[0].title,/首次/);assert.equal(rows[0].cookieClientId,'10.20');
  assert.match(rows[1].title,/复核/);assert.equal(rows[1].cookieClientId,'30.40');
  merged.recheck.cases[0].secondGaCookie=null;
  assert.equal(gaCookieRows(merged)[1].cookieValue,'未采集');assert.equal(merged.caseResults[0].status,'passed');
});

test('真实通知入口的成功/失败/TC-001/全量/复核卡片均包含两个字段（仅预览）',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ga-card-contract-'));
  try {
    for (const mode of ['daily','homepage-clickable','all']) for (const failed of [false,true]) for(const rechecked of [false,true]) {
      const title=mode==='homepage-clickable'?'TC-001: 巡检':'TC-03: 加购';
      const attachment={name:'ga-cookie-diagnostics',body:Buffer.from(JSON.stringify({cookieValue:'GA1.1.10.20',cookieClientId:'10.20'})).toString('base64')};
      const report={stats:{expected:failed?0:1,unexpected:failed?1:0,flaky:0,skipped:0,duration:1000},errors:[],suites:[{specs:[{title,tests:[{status:failed?'unexpected':'expected',results:[{status:failed?'failed':'passed',error:failed?{message:'fixture failure'}:undefined,attachments:[attachment]}]}]}]}],
        ...(rechecked?{recheck:{cases:[{title,finalStatus:failed?'failed-on-recheck':'passed-on-recheck',firstGaCookie:{cookieValue:'GA1.1.10.20',cookieClientId:'10.20'},secondGaCookie:{cookieValue:'GA1.1.30.40',cookieClientId:'30.40'}}]}}:{})};
      const file=path.join(dir,'results.json');await writeFile(file,JSON.stringify(report));
      const text=execFileSync(process.execPath,['automation/run-and-notify.mjs','--notification-card-preview'],{encoding:'utf8',timeout:15000,env:{...process.env,SCHEDULED_TEST_MODE:mode,EXPERIMENT_KEY:'membership',GITHUB_EVENT_NAME:'workflow_dispatch',DISPATCH_DEDUPE_KEY:'',PLAYWRIGHT_RESULTS_FILE:file,GITHUB_RUN_ID:'12345',GITHUB_SHA:'a'.repeat(40),GITHUB_REPOSITORY:'owner/repo'}});
      const card=JSON.parse(text);assert.match(text,/GA Cookie诊断/);assert.match(text,/cookieValue=GA1\.1\.10\.20/);assert.match(text,/cookieClientId=10\.20/);
      if(rechecked){assert.match(text,/cookieClientId=30\.40/);assert.match(text,/复核/);}
      assert.equal(card.header.template,failed?'red':rechecked?'orange':'green');
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});
