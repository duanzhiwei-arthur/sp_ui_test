// The approved personal-preview layout. Return null for anything except a
// completely clean run, leaving the existing detailed notification untouched.
export function buildCompactSuccessCard({ testExitCode, summary, finishedAt, scope, runId, headSha, runUrl }) {
  const stats = summary?.stats;
  const cases = summary?.caseResults;
  if (testExitCode !== 0 || summary?.readError || summary?.reportErrors?.length
    || summary?.failures?.length || summary?.failureDetails?.length
    || !stats || !Array.isArray(cases) || cases.length === 0
    || stats.unexpected !== 0 || stats.skipped !== 0 || stats.flaky !== 0
    || stats.expected !== cases.length || cases.some(item => item.status !== 'passed')) return null;
  if (!/^\d+$/.test(String(runId)) || !/^[a-f0-9]{40}$/.test(headSha ?? '')) return null;
  // Preserve the old local-report card if this is not a remote execution.
  try { if (new URL(runUrl).protocol !== 'https:') return null; } catch { return null; }
  if (!(finishedAt instanceof Date) || !Number.isFinite(finishedAt.getTime())
    || !Number.isFinite(stats.duration) || stats.duration < 0) return null;
  const seconds = Math.round(stats.duration / 1000);
  const completed = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(finishedAt);
  const escape = value => String(value).replace(/[&<>*`_\[\]]/g, character => `&#${character.charCodeAt(0)};`);
  const sorted = [...cases].sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true }));
  return {
    schema: '2.0',
    config: { update_multi: true, width_mode: 'compact', summary: { content: `JuJuBit · ${cases.length}/${cases.length} 通过` } },
    header: {
      title: { tag: 'plain_text', content: 'JuJuBit · 回归通过' },
      subtitle: { tag: 'plain_text', content: scope },
      template: 'green', icon: { tag: 'standard_icon', token: 'notice_colorful' }
    },
    body: { direction: 'vertical', padding: '12px', vertical_spacing: '8px', elements: [
      { tag: 'markdown', content: `**${cases.length}/${cases.length} 用例全部通过** · 耗时 ${Math.floor(seconds / 60)}分${seconds % 60}秒\n<font color='grey'>完成于 ${completed}（北京时间）</font>` },
      { tag: 'collapsible_panel', expanded: false, header: { title: { tag: 'plain_text', content: '用例明细与版本（展开）' } }, elements: [
        { tag: 'markdown', content: sorted.map(item => `✅ ${escape(item.title)}`).join('\n') },
        { tag: 'markdown', content: `<font color='grey'>Run：${runId}\n提交：${headSha.slice(0, 12)}</font>`, text_size: 'notation' }
      ] },
      { tag: 'button', text: { tag: 'plain_text', content: '查看完整运行' }, type: 'primary_filled', width: 'fill', size: 'small',
        behaviors: [{ type: 'open_url', default_url: runUrl }] }
    ] }
  };
}
