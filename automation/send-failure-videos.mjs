import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const sourceDir = path.resolve(process.env.FAILURE_VIDEO_DIR ?? 'failure-evidence');
const chatId = process.env.FEISHU_CHAT_ID?.trim() ?? '';
const appId = process.env.FEISHU_APP_ID?.trim() ?? '';
const appSecret = process.env.FEISHU_APP_SECRET?.trim() ?? '';
const sourceRunId = process.env.SOURCE_RUN_ID?.trim() ?? '';
const maxVideoBytes = 30 * 1024 * 1024;

if (!chatId || !appId || !appSecret) {
  throw new Error('缺少 FEISHU_CHAT_ID、FEISHU_APP_ID 或 FEISHU_APP_SECRET');
}

const token = await tenantAccessToken();
const videos = (await findVideos(sourceDir)).slice(0, 3);
if (videos.length === 0) {
  await sendCard('未找到失败视频', '本次失败运行没有生成可发送的录像。', 'orange');
  process.exit(0);
}

let sent = 0;
for (const [index, video] of videos.entries()) {
  const size = (await stat(video)).size;
  if (size > maxVideoBytes) {
    await sendCard('失败视频超过限制', `第 ${index + 1} 个失败视频超过飞书 30 MB 单文件限制，未发送。`, 'red');
    continue;
  }
  const fileKey = await uploadFile(video, `失败录像-${sourceRunId || 'unknown'}-${index + 1}.webm`);
  await sendMessage('file', { file_key: fileKey });
  sent += 1;
}

if (sent > 0) {
  console.log(`[feishu-evidence] 已向目标群发送 ${sent} 个失败视频。`);
}

async function findVideos(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name === 'video.webm')
    .map((entry) => path.join(entry.parentPath ?? entry.path ?? directory, entry.name));
}

async function tenantAccessToken() {
  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.json();
  if (!response.ok || !body.tenant_access_token) throw new Error(`飞书 token 获取失败：HTTP ${response.status}`);
  return body.tenant_access_token;
}

async function uploadFile(filePath, fileName) {
  const data = await readFile(filePath);
  const form = new FormData();
  form.append('file_type', 'stream');
  form.append('file_name', fileName);
  form.append('file', new Blob([data]), fileName);
  const response = await fetch('https://open.feishu.cn/open-apis/im/v1/files', {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
    signal: AbortSignal.timeout(120_000)
  });
  const body = await response.json();
  if (!response.ok || body.code !== 0 || !body.data?.file_key) {
    throw new Error(`失败视频上传失败：HTTP ${response.status}; ${body.msg ?? 'unknown'}`);
  }
  return body.data.file_key;
}

async function sendMessage(msgType, content) {
  const response = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ receive_id: chatId, msg_type: msgType, content: JSON.stringify(content) }),
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.code !== 0) throw new Error(`飞书消息发送失败：HTTP ${response.status}; ${body.msg ?? ''}`);
}

async function sendCard(title, content, template) {
  await sendMessage('interactive', {
    schema: '2.0',
    config: { update_multi: true, width_mode: 'default', summary: { content: title } },
    header: {
      title: { tag: 'plain_text', content: title },
      subtitle: { tag: 'plain_text', content: '自动化助手' },
      template,
      icon: { tag: 'standard_icon', token: template === 'red' ? 'warning_colorful' : 'notice_colorful' }
    },
    body: { direction: 'vertical', padding: '12px 12px 20px 12px', elements: [{ tag: 'markdown', content }] }
  });
}