import { appendFileSync } from 'node:fs';
import { NotificationStateStore } from './notification-control.mjs';

// Evaluated immediately before result delivery, not before test execution.
// No cached state: commands issued while a test is running affect its result.
export async function shouldSendScheduledNotification(env, {
  createStore = (repo, token) => new NotificationStateStore(repo, token),
  warn = (message) => console.warn(message),
  summary = (message) => {
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${message}\n`);
  },
} = {}) {
  const scheduled = env.GITHUB_EVENT_NAME === 'schedule' || !!env.DISPATCH_DEDUPE_KEY?.trim();
  if (!scheduled) return true;
  // Private notifications are not controlled by a group's switch. Webhooks with
  // no identifiable group fail closed rather than bypassing a paused setting.
  const receiveType = env.FEISHU_RECEIVE_ID_TYPE?.trim() || 'open_id';
  const chatId = env.FEISHU_RECEIVE_ID?.trim() || '';
  if (receiveType !== 'chat_id' && (!env.FEISHU_WEBHOOK_URL?.trim() || env.FEISHU_APP_ID?.trim())) return true;
  let enabled;
  try {
    const store = createStore(env.GITHUB_REPOSITORY?.trim() || 'duanzhiwei-arthur/sp_ui_test',
      env.FEISHU_NOTIFICATION_TOKEN?.trim() || '');
    enabled = await store.isEnabled(chatId);
  } catch {
    // Never leak a token, remote response, or group id into build logs.
    const message = '[feishu] 无法确认定时通知开关，本次跳过群通知（测试结果不变）。请检查 FEISHU_NOTIFICATION_TOKEN、目标群和 Variables 读取权限。';
    warn(message);
    try { summary(message); } catch { /* Reporting must not affect test outcome. */ }
    return false;
  }
  if (!enabled) {
    const message = '[feishu] 本群定时通知已暂停；跳过结果卡片、定向提醒和失败视频，测试结果不变。';
    warn(message);
    try { summary(message); } catch { /* Reporting must not affect test outcome. */ }
  }
  return enabled;
}
