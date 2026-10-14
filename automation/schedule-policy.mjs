// Shared by the external timer and the GitHub Actions fallback. No network or writes.
export const fallbackCron = '30 * * * *';
export const maxDelayMinutes = 59;

export function beijingClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

export function scheduledSlot({ now = new Date(), key = '', cron = '' } = {}) {
  const clock = beijingClock(now);
  if (cron && cron !== fallbackCron) throw new Error(`未知兜底 cron：${cron}`);

  const currentKey = `hourly-${clock.date}-${String(clock.hour).padStart(2, '0')}`;
  if (key) {
    const match = /^hourly-(\d{4}-\d{2}-\d{2})-(\d{2})$/.exec(key);
    if (!match || Number(match[2]) > 23) throw new Error('dedupe_key 格式无效');
    if (key !== currentKey) return { skip: true, reason: '过期的小时档', key };
  } else {
    key = currentKey;
  }
  if (clock.minute > maxDelayMinutes) return { skip: true, reason: '超过计划时间 59 分钟', key };
  return { skip: false, key, hour: clock.hour, reason: '在本小时执行窗口内' };
}
