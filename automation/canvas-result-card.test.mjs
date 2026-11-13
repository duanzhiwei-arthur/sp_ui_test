import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCanvasResultCard, isCanvasTreatment } from './canvas-result-card.mjs';
const control = Array.from({length:6},(_,i)=>({title:`TC-0${i}: control`,status:'passed',gaCookie:{cookieValue:'GA1.1.10.20',cookieClientId:'10.20'}}));
const treatment = Array.from({length:5},(_,i)=>({title:`EXP-TC-0${i+1}：treatment`,status:'passed',gaCookie:{cookieValue:'GA1.1.30.40',cookieClientId:'30.40'}}));
const input = {summary:{caseResults:[...control,...treatment],stats:{duration:1000}},testExitCode:0,finishedAt:new Date('2026-11-13T00:00:00Z'),runId:'123',headSha:'a'.repeat(40),runUrl:'https://github.com/owner/repo/actions/runs/123'};
test('two collapsed groups contain all eleven cases and GA values, without mixing membership',()=>{
  const card=buildCanvasResultCard(input);
  const panels=card.body.elements.filter(e=>e.tag==='collapsible_panel');
  assert.equal(panels.length,2);assert.ok(panels.every(p=>p.expanded===false));
  assert.match(panels[0].header.title.content,/画板对照组 · 6\/6/);assert.match(panels[1].header.title.content,/画板实验组 · 5\/5/);
  assert.match(JSON.stringify(panels[0]),/cookieValue=GA1\.1\.10\.20/);assert.match(JSON.stringify(panels[1]),/cookieClientId=30\.40/);
  assert.equal(isCanvasTreatment('TC-EXP-01: membership'),false);
});
test('failed or recovered generation retains first/second diagnostics inside its group',()=>{
  const row=treatment[0];
  for(const recovered of [false,true]){
    const review={title:row.title,firstGaCookie:{cookieValue:'first',cookieClientId:'1'},secondGaCookie:{cookieValue:'second',cookieClientId:'2'},finalStatus:recovered?'passed-on-recheck':'failed-on-recheck',firstFailure:{title:row.title,reason:'[GENERATION_FAILED] first'},secondFailure:{title:row.title,reason:'second'}};
    const card=buildCanvasResultCard({...input,testExitCode:recovered?0:1,summary:{...input.summary,caseResults:[...control,{...row,status:recovered?'passed':'failed'},...treatment.slice(1)],recheck:{cases:[review]},failureDetails:recovered?[]:[review.secondFailure]}});
    assert.equal(card.header.template,recovered?'orange':'red');
    const text=JSON.stringify(card);for(const value of ['first','cookieValue=first','cookieValue=second','首次原因'])assert.ok(text.includes(value));
    if(!recovered)assert.match(text,/second/);
  }
});

test('missing group or skipped cases cannot produce a green card',()=>{
  for(const rows of [control, [...control, ...treatment.slice(1)], [...control,...treatment.map(r=>({...r,status:'skipped'}))]]) {
    assert.equal(buildCanvasResultCard({...input, summary:{...input.summary,caseResults:rows}}).header.template,'red');
  }
});
