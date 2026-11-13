import fs from 'node:fs';
import path from 'node:path';

// Opt-in for the new dual-group run; existing unrelated entry points are unchanged.
export function reserveCanvasGeneration(purpose: string) {
  const file = process.env.CANVAS_PARITY_LEDGER;
  if (!file) return;
  if (!path.isAbsolute(file)) throw new Error('生成账本必须使用绝对路径');
  const lock = `${file}.lock`, fd = fs.openSync(lock, 'wx');
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
    const thisRemoteRun = process.env.GITHUB_ACTIONS === 'true' && Boolean(process.env.GITHUB_RUN_ID)
      && data.scope === 'run' && data.runId === process.env.GITHUB_RUN_ID;
    if ((data.scope === 'run' && !thisRemoteRun) || (!thisRemoteRun && data.date !== date) || !Number.isInteger(data.attempts) || data.attempts < 0 || !Array.isArray(data.entries)
      || !(data.limit === null || Number.isInteger(data.limit) && data.limit >= 0)) throw new Error('生成账本无效或已跨日，不重置已有用量');
    if (data.limit !== null && data.attempts >= data.limit) throw new Error('生成账本额度已用尽，不继续生成');
    data.attempts++;
    data.entries.push({ attempt: data.attempts, at: new Date().toISOString(), purpose, status: 'reserved', environment: process.env.CANVAS_PARITY_BASE_URL });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
