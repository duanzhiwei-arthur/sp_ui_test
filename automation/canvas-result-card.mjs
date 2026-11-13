import { gaCookieRows } from './ga-cookie.mjs';
import { formatGenerationEvidence, firstGenerationFailureMessages } from './generation-evidence.mjs';
import { isCanvasTreatment, isCanvasControl, hasCompleteCanvasScope, hasCompleteAllScope } from './canvas-scope.mjs';
export { isCanvasTreatment, isCanvasControl } from './canvas-scope.mjs';

const escape = value => String(value ?? '').replace(/[&<>*`_\[\]]/g, c => `&#${c.charCodeAt(0)};`);

export function buildCanvasResultCard({ summary, testExitCode, finishedAt, runId, headSha, runUrl, allCases = false }) {
  const cases = summary.caseResults ?? [];
  const reviews = summary.recheck?.cases ?? [];
  const complete = (allCases ? hasCompleteAllScope : hasCompleteCanvasScope)(cases);
  const failed = testExitCode !== 0 || summary.readError || summary.reportErrors?.length || !complete || cases.some(row => row.status !== 'passed');
  const recovered = reviews.filter(row => row.finalStatus === 'passed-on-recheck').length;
  const readRetries = cases.reduce((count, row) => count + (row.readRetries ?? 0), 0);
  const passed = cases.filter(row => row.status === 'passed').length;
  const color = failed ? 'red' : recovered || readRetries ? 'orange' : 'green';
  const duration = Math.round((summary.stats?.duration ?? 0) / 1000);
  const panels = [['画板对照组', isCanvasControl], ['画板实验组', isCanvasTreatment],
    ...(allCases ? [['首页按钮巡检', title => !isCanvasControl(title) && !isCanvasTreatment(title)]] : [])].map(([name, matches]) => {
    const rows = cases.filter(row => matches(row.title)).sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true }));
    const ok = rows.filter(row => row.status === 'passed').length;
    const countRecovered = rows.filter(row => reviews.some(r => r.title === row.title && r.finalStatus === 'passed-on-recheck')).length;
    const lines = rows.map(row => {
      const review = reviews.find(r => r.title === row.title);
      const status = row.status === 'passed' ? review?.finalStatus === 'passed-on-recheck' ? '⚠️ 复核通过' : '✅ 通过'
        : row.status === 'skipped' ? '⏭️ 跳过' : row.status === 'unknown' ? '❓ 未判定' : '❌ 失败';
      const detail = summary.failureDetails?.find(d => d.title === row.title);
      const cookies = gaCookieRows(summary).filter(r => r.title === row.title || r.title.startsWith(row.title + '（'));
      return [{ tag: 'markdown', content: `**${status}｜${escape(row.title)}**` },
        ...(row.readRetries ? [{ tag: 'markdown', content: `⚠️ 只读操作重试 ${row.readRetries} 处；首次状态和耗时保留于证据，不重放生成/加购。` }] : []),
        ...(detail ? [{ tag: 'markdown', content: escape(detail.analysis ?? detail.reason) },
          ...(detail.generationEvidence ? [{ tag: 'markdown', content: escape(formatGenerationEvidence(detail.generationEvidence)) }] : [])] : []),
        ...(review?.firstFailure ? [{ tag: 'markdown', content: `首次原因：${escape(review.firstFailure.analysis ?? review.firstFailure.reason)}\n复核：${escape(review.finalStatus)}` }] : []),
        ...firstGenerationFailureMessages({ recheck: { cases: review ? [review] : [] } }).map(content => ({ tag: 'markdown', content: escape(content) })),
        { tag: 'markdown', content: `GA Cookie诊断\n${cookies.length ? cookies.map(c => `${escape(c.title)}\ncookieValue=${escape(c.cookieValue)}\ncookieClientId=${escape(c.cookieClientId)}`).join('\n') : 'cookieValue=未采集\ncookieClientId=未采集'}`, text_size: 'notation' }];
    }).flat();
    return { tag: 'collapsible_panel', expanded: false, header: { title: { tag: 'plain_text',
      content: `${name} · ${ok}/${rows.length} 通过${countRecovered ? ` · ${countRecovered}条复核恢复` : ''}（展开用例）` } },
      elements: lines.length ? lines : [{ tag: 'markdown', content: '未取得本组结果，不能确认通过。' }] };
  });
  const failedTitles = cases.filter(c => c.status !== 'passed').map(c => c.title);
  return { schema: '2.0', config: { update_multi: true, width_mode: 'compact', summary: { content: `画板双组回归 · ${passed}/${cases.length}通过` } },
    header: { title: { tag: 'plain_text', content: `JuJuBit · ${failed ? '回归未通过' : recovered ? '复核通过' : '双组回归通过'}` }, template: color },
    body: { direction: 'vertical', padding: '12px', vertical_spacing: '8px', elements: [
      { tag: 'markdown', content: `**${passed}/${cases.length} 用例通过** · ${Math.floor(duration / 60)}分${duration % 60}秒\n${escape(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(finishedAt))}（北京时间）${recovered ? `\n⚠️ ${recovered}条首次失败、复核恢复；首次原因保留在组内。` : ''}` },
      ...(failed ? [{ tag: 'markdown', content: `❌ ${escape(failedTitles.join('、') || summary.readError || '执行或报告不完整')}\n展开对应组查看原因、Task/Asset/Trace/Request ID及证据。` }] : []),
      ...panels,
      ...(readRetries ? [{ tag: 'markdown', content: `⚠️ 本轮有 ${readRetries} 处只读操作重试，成功不代表首次无异常。` }] : []),
      { tag: 'markdown', text_size: 'notation', content: `Run：${escape(runId ?? 'local')} · 提交：${escape((headSha ?? '未提交').slice(0, 12))}` },
      ...(runUrl?.startsWith('https://') ? [{ tag: 'button', text: { tag: 'plain_text', content: '完整运行与截图／录屏' }, type: 'primary_filled', behaviors: [{ type: 'open_url', default_url: runUrl }] }] : [])
    ] } };
}
