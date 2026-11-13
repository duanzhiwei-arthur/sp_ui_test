import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCanvasResultCard, isCanvasTreatment } from './canvas-result-card.mjs';
const control = Array.from({length:6},(_,i)=>({title:`TC-0${i}: control`,status:'passed',gaCookie:{cookieValue:'GA1.1.10.20',cookieClientId:'10.20'}}));
const treatment = [{title:'EXP-TC-01：treatment',status:'passed',gaCookie:{cookieValue:'GA1.1.30.40',cookieClientId:'30.40'}}];
const input = {summary:{caseResults:[...control,...treatment],stats:{duration:1000}},testExitCode:0,finishedAt:new Date('2026-11-13T00:00:00Z'),runId:'123',headSha:'a'.repeat(40),runUrl:'https://github.com/owner/repo/actions/runs/123'};
test('manual full run displays eight cases including homepage checks in a third collapsed panel', () => {
  const extra = ['TC-001'].map(title => ({ title: `${title}: other`, status: 'passed' }));
  const summary = { ...input.summary, caseResults: [...control, ...treatment, ...extra] };
  const card = buildCanvasResultCard({ ...input, summary, allCases: true });
  assert.equal(card.header.template, 'green');
  assert.equal(card.body.elements.filter(e => e.tag === 'collapsible_panel').length, 5);
  for (const row of extra) assert.ok(JSON.stringify(card).includes(row.title));
  assert.equal(buildCanvasResultCard({ ...input, allCases: true }).header.template, 'red');
});
test('two collapsed groups contain six controls and one treatment, with GA values',()=>{
  const card=buildCanvasResultCard(input);
  const panels=card.body.elements.filter(e=>e.tag==='collapsible_panel');
  assert.equal(panels.length,4);assert.ok(panels.every(p=>p.expanded===false));
  assert.match(panels[0].header.title.content,/画板对照组 · 6\/6/);assert.match(panels[1].header.title.content,/画板实验组 · 1\/1/);
  const cookies = card.body.elements.find(e => e.element_id === 'gaCookies');
  assert.match(JSON.stringify(cookies),/cookieValue=GA1\.1\.10\.20/);assert.match(JSON.stringify(cookies),/cookieClientId=30\.40/);
  assert.doesNotMatch(JSON.stringify(panels.slice(0,2)), /cookieValue|cookieClientId/);
  assert.equal(isCanvasTreatment('TC-EXP-01: membership'),false);
  assert.equal(isCanvasTreatment('EXP-TC-02：retired'),false);
  assert.equal(card.header.template,'green');
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

test('failed reports show one concise summary and keep diagnostics collapsed', () => {
  const row = { ...treatment[0], status: 'failed' };
  const card = buildCanvasResultCard({ ...input, testExitCode: 1, summary: { ...input.summary,
    caseResults: [...control, row], failureDetails: [{ title: row.title, analysis: '2D view switch timeout' }] } });
  assert.equal(card.config.width_mode, 'compact');
  assert.match(card.header.title.content, /回归未通过/);
  for (const id of ['attention', 'runInfo', 'failureDetail', 'gaCookies']) assert.ok(card.body.elements.some(e => e.element_id === id), id);
  assert.equal(card.body.elements.some(e => e.element_id === 'metrics'), false);
  assert.match(JSON.stringify(card.body.elements.find(e => e.element_id === 'failureDetail')), /2D view switch timeout/);
  assert.ok(card.body.elements.filter(e => e.tag === 'collapsible_panel').every(e => e.expanded === false));
});

test('long errors are brief on the first screen while the original survives in diagnostics', () => {
  const reason = 'unabridged error ' + 'detail '.repeat(100);
  const row = { ...treatment[0], status: 'failed' };
  const card = buildCanvasResultCard({ ...input, testExitCode: 1, summary: { ...input.summary,
    caseResults: [...control, row], failureDetails: [{ title: row.title, reason }] } });
  const attention = card.body.elements.find(e => e.element_id === 'attention');
  assert.ok(attention.content.length < 180);
  assert.match(attention.content, /…/);
  assert.ok(JSON.stringify(card.body.elements.find(e => e.element_id === 'failureDetail')).includes(reason));
  const visible = card.body.elements.filter(e => e.tag !== 'collapsible_panel');
  assert.doesNotMatch(JSON.stringify(visible), /cookieValue|cookieClientId|unabridged error detail detail detail detail detail detail detail detail detail detail detail detail detail detail detail detail detail detail detail detail/);
});

test('read-only recovery remains visible and orange even without whole-case recheck', () => {
  const card = buildCanvasResultCard({ ...input, summary: { ...input.summary, caseResults: [...control, { ...treatment[0], readRetries: 1 }] } });
  assert.equal(card.header.template, 'orange'); assert.match(JSON.stringify(card), /只读操作重试/);
});
