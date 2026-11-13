import { gaCookieRows } from './ga-cookie.mjs';
import { formatGenerationEvidence, firstGenerationFailureMessages } from './generation-evidence.mjs';
import { isCanvasTreatment, isCanvasControl, hasCompleteCanvasScope, hasCompleteAllScope } from './canvas-scope.mjs';
export { isCanvasTreatment, isCanvasControl } from './canvas-scope.mjs';

const escape = value => String(value ?? '').replace(/[&<>*`_\[\]]/g, c => `&#${c.charCodeAt(0)};`);
const panel = (id, title, elements) => ({ tag: 'collapsible_panel', element_id: id, expanded: false,
  header: { title: { tag: 'plain_text', content: title } }, elements });
const reviewLabel = status => ({ 'passed-on-recheck': '复核通过', 'failed-on-recheck': '复核仍失败', inconclusive: '复核未完成／证据不足' })[status] ?? '未复核';
const brief = value => {
  const text = String(value ?? '未取得错误详情').replace(/\s+/g, ' ').trim();
  return escape(text.length > 100 ? text.slice(0, 100) + '…' : text);
};

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
  const scope = allCases ? '全部用例 · 对照组＋实验组＋首页巡检' : '画板双组 · 对照组＋实验组';
  const skipped = cases.filter(row => row.status === 'skipped').length;
  const failedCount = cases.filter(row => !['passed', 'skipped'].includes(row.status)).length;
  const diagnosticLines = [];
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
      if (detail || review) diagnosticLines.push(
        { tag: 'markdown', content: `**${escape(row.title)}**` },
        ...(row.readRetries ? [{ tag: 'markdown', content: `⚠️ 只读操作重试 ${row.readRetries} 处；首次状态和耗时保留于证据，不重放生成/加购。` }] : []),
        ...(detail ? [{ tag: 'markdown', content: escape(detail.analysis ?? detail.reason) },
          ...(detail.generationEvidence ? [{ tag: 'markdown', content: escape(formatGenerationEvidence(detail.generationEvidence)) }] : [])] : []),
        ...(detail?.analysis && detail?.reason && detail.analysis !== detail.reason ? [{ tag: 'markdown', content: `原始错误：${escape(detail.reason)}` }] : []),
        ...(review ? [{ tag: 'markdown', content: `${reviewLabel(review.finalStatus)}\n首次原因：${escape(review.firstFailure?.analysis ?? review.firstFailure?.reason ?? '未采集')}\n复核原因：${escape(review.secondFailure?.analysis ?? review.secondFailure?.reason ?? review.evidenceGap ?? '未采集')}` }] : []),
        ...firstGenerationFailureMessages({ recheck: { cases: review ? [review] : [] } }).map(content => ({ tag: 'markdown', content: escape(content) })),
      );
      return [{ tag: 'markdown', content: `${status}｜${escape(row.title)}${review && row.status !== 'passed' ? `\n${reviewLabel(review.finalStatus)}` : ''}` }];
    }).flat();
    return { tag: 'collapsible_panel', expanded: false, header: { title: { tag: 'plain_text',
      content: `${name} · ${ok}/${rows.length} 通过${countRecovered ? ` · ${countRecovered}条复核恢复` : ''}` } },
      elements: lines.length ? lines : [{ tag: 'markdown', content: '未取得本组结果，不能确认通过。' }] };
  });
  const cookies = gaCookieRows(summary);
  const reportIssues = [...(summary.readError ? [String(summary.readError)] : []),
    ...(summary.reportErrors ?? []).map(error => error.message ?? String(error)),
    ...(!complete ? ['用例清单不完整，存在缺项、重复或额外用例。'] : [])];
  return { schema: '2.0', config: { update_multi: true, width_mode: 'compact', summary: { content: `${scope} · ${passed}/${cases.length}通过` } },
    header: { title: { tag: 'plain_text', content: `JuJuBit · ${failed ? '回归未通过' : recovered ? '复核通过' : '回归通过'}` },
      subtitle: { tag: 'plain_text', content: scope }, template: color,
      icon: { tag: 'standard_icon', token: failed ? 'warning_colorful' : 'notice_colorful' } },
    body: { direction: 'vertical', padding: '12px', vertical_spacing: '8px', elements: [
      { tag: 'markdown', content: `**通过 ${passed}/${cases.length}** · 失败 ${failedCount}${skipped ? ` · 跳过 ${skipped}` : ''} · 耗时 ${Math.floor(duration / 60)}分${duration % 60}秒` },
      ...(failedCount ? [{ tag: 'markdown', element_id: 'attention', content: '**需关注**\n' + cases.filter(row => !['passed', 'skipped'].includes(row.status)).map(row => {
        const detail = summary.failureDetails?.find(d => d.title === row.title), review = reviews.find(r => r.title === row.title);
        return `• **${escape(String(row.title).split(/[：:]/u)[0])}**${review ? ` · ${reviewLabel(review.finalStatus)}` : ''}\n${brief(detail?.analysis ?? detail?.reason ?? review?.secondFailure?.reason)}`;
      }).join('\n\n') }] : []),
      ...(reportIssues.length ? [{ tag: 'markdown', content: '⚠️ ' + reportIssues.map(brief).join('\n') }] : []),
      ...(failed && !failedCount && !reportIssues.length ? [{ tag: 'markdown', content: '⚠️ 执行未完整通过，请查看用例状态与运行证据。' }] : []),
      ...(recovered ? [{ tag: 'markdown', content: `⚠️ ${recovered}条首次失败、复核恢复；首次证据保留在排查详情。` }] : []),
      ...panels,
      ...(readRetries ? [{ tag: 'markdown', content: `⚠️ 本轮有 ${readRetries} 处只读操作重试，成功不代表首次无异常。` }] : []),
      ...(diagnosticLines.length ? [panel('failureDetail', '失败与复核详情 · 原始错误／生成标识', diagnosticLines)] : []),
      panel('gaCookies', 'GA Cookie诊断 · 展开查看两个值', cookies.length ? cookies.map(row => ({ tag: 'markdown', content: `**${escape(row.title)}**\ncookieValue=${escape(row.cookieValue)}\ncookieClientId=${escape(row.cookieClientId)}` })) : [{ tag: 'markdown', content: 'cookieValue=未采集\ncookieClientId=未采集' }]),
      panel('runInfo', '运行信息 · 时间／版本', [{ tag: 'markdown', content: `完成时间：${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(finishedAt)}（北京时间）\nRun：${escape(runId ?? 'local')}\n提交：${escape(headSha ?? '未提交')}${reportIssues.length ? '\n' + reportIssues.map(escape).join('\n') : ''}` }]),
      ...(runUrl?.startsWith('https://') ? [{ tag: 'button', text: { tag: 'plain_text', content: '查看完整运行与证据' }, type: 'primary_filled', width: 'fill', size: 'small', behaviors: [{ type: 'open_url', default_url: runUrl }] }] : [])
    ] } };
}
