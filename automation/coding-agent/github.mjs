import { REPOSITORY, REPLICA } from './policy.mjs';

// Trusted orchestration only; this adapter is never passed to the model.
export class GitHub {
  constructor(token, request = fetch) {
    if (!token) throw new Error('编程服务凭证未配置');
    this.token = token; this.request = request;
  }
  async call(path, { method = 'GET', body, repo = REPOSITORY, missing = false } = {}) {
    if (![REPOSITORY, REPLICA].includes(repo) || !path.startsWith('/') || path.includes('..')) throw new Error('不允许访问此仓库或路径');
    const response = await this.request(`https://api.github.com/repos/${repo}${path}`, {
      method, headers: { authorization: `Bearer ${this.token}`, accept: 'application/vnd.github+json',
        'content-type': 'application/json', 'x-github-api-version': '2022-11-28' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000),
    });
    if (missing && response.status === 404) {
      // Repo access errors must never be mistaken for missing owner/task state.
      const probe = await this.request(`https://api.github.com/repos/${repo}/actions/variables?per_page=1`, {
        headers: { authorization: `Bearer ${this.token}`, accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!probe.ok) throw new Error('无法读取编程权限配置');
      return null;
    }
    if (!response.ok) throw new Error(`编程服务 GitHub 请求失败：HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  async variable(name) {
    if (!/^FEISHU_CODE_(?:OWNER_V1|TASK_[A-F0-9]{24})$/.test(name)) throw new Error('无效的配置名称');
    const result = await this.call(`/actions/variables/${name}`, { missing: true });
    return result ? JSON.parse(result.value) : null;
  }
  async setVariable(name, value) {
    const current = await this.variable(name);
    return this.call(current ? `/actions/variables/${name}` : '/actions/variables', {
      method: current ? 'PATCH' : 'POST', body: { name, value: JSON.stringify(value) },
    });
  }
  async commitFiles(repo, parent, files, message) {
    const base = await this.call(`/git/commits/${parent}`, { repo });
    const tree = [];
    for (const file of files) {
      const blob = await this.call('/git/blobs', { repo, method: 'POST', body: { content: file.content, encoding: 'utf-8' } });
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const result = await this.call('/git/trees', { repo, method: 'POST', body: { base_tree: base.tree.sha, tree } });
    return this.call('/git/commits', { repo, method: 'POST', body: { message, tree: result.sha, parents: [parent] } });
  }
}
