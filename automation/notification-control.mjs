// Generated from the hosted bot notification-control.ts; keep both copies in sync.
import { createHash } from 'node:crypto';
// The runner's automation/notification-control.mjs is generated from this file.
// GitHub repository variables survive app restarts and ephemeral Actions runners.
export function parseNotificationCommand(text) {
    const command = text.replace(/@_user_\d+/giu, ' ').trim()
        .replace(/[。！!]+$/u, '').replace(/^请\s*/u, '').trim();
    if (/^(?:停止|暂停|关闭)(?:通知|定时通知|定时任务)$/u.test(command))
        return 'pause';
    if (/^(?:开启|恢复|启动)(?:通知|定时通知|定时任务)$/u.test(command))
        return 'resume';
    if (/^(?:通知|定时通知|定时任务)状态$/u.test(command))
        return 'status';
    return null;
}
export function notificationVariableName(chatId) {
    if (!/^oc_[A-Za-z0-9_-]+$/u.test(chatId))
        throw new Error('通知开关需要有效的群 chat_id');
    return `FEISHU_NTFY_V1_${createHash('sha256').update(chatId).digest('hex').slice(0, 32).toUpperCase()}`;
}
export class NotificationStateStore {
    token;
    request;
    baseUrl;
    constructor(repository, token, request = fetch) {
        this.token = token;
        this.request = request;
        if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) ||
            repository.split('/').some((part) => part === '.' || part === '..')) {
            throw new Error('通知开关仓库配置无效');
        }
        if (!token.trim())
            throw new Error('FEISHU_NOTIFICATION_TOKEN 未配置');
        this.baseUrl = `https://api.github.com/repos/${repository}/actions/variables`;
    }
    async isEnabled(chatId) {
        const response = await this.call(`/${notificationVariableName(chatId)}`);
        // Only a confirmed missing variable defaults to enabled. Auth/server errors
        // and invalid data must never masquerade as a successfully read setting.
        if (response.status === 404) {
            // GitHub also returns 404 for inaccessible repositories. Check collection
            // access before interpreting a missing variable as the default setting.
            const access = await this.call('?per_page=1');
            if (!access.ok)
                throw new Error(`通知开关读取失败：HTTP ${access.status}`);
            return true;
        }
        if (!response.ok)
            throw new Error(`通知开关读取失败：HTTP ${response.status}`);
        const body = await response.json();
        if (typeof body !== 'object' || body === null || !('value' in body) ||
            (body.value !== 'enabled' && body.value !== 'paused')) {
            throw new Error('通知开关数据无效');
        }
        return body.value === 'enabled';
    }
    async setEnabled(chatId, enabled) {
        const name = notificationVariableName(chatId);
        const body = JSON.stringify({ name, value: enabled ? 'enabled' : 'paused' });
        let response = await this.call(`/${name}`, { method: 'PATCH', body });
        if (response.status === 404) {
            response = await this.call('', { method: 'POST', body });
            // Two first commands can race to create the same group's variable.
            if (response.status === 409 || response.status === 422) {
                response = await this.call(`/${name}`, { method: 'PATCH', body });
            }
        }
        if (!response.ok)
            throw new Error(`通知开关保存失败：HTTP ${response.status}`);
    }
    call(path, init = {}) {
        return this.request(`${this.baseUrl}${path}`, {
            ...init,
            headers: {
                accept: 'application/vnd.github+json',
                authorization: `Bearer ${this.token}`,
                'content-type': 'application/json',
                'x-github-api-version': '2022-11-28',
            },
            signal: AbortSignal.timeout(5_000),
        });
    }
}
