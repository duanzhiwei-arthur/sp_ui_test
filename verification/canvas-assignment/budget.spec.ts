import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reserveCanvasGeneration } from '../../tests/fixtures/generation-budget.js';

test('shared local budget reserves before action, preserves entries and refuses exhausted/stale ledgers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-budget-check-'));
  const previous = process.env.CANVAS_PARITY_LEDGER;
  const file = path.join(dir, 'ledger.json'); process.env.CANVAS_PARITY_LEDGER = file;
  try {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
    fs.writeFileSync(file, JSON.stringify({ date, attempts: 1, limit: 2, entries: [{ purpose: 'existing' }] }));
    reserveCanvasGeneration('new');
    const result = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(result.attempts).toBe(2); expect(result.entries[0].purpose).toBe('existing');
    expect(() => reserveCanvasGeneration('denied')).toThrow('额度已用尽');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).attempts).toBe(2);
    fs.writeFileSync(file, JSON.stringify({ date: '2000-01-01', attempts: 0, limit: 2, entries: [] }));
    expect(() => reserveCanvasGeneration('stale')).toThrow('已跨日');
    expect(fs.existsSync(file + '.lock')).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.CANVAS_PARITY_LEDGER; else process.env.CANVAS_PARITY_LEDGER = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('remote per-run budget can cross midnight but cannot reuse a different run ledger', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-run-budget-check-'));
  const previous = { ledger: process.env.CANVAS_PARITY_LEDGER, actions: process.env.GITHUB_ACTIONS, run: process.env.GITHUB_RUN_ID };
  const file = path.join(dir, 'ledger.json');
  Object.assign(process.env, { CANVAS_PARITY_LEDGER: file, GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: 'test-run' });
  try {
    fs.writeFileSync(file, JSON.stringify({ scope: 'run', runId: 'test-run', date: '2000-01-01', attempts: 0, limit: 12, entries: [] }));
    reserveCanvasGeneration('after midnight'); expect(JSON.parse(fs.readFileSync(file, 'utf8')).attempts).toBe(1);
    process.env.GITHUB_RUN_ID = 'different-run'; expect(() => reserveCanvasGeneration('wrong run')).toThrow('已跨日');
  } finally {
    for (const [key, value] of Object.entries({ CANVAS_PARITY_LEDGER: previous.ledger, GITHUB_ACTIONS: previous.actions, GITHUB_RUN_ID: previous.run })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
