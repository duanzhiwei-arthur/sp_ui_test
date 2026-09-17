#!/usr/bin/env node

/**
 * 方案 A 的云端定时器执行体：按计划提交远端回归（不保证秒级启动）。
 *
 * 由云端定时器（云 VM 的 cron / systemd timer、妙搭定时任务、云函数定时触发等）
 * 在每个计划时刻调用本脚本：到点用 workflow_dispatch 立即触发远端回归，
 * 绕过 GitHub 原生 schedule 事件的负载延迟。
 *
 * 用法：
 *   node automation/dispatch-scheduled-run.mjs --slot am     # 11:17 那一档
 *   node automation/dispatch-scheduled-run.mjs --slot pm     # 18:47 那一档
 *   node automation/dispatch-scheduled-run.mjs --dry-run     # 只打印，不触发
 *
 * 需要环境变量（见 .env.example）：
 *   GITHUB_TOKEN（必须，至少 actions:write）
 *   GITHUB_REPOSITORY / GITHUB_WORKFLOW_FILE / GITHUB_REF（可选，有默认值）
 *
 * 幂等：每个 (date, slot) 只触发一次。本脚本写出的 dedupe_key 与 workflow 内的
 * run-marker artifact 在全局串行 workflow 下防止重复执行；标记保留 14 天。
 */

import 'dotenv/config';
import { scheduledSlot } from './schedule-policy.mjs';

const repository = process.env.GITHUB_REPOSITORY?.trim() || 'duanzhiwei-arthur/sp_ui_test';
const workflow = process.env.GITHUB_WORKFLOW_FILE?.trim() || 'ui-regression.yml';
const ref = process.env.GITHUB_REF?.trim() || 'main';
const mode = 'daily';
const token = process.env.GITHUB_TOKEN?.trim();

const args = parseArgs(process.argv.slice(2));
const schedule = scheduledSlot({ slot: args.slot });
const dedupeKey = schedule.key;

if (process.env.SCHEDULED_DISPATCH_MODE && process.env.SCHEDULED_DISPATCH_MODE !== 'daily') {
  throw new Error('定时入口只允许 daily；实验请使用飞书命令或手动执行');
}
if (schedule.skip) {
  console.log(`[scheduler] 跳过：${schedule.reason}`);
  process.exit(0);
}

if (args.dryRun) {
  console.log(`[dry-run] 将触发 workflow ${workflow}（${mode}，dedupe_key=${dedupeKey}）`);
  process.exit(0);
}

if (!token) {
  throw new Error('需要配置 GITHUB_TOKEN（至少具备 actions:write，见 .env.example）');
}

if (await markerExists(dedupeKey)) {
  console.log(`[${stamp()}] ${dedupeKey} 已处理，跳过触发。`);
  process.exit(0);
}

for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    await dispatch({ mode, dedupeKey });
    console.log(`[${stamp()}] 远端 workflow_dispatch 已提交（${mode}，${dedupeKey}）。`);
    process.exit(0);
  } catch (error) {
    console.error(`[${stamp()}] 触发失败（第 ${attempt} 次）：${error.message}`);
    if (attempt < 3) {
      await sleep(15_000);
    }
  }
}
console.error(`[${stamp()}] 远端 workflow_dispatch 连续 3 次提交失败。`);
process.exit(1);

function parseArgs(raw) {
  const result = {};
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i];
    if (value === '--dry-run') result.dryRun = true;
    else if (value === '--slot' && raw[i + 1]) result.slot = raw[++i];
    else throw new Error(`未知参数：${value}`);
  }
  return result;
}

function stamp() {
  return new Date().toISOString();
}

function authHeaders() {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28'
  };
}

async function markerExists(key) {
  const url = `https://api.github.com/repos/${repository}/actions/artifacts?name=${encodeURIComponent(`run-marker-${key}`)}&per_page=1`;
  const response = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`查询 dedupe 标记失败（HTTP ${response.status}）：${(await response.text()).slice(0, 300)}`);
  }
  const body = await response.json();
  return Number(body.total_count ?? 0) > 0;
}

async function dispatch({ mode: runMode, dedupeKey: key }) {
  const url = `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({
      ref,
      inputs: { mode: runMode, dedupe_key: key, simulate_failure_record: 'false' }
    })
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}：${(await response.text()).slice(0, 500)}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
