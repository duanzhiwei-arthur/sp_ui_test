import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduledSlot } from './schedule-policy.mjs';

test('上海每日两档和兜底使用相同 key，且不依赖宿主时区', () => {
  for (const [slot, utc, cron, fallbackUtc] of [
    ['am', '03:00', '30 3 * * *', '03:30'],
    ['pm', '10:30', '0 11 * * *', '11:00']
  ]) {
    const primary = scheduledSlot({ slot, now: new Date(`2026-09-20T${utc}:00Z`) });
    const fallback = scheduledSlot({ cron, now: new Date(`2026-09-20T${fallbackUtc}:00Z`) });
    assert.equal(primary.skip, false);
    assert.equal(fallback.skip, false);
    assert.equal(primary.key, fallback.key);
  }
});
test('不补跑数小时前、跨天或提前到达的事件，周末允许执行', () => {
  for (const options of [
    { cron: '30 3 * * *', now: new Date('2026-09-20T08:06:00Z') },
    { key: 'daily-2026-09-19-pm', now: new Date('2026-09-20T10:30:00Z') },
    { slot: 'pm', now: new Date('2026-09-20T03:00:00Z') },
    { now: new Date('2026-09-20T16:01:00Z') }
  ]) assert.equal(scheduledSlot(options).skip, true);
});
test('60 分钟边界和非法输入', () => {
  assert.equal(scheduledSlot({ slot: 'am', now: new Date('2026-09-20T04:00:00Z') }).skip, false);
  assert.equal(scheduledSlot({ slot: 'am', now: new Date('2026-09-20T04:01:00Z') }).skip, true);
  assert.throws(() => scheduledSlot({ key: 'daily-INVALID' }));
  assert.throws(() => scheduledSlot({ cron: '* * * * *' }));
  assert.throws(() => scheduledSlot({ slot: 'all' }));
});
