import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildCompactSuccessCard} from './compact-success-card.mjs';

const input = () => ({ testExitCode:0, finishedAt:new Date('2026-10-22T07:37:33Z'), scope:'日常回归 · TC-00～TC-05',
  runId:'39739616960', headSha:'a'.repeat(40), runUrl:'https://github.com/owner/repo/actions/runs/39739616960',
  summary:{stats:{expected:6,unexpected:0,skipped:0,flaky:0,duration:1064000},reportErrors:[],failures:[],failureDetails:[],
    caseResults:[0,1,2,3,5,4].map(n=>({title:`TC-0${n}: test ${n}`,status:'passed'}))} });
test('approved success layout, collapsed details, single action and no preview wording',()=>{
  const card=buildCompactSuccessCard(input());
  assert.equal(card.config.width_mode,'compact');
  assert.equal(card.body.elements.length,3);
  assert.match(card.body.elements[0].content,/6\/6.*17分44秒/);
  assert.match(card.body.elements[0].content,/2026-10-22 15:37:33/);
  assert.equal(card.body.elements[1].expanded,false);
  assert.ok(card.body.elements[1].elements[0].content.indexOf('TC-04')<card.body.elements[1].elements[0].content.indexOf('TC-05'));
  assert.equal(card.body.elements[2].behaviors[0].default_url,input().runUrl);
  assert.doesNotMatch(JSON.stringify(card),/个人预览|尚未应用|<at/);
});
for(const field of ['unexpected','skipped','flaky'])test(`${field} retains detailed card`,()=>{
  const data=input();data.summary.stats[field]=1;assert.equal(buildCompactSuccessCard(data),null);
});
test('empty, unknown, inconsistent, report error and process error never render clean success',()=>{
  const variants=[data=>data.summary.caseResults=[], data=>data.summary.stats.expected=7,
    data=>data.summary.caseResults[0].status='unknown', data=>data.summary.readError='missing',
    data=>data.summary.reportErrors=[{message:'global error'}], data=>data.testExitCode=1,
    data=>data.summary.stats.duration=NaN, data=>data.runId=undefined];
  for(const mutate of variants){const data=input();mutate(data);assert.equal(buildCompactSuccessCard(data),null);}
});
test('homepage and experiment labels are preserved',()=>{
  for(const scope of ['首页按钮巡检 TC-001（无生成）','实验：会员实验']){
    const data=input();data.scope=scope;assert.equal(buildCompactSuccessCard(data).header.subtitle.content,scope);
  }
});
test('titles are escaped to prevent mentions and rich-content injection',()=>{
  const data=input();data.summary.caseResults[0].title='<at id=all>hi</at> *test*';
  assert.doesNotMatch(JSON.stringify(buildCompactSuccessCard(data)),/<at/);
});

test('recovered result is a compact warning, never disguised as a clean first pass',()=>{
  const data=input();
  data.summary.recheck={cases:[{title:data.summary.caseResults[0].title,finalStatus:'passed-on-recheck'}]};
  data.summary.caseResults[0].recovered=true;
  const card=buildCompactSuccessCard(data);
  assert.equal(card.header.template,'orange');
  assert.match(card.header.title.content,/复核通过/);
  assert.match(card.body.elements[0].content,/首次失败.*二次复核通过/);
  assert.doesNotMatch(JSON.stringify(card),/<at|failureDetail/);
});

test('real notification entry point selects compact success but keeps failure structure',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'compact-notify-test-'));
  try{
    for(const failed of [false,true]){
      const data=input();
      const report={stats:{...data.summary.stats,expected:failed?5:6,unexpected:failed?1:0},errors:[],
        suites:[{specs:data.summary.caseResults.map((c,index)=>({title:c.title,ok:!(failed&&index===0),tests:[{
          status:failed&&index===0?'unexpected':'expected',results:failed&&index===0?[{status:'failed',error:{message:'fixture error'},attachments:[]}]:[]
        }]}))}]};
      const file=path.join(dir,'results.json');await writeFile(file,JSON.stringify(report));
      const card=JSON.parse(execFileSync(process.execPath,['automation/run-and-notify.mjs','--notification-card-preview'],{
        encoding:'utf8',env:{...process.env,SCHEDULED_TEST_MODE:'daily',PLAYWRIGHT_RESULTS_FILE:file,GITHUB_RUN_ID:data.runId,
          GITHUB_SHA:data.headSha,GITHUB_REPOSITORY:'owner/repo',GITHUB_EVENT_NAME:'workflow_dispatch',DISPATCH_DEDUPE_KEY:''}
      }));
      assert.equal(card.config.width_mode,failed?'default':'compact');
      if(failed){assert.equal(card.header.template,'red');assert.ok(card.body.elements.some(e=>e.element_id==='failureDetail'));
        assert.ok(card.body.elements.some(e=>e.element_id==='actions'));}
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('real text and card previews retain first generation IDs after recovery and persistent failure',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'generation-first-notify-'));
  try{
    const title='TC-05: generation';
    const evidence={records:[{taskId:'4009974',assetId:'4025463',traceIds:['0511488dbeb53fcaa223c226f8db82d5'],
      requestIds:['b48be519-4376-47fa-a79c-ea15bbb0c784-1793186946']}],
      streams:[{businessErrors:[{errorCode:'1007',message:'internal LLM service image response must be one trusted stable URL token=private123 <at id=all>'}]}]};
    for(const recovered of [true,false]){
      const report={stats:{expected:0,unexpected:1,skipped:0,flaky:0,duration:1000},errors:[],
        suites:[{specs:[{title,ok:false,tests:[{status:'unexpected',results:[{status:'failed',error:{message:'[GENERATION_FAILED] first'},attachments:[]}]}]}]}],
        recheck:{cases:[{title,initialStatus:'failed',finalStatus:recovered?'passed-on-recheck':'failed-on-recheck',
          firstFailure:{title,reason:'[GENERATION_FAILED] first',generationEvidence:evidence},
          ...(!recovered?{secondFailure:{title,reason:'[GENERATION_FAILED] second',analysis:'second failure',generationEvidence:{records:[{taskId:'second-task',assetId:'second-asset',traceIds:['second-trace']}],streams:[]}}}:{})}]}};
      const file=path.join(dir,'results.json');await writeFile(file,JSON.stringify(report));
      for(const flag of ['--notification-card-preview','--notification-preview',...(!recovered?['--execution-record-preview']:[])]){
        const output=execFileSync(process.execPath,['automation/run-and-notify.mjs',flag],{encoding:'utf8',timeout:15000,
          env:{...process.env,PLAYWRIGHT_RESULTS_FILE:file,SCHEDULED_TEST_MODE:'daily',GITHUB_RUN_ID:'123',GITHUB_SHA:'a'.repeat(40),
            GITHUB_REPOSITORY:'owner/repo',GITHUB_EVENT_NAME:'workflow_dispatch',DISPATCH_DEDUPE_KEY:''}});
        for(const value of ['首次生成失败','4009974','4025463','0511488dbeb53fcaa223c226f8db82d5',
          'b48be519-4376-47fa-a79c-ea15bbb0c784-1793186946','错误码：1007','原始原因：internal LLM service'])assert.ok(output.includes(value),value);
        assert.doesNotMatch(output,/private123/);
        if(flag==='--notification-card-preview'){
          const card=JSON.parse(output);assert.equal(card.header.template,recovered?'orange':'red');
          assert.doesNotMatch(output,/<at/);
          if(recovered)assert.doesNotMatch(output,/failureDetail|second-task/);
          else assert.match(output,/二次生成失败：/);
        }
      }
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
