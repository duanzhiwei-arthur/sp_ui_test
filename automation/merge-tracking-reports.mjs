import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const normalPath = resolve(process.argv[2]);
const exceptionPath = resolve(process.argv[3]);
const outputPath = resolve(process.argv[4] ?? 'test-results/tracking-combined-audit.json');
const normal = JSON.parse(readFileSync(normalPath, 'utf8'));
const exception = JSON.parse(readFileSync(exceptionPath, 'utf8'));
const exceptionResults = new Map(
  exception.results.filter((result) => result.status !== 'skipped').map((result) => [result.id, result])
);
const results = normal.results.map((result) => exceptionResults.get(result.id) ?? result);
const report = {
  ...normal,
  generatedAt: new Date().toISOString(),
  passed: results.filter((result) => result.status === 'passed').length,
  failed: results.filter((result) => result.status === 'failed').length,
  skipped: results.filter((result) => result.status === 'skipped').length,
  results,
  steps: [...normal.steps, ...exception.steps]
};
if (report.passed + report.failed + report.skipped !== report.total) throw new Error('合并结果计数不闭合');
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ outputPath, total: report.total, passed: report.passed, failed: report.failed, skipped: report.skipped }));
