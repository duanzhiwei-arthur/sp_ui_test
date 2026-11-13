import { createHash } from 'node:crypto';

export const REPOSITORY = 'duanzhiwei-arthur/sp_ui_test';
export const REPLICA = 'vast-enterprise/shop-test-agent-s';
export const OWNER_KEY = 'FEISHU_CODE_OWNER_V1';
export const TASK_PREFIX = 'FEISHU_CODE_TASK_';
export const WORKFLOW = 'feishu-coding.yml';
export const SHA = /^[a-f0-9]{40}$/;
export const TASK = /^[a-f0-9]{24}$/;
export const USER = /^ou_[A-Za-z0-9_-]{5,100}$/;
export function digest(value) { return createHash('sha256').update(value).digest('hex'); }
export function taskName(id) {
  if (!TASK.test(id)) throw new Error('无效的编程任务编号');
  return TASK_PREFIX + id.toUpperCase();
}
export function allowedPath(value) {
  if (typeof value !== 'string' || value.length > 200 ||
      !/^[A-Za-z0-9_./-]+$/.test(value) || value.split('/').some(x => !x || x.startsWith('.')) ||
      /(?:^|\/)(?:AGENTS|SKILL|CLAUDE)\.md$/i.test(value) ||
      /(?:secret|credential|token|\.env)/i.test(value)) return false;
  // The agent cannot modify its own permissions/executor, workflows, manifests,
  // dependencies, or notification/authentication controls. No arbitrary shell.
  if (value.startsWith('automation/coding-agent/') ||
      /^automation\/(?:notification-|scheduled-notification-|feishu-|check-project-sync)/.test(value)) return false;
  return value === 'README.md' || /^(tests|experiments|verification|automation)\/.+\.(?:ts|mjs|json|md)$/.test(value);
}
export function validateProposal(value, expectedBase) {
  if (!value || typeof value !== 'object' || value.baseSha !== expectedBase || !SHA.test(expectedBase) ||
      typeof value.summary !== 'string' || value.summary.length < 1 || value.summary.length > 2000 ||
      !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 8) throw new Error('改动提案格式无效');
  let size = 0;
  const seen = new Set();
  const files = value.files.map(file => {
    if (!file || !allowedPath(file.path) || seen.has(file.path) || typeof file.content !== 'string' ||
        file.content.includes('\0') || Buffer.byteLength(file.content) > 100_000) throw new Error('改动包含禁止路径、重复文件或超大文件');
    // Prevent accidental credential material from becoming a public commit.
    if (/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{24,}|-----BEGIN .*PRIVATE KEY-----)/.test(file.content)) throw new Error('改动疑似包含密钥，已拒绝');
    size += Buffer.byteLength(file.content); seen.add(file.path);
    return { path: file.path, content: file.content };
  });
  if (size > 200_000) throw new Error('改动总量超过上限');
  return { version: 1, baseSha: expectedBase, summary: value.summary, files };
}
export function authorizePublish(record, { owner, taskId, expectedSha, mainSha, branchSha, successfulRun }) {
  if (!record || record.owner !== owner || !USER.test(owner) || record.taskId !== taskId || !TASK.test(taskId) ||
      !SHA.test(record.headSha) || record.headSha !== branchSha || record.headSha !== expectedSha ||
      !SHA.test(record.baseSha) || !/^[0-9]+$/.test(String(record.runId)) || !successfulRun) {
    throw new Error('发布身份、任务、提交或检查结果不匹配');
  }
  if (mainSha === record.headSha && ['ready', 'published'].includes(record.state)) return 'already-published';
  if (record.state !== 'ready' || mainSha !== record.baseSha) throw new Error('任务未就绪或主分支已更新，请重新创建改动');
  return 'publish';
}
