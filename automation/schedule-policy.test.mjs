import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduledSlot } from './schedule-policy.mjs';

test('上海工作日两档和兜底使用相同 key，且不依赖宿主时区', () => {
  for (const [slot, utc, cron, fallbackUtc] of [
    ['am', '03:17', '47 3 * * 1-5', '03:47'],
    ['pm', '10:47', '17 11 * * 1-5', '11:17']
  ]) {
    const primary = scheduledSlot({ slot, now: new Date(`2026-09-17T${utc}:00Z`) });
    const fallback = scheduledSlot({ cron, now: new Date(`2026-09-17T${fallbackUtc}:00Z`) });
    assert.equal(primary.skip, false);
    assert.equal(fallback.skip, false);
    assert.equal(primary.key, fallback.key);
  }
});
test('不补跑数小时前、跨天、周末或提前到达的事件', () => {
  for (const options of [
    { cron: '47 3 * * 1-5', now: new Date('2026-09-17T08:06:00Z') },
    { key: 'daily-2026-09-16-pm', now: new Date('2026-09-17T10:47:00Z') },
    { slot: 'am', now: new Date('2026-09-19T03:17:00Z') },
    { slot: 'pm', now: new Date('2026-09-17T03:17:00Z') },
    { now: new Date('2026-09-17T16:01:00Z') }
  ]) assert.equal(scheduledSlot(options).skip, true);
});
test('60 分钟边界和非法输入', () => {
  assert.equal(scheduledSlot({ slot: 'am', now: new Date('2026-09-17T04:17:00Z') }).skip, false);
  assert.equal(scheduledSlot({ slot: 'am', now: new Date('2026-09-17T04:18:00Z') }).skip, true);
  assert.throws(() => scheduledSlot({ key: 'daily-INVALID' }));
  assert.throws(() => scheduledSlot({ cron: '* * * * *' }));
  assert.throws(() => scheduledSlot({ slot: 'all' }));
});
