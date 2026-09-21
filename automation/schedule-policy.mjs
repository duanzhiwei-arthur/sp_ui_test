// Shared by the external timer and the workflow fallback. No network or writes.
export const slots = { am: 11 * 60, pm: 18 * 60 + 30 };
export const fallbackSlots = { '30 3 * * *': 'am', '0 11 * * *': 'pm' };
export const maxDelayMinutes = 60;

export function beijingClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

export function scheduledSlot({ now = new Date(), slot, key = '', cron = '' } = {}) {
  const clock = beijingClock(now);
  if (cron) {
    slot = fallbackSlots[cron];
    if (!slot) throw new Error(`未知兜底 cron：${cron}`);
  }
  if (key) {
    const match = /^daily-(\d{4}-\d{2}-\d{2})-(am|pm)$/.exec(key);
    if (!match) throw new Error('dedupe_key 格式无效');
    slot = match[2];
    if (match[1] !== clock.date) return { skip: true, reason: '过期的计划日期', key };
  }
  if (!slot) {
    slot = Object.keys(slots).find(name => clock.minute >= slots[name] &&
      clock.minute <= slots[name] + maxDelayMinutes);
    if (!slot) return { skip: true, reason: '不在定时执行窗口', key: '' };
  }
  if (!Object.hasOwn(slots, slot)) throw new Error('slot 仅支持 am 或 pm');
  key ||= `daily-${clock.date}-${slot}`;
  const delay = clock.minute - slots[slot];
  if (delay < 0 || delay > maxDelayMinutes) {
    return { skip: true, reason: '超过计划时间 60 分钟', key };
  }
  return { skip: false, key, slot, reason: '在执行窗口内' };
}
