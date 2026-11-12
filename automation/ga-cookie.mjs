export function gaCookieRows(summary) {
  const cases = Array.isArray(summary?.caseResults) ? summary.caseResults : [];
  if (!cases.length) return [];
  const row=(title, value)=>({ title, cookieValue:value?.cookieValue ?? '未采集', cookieClientId:value?.cookieClientId ?? '未采集' });
  return cases.flatMap(item => {
    const review=summary.recheck?.cases?.find(r=>r.title===item.title);
    if (!review) return [row(item.title,item.gaCookie)];
    return [row(`${item.title}（首次）`,review.firstGaCookie ?? item.gaCookie),row(`${item.title}（复核）`,review.secondGaCookie)];
  });
}

export function formatGaCookieMarkdown(summary, escape = value => String(value)) {
  const rows = gaCookieRows(summary);
  if (!rows.length) return '';
  return ['**GA Cookie诊断（每个独立浏览器上下文）**', ...rows.map(row =>
    `- ${escape(row.title)}：cookieValue=${escape(row.cookieValue)}；cookieClientId=${escape(row.cookieClientId)}`)].join('\n');
}
