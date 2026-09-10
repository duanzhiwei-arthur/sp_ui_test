#!/usr/bin/env node

/**
 * Feishu @bot command adapter.
 *
 * Feed one decoded im.message.receive_v1 event as JSON on stdin. When the
 * message contains "会员实验", dispatch the remote GitHub Actions workflow
 * in experiment mode. This process is intentionally stateless and can run in
 * a cloud function/container; it does not require the developer laptop.
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';

const repository = process.env.GITHUB_REPOSITORY?.trim() || 'duanzhiwei-arthur/sp_ui_test';
const workflow = process.env.GITHUB_WORKFLOW_FILE?.trim() || 'ui-regression.yml';
const ref = process.env.GITHUB_REF?.trim() || 'main';
const githubToken = process.env.GITHUB_TOKEN?.trim();
const registry = JSON.parse(readFileSync(new URL('./experiment-command-registry.json', import.meta.url), 'utf8'));

const input = await readStdin();
let event;
try {
  event = JSON.parse(input);
} catch {
  throw new Error('stdin 必须是已解码的飞书 im.message.receive_v1 JSON');
}

const content = String(event.content ?? '').replace(/\s+/g, ' ').trim();
const command = parseExperimentCommand(content);

if (!command || event.sender_type === 'bot') {
  console.log(JSON.stringify({ ok: true, handled: false, message: '未识别实验命令' }));
  process.exit(0);
}

if (!githubToken) {
  throw new Error('需要配置 GITHUB_TOKEN（至少具备 actions:write）');
}

await dispatchWorkflow({
  repository,
  workflow,
  ref,
  token: githubToken,
  experiment: command.key,
  chatId: String(event.chat_id ?? '').trim(),
  eventId: String(event.event_id ?? '').trim()
});

const result = {
  ok: true,
  handled: true,
  experiment: command.key,
  message: `已触发${command.label}，将执行 Control + Treatment 用例并回传结果。`
};

// Optional immediate acknowledgement. The final pass/fail card is sent by the
// workflow after Playwright completes, so this is safe to omit in integrations
// that already acknowledge webhook requests themselves.
if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET && event.chat_id) {
  await replyToFeishu(event, result.message);
}

console.log(JSON.stringify(result));

function parseExperimentCommand(contentText) {
  const normalized = contentText
    .replace(/@_user_\d+/giu, ' ')
    .replace(/[：:，,。.!！?？]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:请)?(?:执行|运行|触发)\s*/u, '');
  for (const experiment of registry.experiments ?? []) {
    if (experiment.enabled && experiment.aliases?.includes(normalized)) {
      return experiment;
    }
  }
  return null;
}

async function dispatchWorkflow({ repository: repo, workflow: workflowFile, ref: branch, token, experiment, chatId, eventId }) {
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ ref: branch, inputs: { mode: 'experiment', experiment, chat_id: chatId, event_id: eventId } })
  });
  if (!response.ok) {
    throw new Error(`GitHub workflow dispatch 失败（HTTP ${response.status}）：${(await response.text()).slice(0, 500)}`);
  }
}

async function replyToFeishu(event, text) {
  const tokenResponse = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: process.env.FEISHU_APP_ID, app_secret: process.env.FEISHU_APP_SECRET })
  });
  const tokenBody = await tokenResponse.json();
  if (!tokenBody.tenant_access_token) {
    throw new Error('飞书未返回 tenant_access_token');
  }
  const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(event.message_id || event.id)}/reply`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tokenBody.tenant_access_token}`,
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({ msg_type: 'text', content: JSON.stringify({ text }) })
  });
  if (!response.ok) {
    throw new Error(`飞书回复失败（HTTP ${response.status}）：${(await response.text()).slice(0, 500)}`);
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { value += chunk; });
    process.stdin.on('end', () => resolve(value));
    process.stdin.on('error', reject);
  });
}
