#!/usr/bin/env node

/**
 * Long-running Feishu event bridge. Run this on a small cloud VM/container
 * (not the developer laptop) with the bot identity configured in lark-cli.
 * It listens for @bot messages and delegates recognized commands to the
 * GitHub workflow dispatcher.
 */

import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

const larkCli = process.env.LARK_CLI_PATH?.trim() || 'lark-cli';
const botOpenId = process.env.FEISHU_BOT_OPEN_ID?.trim();
const commandScript = resolve('automation/feishu-experiment-command.mjs');
const handledMessageIds = new Set();

const consumer = spawn(larkCli, ['event', 'consume', 'im.message.receive_v1', '--as', 'bot'], {
  cwd: process.cwd(),
  env: process.env,
  // Keep stdin open: an unbounded lark-cli consumer treats stdin EOF as a
  // graceful shutdown. A pipe with no writer keeps the subscription alive.
  stdio: ['pipe', 'pipe', 'inherit']
});

consumer.once('error', (error) => {
  console.error(`[feishu-bot] 无法启动 lark-cli：${error.message}`);
  process.exitCode = 1;
});

const lines = createInterface({ input: consumer.stdout });
for await (const line of lines) {
  if (!line.trim()) continue;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    console.warn('[feishu-bot] 忽略无法解析的事件行。');
    continue;
  }
  if (!isMentionToBot(event)) continue;
  const messageId = String(event.message_id ?? event.id ?? '').trim();
  if (messageId && handledMessageIds.has(messageId)) continue;
  if (messageId) {
    handledMessageIds.add(messageId);
    // Bound memory for long-running consumers while retaining recent IDs.
    if (handledMessageIds.size > 2_000) {
      handledMessageIds.delete(handledMessageIds.values().next().value);
    }
  }
  void handleEvent(event);
}

function isMentionToBot(event) {
  if (event.sender_type === 'bot') return false;
  const mentions = Array.isArray(event.mentions) ? event.mentions : [];
  if (mentions.length === 0) return false;
  return !botOpenId || mentions.some((mention) => mention?.id === botOpenId);
}

async function handleEvent(event) {
  const child = spawn(process.execPath, [commandScript], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'inherit', 'inherit']
  });
  child.stdin.end(JSON.stringify(event));
  await new Promise((resolvePromise) => child.once('exit', resolvePromise));
}

process.on('SIGTERM', () => consumer.kill('SIGTERM'));
process.on('SIGINT', () => consumer.kill('SIGINT'));
