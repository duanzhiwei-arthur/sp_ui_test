import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduledSlot } from './schedule-policy.mjs';

test('上海每小时主触发和半小时兜底使用相同 key', () => {
  const primary = scheduledSlot({ now: new Date('2026-10-14T03:00:00Z') });
  const fallback = scheduledSlot({ cron: '30 * * * *', now: new Date('2026-10-14T03:30:00Z') });
  assert.equal(primary.skip, false);
  assert.equal(fallback.skip, false);
  assert.equal(primary.key, 'hourly-2026-10-14-11');
  assert.equal(primary.key, fallback.key);
});
test('周末和跨日小时档正常生成独立 key', () => {
  assert.equal(scheduledSlot({ now: new Date('2026-10-17T15:30:00Z') }).key, 'hourly-2026-10-17-23');
  assert.equal(scheduledSlot({ now: new Date('2026-10-17T16:00:00Z') }).key, 'hourly-2026-10-18-00');
});
test('过期小时档和非法输入会被拒绝', () => {
  assert.equal(scheduledSlot({
    key: 'hourly-2026-10-14-10', now: new Date('2026-10-14T03:05:00Z')
  }).skip, true);
  assert.throws(() => scheduledSlot({ key: 'daily-2026-10-14-am' }));
  assert.throws(() => scheduledSlot({ key: 'hourly-2026-10-14-24' }));
  assert.throws(() => scheduledSlot({ cron: '0 11 * * *' }));
});
