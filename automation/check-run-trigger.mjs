import { appendFileSync } from 'node:fs';
import { scheduledSlot } from './schedule-policy.mjs';

const env = process.env;
const output = (name, value) => appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
const summary = (message) => {
  console.log(`[scheduler] ${message}`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `调度检查：${message}\n\n`);
};
// Only an explicit successful check permits testing. Network/validation errors fail closed.
output('duplicate', 'true');
const eventId = env.FEISHU_EVENT_ID || '';
if (eventId && !/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) throw new Error('无效 event_id');
output('safe_event_id', eventId);
let slotKey = env.DISPATCH_DEDUPE_KEY || '';
if (env.EVENT_NAME === 'schedule' || slotKey) {
  if (eventId) throw new Error('不能混用实验消息和定时执行标识');
  const schedule = scheduledSlot({
    key: slotKey,
    cron: env.EVENT_NAME === 'schedule' ? env.SCHEDULE_CRON : ''
  });
  if (schedule.skip) {
    summary(`${schedule.reason}：${schedule.key}；未执行用例。`);
    output('slot_key', '');
    process.exit(0);
  }
  slotKey = schedule.key;
}
output('slot_key', slotKey);
for (const name of [eventId && `feishu-event-${eventId}`, slotKey && `run-marker-${slotKey}`].filter(Boolean)) {
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=100`,
    { headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000) }
  );
  if (!response.ok) throw new Error(`去重查询失败：HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.artifacts)) throw new Error('去重查询响应格式错误');
  if (data.artifacts.some(item => item.name === name && !item.expired)) {
    summary(`已执行，跳过：${name}；未重复生成。`);
    process.exit(0);
  }
}
output('duplicate', 'false');
summary(`允许执行：${slotKey || eventId || '手动请求'}。`);
