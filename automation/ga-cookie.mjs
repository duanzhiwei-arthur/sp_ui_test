export function gaCookieRows(summary) {
  const cases = Array.isArray(summary?.caseResults) ? summary.caseResults : [];
  if (!cases.length) return [];
  return cases.map(item => ({ title: item.title, cookieValue: item.gaCookie?.cookieValue ?? '未采集', cookieClientId: item.gaCookie?.cookieClientId ?? '未采集' }));
}

export function formatGaCookieMarkdown(summary, escape = value => String(value)) {
  const rows = gaCookieRows(summary);
  if (!rows.length) return '';
  return ['**GA Cookie诊断（每个独立浏览器上下文）**', ...rows.map(row =>
    `- ${escape(row.title)}：cookieValue=${escape(row.cookieValue)}；cookieClientId=${escape(row.cookieClientId)}`)].join('\n');
}
