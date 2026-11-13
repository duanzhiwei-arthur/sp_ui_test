import { readFile, writeFile, mkdir, lstat, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOSITORY, REPLICA, OWNER_KEY, WORKFLOW, SHA, TASK, USER, digest,
  taskName, validateProposal, authorizePublish } from './policy.mjs';
import { GitHub } from './github.mjs';
import { generateProposal, repositoryReader } from './generate.mjs';

const artifact = '.coding-artifacts/proposal.json';
const env = process.env;
function inputs() {
  const { CODE_ACTION: action, CODE_TASK: taskId, CODE_OWNER: owner, CODE_EXPECTED_SHA: expectedSha } = env;
  if (!['draft', 'publish'].includes(action) || !TASK.test(taskId || '') || !USER.test(owner || '') ||
      (action === 'publish' && !SHA.test(expectedSha || ''))) throw new Error('编程任务参数无效');
  return { action, taskId, owner, expectedSha };
}
async function authorized() {
  const input = inputs();
  const gh = new GitHub(env.FEISHU_CODING_GITHUB_TOKEN);
  const binding = await gh.variable(OWNER_KEY);
  if (!binding || binding.owner !== input.owner || binding.repository !== REPOSITORY) throw new Error('编程账号未绑定或身份不符');
  return { ...input, gh };
}
async function notify(owner, text) {
  // Always address the stored owner by open_id, never a caller-supplied chat_id.
  const tokenResponse = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }), signal: AbortSignal.timeout(15_000),
  });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || token.code !== 0 || !token.tenant_access_token) throw new Error('飞书身份获取失败');
  const response = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
    method: 'POST', headers: { authorization: `Bearer ${token.tenant_access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ receive_id: owner, msg_type: 'text', content: JSON.stringify({ text: text.slice(0, 6000) }) }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!response.ok || result.code !== 0) throw new Error('编程结果私信发送失败');
}
async function prepare() {
  const { action, taskId, owner, gh } = await authorized();
  if (action !== 'draft' || env.GITHUB_REPOSITORY !== REPOSITORY) throw new Error('无效的草稿环境');
  if (await gh.variable(taskName(taskId))) throw new Error('编程任务已存在，请查询状态');
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!SHA.test(base)) throw new Error('无效的基础版本');
  const proposal = await generateProposal({ request: env.CODE_REQUEST, baseSha: base,
    reader: repositoryReader(process.cwd(), base), endpoint: env.CODING_LLM_BASE_URL || '',
    key: env.CODING_LLM_API_KEY || '', model: env.CODING_LLM_MODEL || '' });
  await mkdir('.coding-artifacts', { recursive: true });
  await writeFile(artifact, JSON.stringify(proposal));
  await writeFile(env.GITHUB_OUTPUT, `base=${base}\n`, { flag: 'a' });
}
export async function materialize(root, candidate, proposal) {
  const validated = validateProposal(proposal, proposal.baseSha);
  // Extract only committed files, never .env, .git, credentials or host state.
  execFileSync('git', ['-C', root, 'archive', '--format=tar', '--output', path.resolve(root, '.coding-base.tar'), validated.baseSha]);
  await mkdir(candidate, { recursive: true });
  execFileSync('tar', ['-xf', path.resolve(root, '.coding-base.tar'), '-C', candidate]);
  await rm(path.resolve(root, '.coding-base.tar'));
  for (const file of validated.files) {
    const parts = file.path.split('/');
    let parent = candidate;
    for (const part of parts.slice(0, -1)) {
      parent = path.join(parent, part);
      const stat = await lstat(parent).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('拒绝符号链接或非目录父路径');
      if (!stat) await mkdir(parent);
    }
    const target = path.join(candidate, file.path);
    const stat = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('拒绝覆盖非普通文件');
    await writeFile(target, file.content);
  }
  await mkdir(path.join(candidate, 'node_modules'), { recursive: true });
}
async function finish() {
  const { taskId, owner, gh } = await authorized();
  if (env.CODE_PLAN_RESULT !== 'success' || env.CODE_VALIDATION_RESULT !== 'success') {
    await notify(owner, `编程任务 ${taskId} 未通过生成或隔离检查，没有发布或保存可发布草稿。请查看 Actions 记录，修改需求后重试。\nhttps://github.com/${REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`);
    return;
  }
  if (await gh.variable(taskName(taskId))) throw new Error('重复任务，拒绝覆盖草稿');
  const proposal = validateProposal(JSON.parse(await readFile(artifact, 'utf8')), env.CODE_BASE_SHA);
  const current = await gh.call('/git/ref/heads/main');
  if (current.object.sha !== proposal.baseSha) throw new Error('检查期间主分支已更新，请重新生成');
  const commit = await gh.commitFiles(REPOSITORY, proposal.baseSha, proposal.files, `feat: Feishu coding draft ${taskId}`);
  await gh.call('/git/refs', { method: 'POST', body: { ref: `refs/heads/feishu-code/${taskId}`, sha: commit.sha } });
  const record = { version: 1, state: 'ready', taskId, owner, baseSha: proposal.baseSha, headSha: commit.sha,
    runId: env.GITHUB_RUN_ID, proposalHash: digest(JSON.stringify(proposal)), summary: proposal.summary,
    files: proposal.files.map(file => ({ path: file.path, digest: digest(file.content) })), createdAt: new Date().toISOString() };
  await gh.setVariable(taskName(taskId), record);
  const files = proposal.files.map(file => file.path).join('\n');
  await notify(owner, `代码草稿已生成，隔离检查通过，尚未发布。\n任务：${taskId}\n修改文件：\n${files}\n差异：https://github.com/${REPOSITORY}/compare/${proposal.baseSha}...${commit.sha}\n\n确认后请私聊发送完整指令：\n发布代码 ${taskId} ${commit.sha}\n\n此仓库为公开仓库，草稿分支的代码公开可见。检查未运行真实站点生成/支付。`);
}
async function contentAt(gh, repo, ref, filename) {
  const tree = await gh.call(`/git/trees/${ref}?recursive=1`, { repo });
  if (tree.truncated) throw new Error('仓库树超过安全读取上限');
  const entry = tree.tree.find(item => item.path === filename);
  if (!entry) return null;
  if (entry.type !== 'blob' || entry.mode !== '100644') throw new Error('发布文件不是普通文本文件');
  const blob = await gh.call(`/git/blobs/${entry.sha}`, { repo });
  if (blob.encoding !== 'base64' || blob.size > 100_000) throw new Error('发布文件过大或编码无效');
  return Buffer.from(blob.content, 'base64').toString('utf8');
}
async function publish() {
  const { taskId, owner, gh, expectedSha } = await authorized();
  if (env.GITHUB_REPOSITORY !== REPOSITORY) throw new Error('禁止其他仓库执行发布');
  const record = await gh.variable(taskName(taskId));
  const main = await gh.call('/git/ref/heads/main');
  const branch = await gh.call(`/git/ref/heads/feishu-code/${taskId}`);
  const run = record && await gh.call(`/actions/runs/${record.runId}`);
  const decision = authorizePublish(record, { taskId, owner, expectedSha, mainSha: main.object.sha,
    branchSha: branch.object.sha, successfulRun: run?.conclusion === 'success' && run.status === 'completed' &&
      run.path === `.github/workflows/${WORKFLOW}` && run.event === 'workflow_dispatch' });
  const commit = await gh.call(`/git/commits/${record.headSha}`);
  if (commit.parents.length !== 1 || commit.parents[0].sha !== record.baseSha) throw new Error('草稿提交父版本不匹配');
  const compare = await gh.call(`/compare/${record.baseSha}...${record.headSha}`);
  if (compare.total_commits !== 1 || compare.files?.length !== record.files?.length) throw new Error('草稿差异不匹配');
  const files = [];
  for (const file of record.files) {
    if (!compare.files.some(changed => changed.filename === file.path && ['added', 'modified'].includes(changed.status))) throw new Error('草稿包含未授权的修改');
    const content = await contentAt(gh, REPOSITORY, record.headSha, file.path);
    if (content === null || digest(content) !== file.digest) throw new Error('草稿内容与检查结果不匹配');
    files.push({ path: file.path, content });
  }
  const proposal = validateProposal({ baseSha: record.baseSha, summary: record.summary, files }, record.baseSha);
  if (digest(JSON.stringify(proposal)) !== record.proposalHash) throw new Error('草稿校验摘要不匹配');
  if (decision === 'publish') {
    // Re-read immediately before the write; the non-force update additionally
    // rejects a main branch that changed to an unrelated commit.
    const latest = await gh.call('/git/ref/heads/main');
    if (latest.object.sha !== record.baseSha) throw new Error('主分支在发布前发生变化，请重新生成');
    await gh.call('/git/refs/heads/main', { method: 'PATCH', body: { sha: record.headSha, force: false } });
    await gh.setVariable(taskName(taskId), { ...record, state: 'published', publishedAt: new Date().toISOString() });
  }
  // Required project replica sync. Refuse to overwrite unrelated edits or a
  // concurrently advancing replica. No force pushes and no automatic rollback.
  try {
    const copy = await gh.call('/git/ref/heads/master', { repo: REPLICA });
    const writes = [];
    for (const file of files) {
      const dest = `projects/sp_ui_test/${file.path}`;
      const current = await contentAt(gh, REPLICA, copy.object.sha, dest);
      if (current === file.content) continue;
      const base = await contentAt(gh, REPOSITORY, record.baseSha, file.path);
      if (current !== base) throw new Error('副本存在不同改动，不能覆盖');
      writes.push({ path: dest, content: file.content });
    }
    let replicaSha = copy.object.sha;
    if (writes.length) {
      const synced = await gh.commitFiles(REPLICA, copy.object.sha, writes, `sync: sp_ui_test coding task ${taskId}`);
      await gh.call('/git/refs/heads/master', { repo: REPLICA, method: 'PATCH', body: { sha: synced.sha, force: false } });
      replicaSha = synced.sha;
    }
    await gh.setVariable(taskName(taskId), { ...record, state: 'published', replicaSha, syncedAt: new Date().toISOString() });
    await notify(owner, `代码已发布到 sp_ui_test/main，并同步发布副本。\n任务：${taskId}\n原仓库提交：${record.headSha}\n副本提交：${replicaSha}\nhttps://github.com/${REPOSITORY}/commit/${record.headSha}\n后续定时任务使用新版本；这不代表本机旧工作区已更新，也不代表已运行真实线上回归。`);
  } catch {
    await notify(owner, `任务 ${taskId}：原仓库已发布 ${record.headSha}，但副本同步尚未完成。没有自动回滚。请检查副本冲突/权限，处理后重发同一发布指令重试同步。`);
    throw new Error('主仓库已发布，副本同步或回执未完成');
  }
}
export async function main(mode = process.argv[2]) {
  if (mode === 'verify-prepare') {
    // Harmless deployment verification: exercise the exact archive/container
    // path using unchanged README content, with no owner binding or secrets.
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const reader = repositoryReader(process.cwd(), base);
    const proposal = validateProposal({ baseSha: base, summary: 'Container verification fixture',
      files: [{ path: 'README.md', content: reader.read('README.md') }] }, base);
    await mkdir('.coding-artifacts', { recursive: true });
    await writeFile(artifact, JSON.stringify(proposal));
    await writeFile(env.GITHUB_OUTPUT, `base=${base}\n`, { flag: 'a' });
    return;
  }
  if (mode === 'prepare') return prepare();
  if (mode === 'materialize') {
    const proposal = validateProposal(JSON.parse(await readFile(artifact, 'utf8')), env.CODE_BASE_SHA);
    return materialize(process.cwd(), path.resolve('.coding-candidate'), proposal);
  }
  if (mode === 'finish') return finish();
  if (mode === 'publish') return publish();
  throw new Error('未知编程执行阶段');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('编程任务失败；详细敏感输入不写入日志。请查询任务与 Actions 阶段状态。'); process.exitCode = 1; });
}
