import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS_CASE_IDS, CANVAS_MAX_GENERATIONS_PER_RUN, hasCompleteCanvasScope, isCanvasTreatment, ALL_CASE_IDS, hasCompleteAllScope } from './canvas-scope.mjs';

const cases = CANVAS_CASE_IDS.map(title => ({ title: `${title}：case`, status: 'passed' }));
test('manual full run requires all eight distinct retained IDs', () => {
  const all = ALL_CASE_IDS.map(title => ({ title: `${title}: case`, status: 'passed' }));
  assert.equal(all.length, 8);
  assert.equal(hasCompleteAllScope(all), true);
  assert.equal(hasCompleteAllScope(cases), false);
  assert.equal(hasCompleteAllScope([...all.slice(0, -1), all[0]]), false);
});
test('canvas scope is exactly six unchanged controls and EXP-TC-01', () => {
  assert.deepEqual(CANVAS_CASE_IDS, ['TC-00','TC-01','TC-02','TC-03','TC-04','TC-05','EXP-TC-01']);
  assert.equal(CANVAS_MAX_GENERATIONS_PER_RUN, 8);
  assert.equal(hasCompleteCanvasScope(cases), true);
  for (const title of ['EXP-TC-02','EXP-TC-03','EXP-TC-04','EXP-TC-05','TC-EXP-01']) assert.equal(isCanvasTreatment(`${title}: case`), false);
});
test('missing, duplicate or retired cases cannot make a complete seven-case report', () => {
  for (const rows of [cases.slice(1), [...cases.slice(0,-1),cases[0]], [...cases,{title:'EXP-TC-02: retired'}], [...cases.slice(0,-1),{title:'EXP-TC-02: retired'}]]) {
    assert.equal(hasCompleteCanvasScope(rows), false);
  }
});
