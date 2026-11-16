import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCanvasResultCard } from './canvas-result-card.mjs';
import { buildCompactSuccessCard } from './compact-success-card.mjs';

const rows = [...Array.from({ length: 6 }, (_, i) => ({ title: `TC-0${i}: control`, status: 'passed' })),
  { title: 'EXP-TC-01: treatment', status: 'passed' }];
const base = { testExitCode: 0, finishedAt: new Date('2026-11-16T01:00:00Z'),
  scope: 'test', runId: '123', headSha: 'a'.repeat(40), runUrl: 'https://github.com/owner/repo/actions/runs/123' };
for (const [name, build] of [['canvas', buildCanvasResultCard], ['compact', buildCompactSuccessCard]]) {
  for (const recovered of [false, true]) for (const readRetries of [0, 2]) {
    test(`${name}: recovered=${recovered}, localRetries=${readRetries} uses only two success presentations`, () => {
      const summary = { caseResults: rows.map((row, i) => ({ ...row, readRetries: i === 0 ? readRetries : 0 })),
        stats: { expected: 7, unexpected: 0, skipped: 0, flaky: 0, duration: 1000 },
        ...(recovered ? { recheck: { cases: [{ title: rows[0].title, finalStatus: 'passed-on-recheck',
          firstFailure: { reason: 'original failure' } }] } } : {}) };
      const card = build({ ...base, summary });
      assert.equal(card.header.template, recovered ? 'orange' : 'green');
      assert.equal(card.header.title.content, `JuJuBit · ${recovered ? '复核通过' : '回归通过'}`);
      const panels = card.body.elements.filter(e => e.tag === 'collapsible_panel');
      const outside = card.body.elements.filter(e => e.tag !== 'collapsible_panel');
      if (readRetries) {
        assert.match(JSON.stringify(panels), /只读操作.*重试/);
        assert.doesNotMatch(JSON.stringify(outside), /只读操作.*重试/);
      }
      assert.ok(panels.every(e => e.expanded === false));
      assert.equal(summary.caseResults[0].readRetries, readRetries);
    });
  }
}
test('failed or incomplete canvas reports remain red even with local recovery', () => {
  for (const caseResults of [rows.slice(1), rows.map((row, i) => ({ ...row, status: i ? 'passed' : 'failed', readRetries: 1 }))]) {
    assert.equal(buildCanvasResultCard({ ...base, testExitCode: 1, summary: { caseResults } }).header.template, 'red');
  }
});
