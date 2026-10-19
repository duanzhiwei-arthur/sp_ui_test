import { appendFileSync } from 'node:fs';

const env = process.env;
const output = (name, value) => appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
const summary = (message) => {
  console.log(`[homepage-clickable-scheduler] ${message}`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `TC-001 调度检查：${message}\n\n`);
};

output('duplicate', 'true');
let slotKey = env.DISPATCH_DEDUPE_KEY || '';
const clock = beijingClock();
const currentKey = `homepage-clickable-${clock.date}`;

if (slotKey) {
  if (!/^homepage-clickable-\d{4}-\d{2}-\d{2}$/.test(slotKey)) throw new Error('TC-001 dedupe_key 格式无效');
  if (slotKey !== currentKey) {
    output('slot_key', '');
    summary(`过期日期档 ${slotKey}，当前为 ${currentKey}；不执行。`);
    process.exit(0);
  }
} else if (env.EVENT_NAME === 'schedule') {
  slotKey = currentKey;
} else {
  output('slot_key', '');
  output('duplicate', 'false');
  summary('手动验证不占用当天 18:00 定时档。');
  process.exit(0);
}

// Miaoda runs at 18:00. GitHub schedule is the 18:30 fallback. Reject a
// severely delayed schedule so it cannot run on the next business day.
if (env.EVENT_NAME === 'schedule' && (clock.hour < 18 || clock.hour > 23)) {
  output('slot_key', '');
  summary(`GitHub 兜底已超出北京时间当日 18:00～23:59 窗口；不执行。`);
  process.exit(0);
}

output('slot_key', slotKey);
const markerName = `run-marker-${slotKey}`;
const response = await fetch(
  `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/artifacts?name=${encodeURIComponent(markerName)}&per_page=100`,
  {
    headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10_000)
  }
);
if (!response.ok) throw new Error(`TC-001 去重查询失败：HTTP ${response.status}`);
const data = await response.json();
if (!Array.isArray(data.artifacts)) throw new Error('TC-001 去重查询响应格式错误');
if (data.artifacts.some((item) => item.name === markerName && !item.expired)) {
  output('slot_key', '');
  summary(`当日已执行，跳过：${markerName}`);
  process.exit(0);
}

output('duplicate', 'false');
summary(`允许执行：${slotKey}`);

function beijingClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}
