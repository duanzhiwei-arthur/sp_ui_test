export function recheckableCases(mode, caseResults = []) {
  if (!['safe', 'daily', 'homepage-clickable', 'experiment', 'all'].includes(mode)) return [];
  return caseResults.filter(item => ['failed', 'flaky', 'unknown'].includes(item.status));
}

export function recheckArgs(mode, cases) {
  if (!cases.length) throw new Error('Cannot recheck an empty case selection');
  const titles = cases.map(item => '(?:^| )' + item.title.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') + '$');
  if (cases.every(item => item.file)) return [...new Set(cases.map(item => item.file)), '--grep', titles.join('|')];
  if (mode === 'homepage-clickable') return ['tests/home-clickable.spec.ts', '--grep', titles.join('|')];
  return ['--grep', titles.join('|')];
}

export function mergeRecheckResult(summary, recheckSummary, recheckedCases) {
  const recheck = recheckedCases.map(item => {
    const matches = (recheckSummary.caseResults ?? []).filter(result => result.title === item.title);
    const inconclusive = recheckSummary.readError || recheckSummary.reportErrors?.length
      || matches.length !== 1 || !['passed', 'failed'].includes(matches[0]?.status);
    return {
      title: item.title,
      initialStatus: item.status,
      firstFailure: summary.failureDetails?.find(detail => detail.title === item.title),
      secondFailure: recheckSummary.failureDetails?.find(detail => detail.title === item.title),
      secondArtifact: recheckSummary.failureArtifacts?.find(detail => detail.title === item.title),
      evidenceGap: inconclusive ? '复核报告缺失、跳过、重复匹配或运行级错误，不能确认恢复。' : undefined,
      finalStatus: inconclusive ? 'inconclusive' : matches[0].status === 'passed' ? 'passed-on-recheck' : 'failed-on-recheck'
    };
  });
  const all = [...(summary.recheck?.cases ?? []), ...recheck];
  return { ...summary, recheck: { enabled: true, cases: all,
    flaky: all.filter(item => item.finalStatus === 'passed-on-recheck').map(item => item.title) } };
}

// Raw Playwright suites and the first-attempt report stay unchanged. Only the
// notification/exit-code view is reconciled after the complete second attempt.
export function finalSummary(summary) {
  if (!summary.recheck?.cases?.length) return summary;
  const recovered = new Set(summary.recheck.cases.filter(item => item.finalStatus === 'passed-on-recheck').map(item => item.title));
  const cases = (summary.caseResults ?? []).map(item => recovered.has(item.title)
    ? { ...item, status: 'passed', recovered: true } : item);
  const details = (summary.failureDetails ?? []).filter(item => !recovered.has(item.title)).map(item => {
    const review = summary.recheck.cases.find(row => row.title === item.title);
    if (!review) return item;
    const first = review.firstFailure ?? item;
    const second = review.secondFailure;
    return { ...(second ?? item), reason: `首次：${first.reason}；二次：${second?.reason ?? review.evidenceGap ?? '缺少错误详情'}`,
      analysis: `首次：${first.analysis ?? first.reason}；二次：${second?.analysis ?? second?.reason ?? review.evidenceGap ?? '缺少错误详情'}` };
  });
  return { ...summary, caseResults: cases, failureDetails: details,
    failures: (summary.failures ?? []).filter(title => !recovered.has(title)),
    failureArtifacts: (summary.failureArtifacts ?? []).filter(item => !recovered.has(item.title)).map(item =>
      summary.recheck.cases.find(row => row.title === item.title)?.secondArtifact ?? item),
    stats: { ...summary.stats, expected: cases.filter(item => item.status === 'passed').length,
      unexpected: cases.filter(item => ['failed', 'unknown'].includes(item.status)).length,
      flaky: cases.filter(item => item.status === 'flaky').length, skipped: cases.filter(item => item.status === 'skipped').length }
  };
}

export function finalExitCode(summary, firstExitCode) {
  if (summary.readError || summary.reportErrors?.length || !summary.caseResults?.length
    || summary.caseResults.some(item => ['failed', 'flaky', 'unknown'].includes(item.status))) return 1;
  if (firstExitCode !== 0 && (!summary.recheck?.cases?.length
    || summary.recheck.cases.some(item => item.finalStatus !== 'passed-on-recheck'))) return 1;
  return 0;
}

export function recheckMessage(summary) {
  const items = summary.recheck?.cases ?? [];
  if (!items.length) return '';
  const flaky = items.filter(item => item.finalStatus === 'passed-on-recheck').map(item => item.title);
  const failed = items.filter(item => item.finalStatus === 'failed-on-recheck').map(item => item.title);
  const unknown = items.filter(item => item.finalStatus === 'inconclusive').map(item => item.title);
  return [
    '二次复核（保留首次失败证据；恢复不等于已证明网络误报）：',
    ...(flaky.length ? [`复核通过，偶发/待观察 ${flaky.length} 条：${flaky.join('、')}`] : []),
    ...(failed.length ? [`复核仍失败 ${failed.length} 条：${failed.join('、')}`] : []),
    ...(unknown.length ? [`复核未完成或证据不足 ${unknown.length} 条：${unknown.join('、')}`] : [])
  ].join('\n');
}
