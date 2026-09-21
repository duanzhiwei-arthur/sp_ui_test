import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = path.join(projectRoot, 'automation', 'experiment-command-registry.json');
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));

if (registry?.version !== 1 || !Array.isArray(registry.experiments)) {
  throw new Error('实验命令注册表格式无效：需要 version=1 和 experiments 数组');
}

const activeExperiments = registry.experiments.filter((experiment) => experiment?.enabled === true);
const specs = [...new Set(activeExperiments.flatMap((experiment) => experiment.specs))];
const caseIds = [...new Set(activeExperiments.flatMap((experiment) => experiment.caseIds))];
if (specs.length === 0 || caseIds.length === 0) throw new Error('当前没有启用的实验用例。');

const playwrightBin = path.join(projectRoot, 'node_modules', '.bin', 'playwright');
const args = ['test', ...specs, '--grep', caseIds.join('|'), ...process.argv.slice(2)];
console.log(`[experiments] 启用实验：${activeExperiments.map((item) => item.key).join('、')}`);
console.log(`[experiments] 用例：${caseIds.join('、')}`);

const child = spawn(playwrightBin, args, { cwd: projectRoot, env: process.env, stdio: 'inherit' });
child.once('error', (error) => {
  console.error(`[experiments] 无法启动 Playwright：${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) console.error(`[experiments] Playwright 被信号 ${signal} 终止`);
  process.exitCode = code ?? 1;
});
