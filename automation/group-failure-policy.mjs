import { gaCookieRows } from './ga-cookie.mjs';

// Delivery policy only: never changes test exit codes, retries or evidence.
export function groupFailureKind(reason = '') {
  const text = String(reason);
  if (/\[SITE_VERIFICATION\]/u.test(text)) return '人机验证阻断';
  if (/\[SITE_RATE_LIMITED\]|\[READ_HTTP\][\s\S]*HTTP\s*429/u.test(text)) return '访问限流';
  if (/\[SITE_ACCESS_DENIED\]/u.test(text)) return '访问被拒绝';
  if (/\[READ_TRANSPORT\]|net::ERR_(?:CONNECTION_[A-Z_]+|NETWORK_CHANGED|TIMED_OUT|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|EMPTY_RESPONSE|PROXY_[A-Z_]+|TUNNEL_CONNECTION_FAILED)|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/u.test(text)) return '网络问题';
  if (/\[READ_HTTP\]|\[NAV_HTTP\]/u.test(text)) return '接口或页面HTTP异常';
  if (/\[GENERATION_FAILED\]/u.test(text)) return '生成明确失败';
  if (/\[ASSET_OWNERSHIP\]|\[CART_ASSET\]|\[READ_PAYLOAD\]|\[READ_CONTEXT\]/u.test(text)) return '业务校验异常（原因待查）';
  if (/\[EXPERIMENT_ASSIGNMENT\]/u.test(text)) return '实验前置异常';
  if (/\[UI_VIEW_TIMEOUT\]|\[UI_INPUT_RESET\]/u.test(text)) return '断言或交互检查异常';
  if (/\[GENERATION_TIMEOUT\]/u.test(text)) return '生成等待超时（原因待查）';
  if (/\[NAV_RESPONSE\]|\[NAV_DOM_READY\]|\[NAV_RENDERER\]/u.test(text)) return '页面就绪异常（原因待查）';
  if (/expect\([^\n]*\)\.(?:to|not\.)|expect\(received\)|Locator:|strict mode violation|locator\.(?:click|fill|check|waitFor): Timeout/u.test(text)) return '断言或交互检查异常';
  return '执行异常（原因待查）';
}

export function groupFailurePolicy(summary = {}) {
  const failures = (summary.caseResults ?? []).filter(row => !['passed', 'skipped'].includes(row.status));
  const rows = failures.map(row => {
    const review = summary.recheck?.cases?.find(item => item.title === row.title);
    const detail = summary.failureDetails?.find(item => item.title === row.title);
    const reason = detail?.reason || review?.secondFailure?.reason || review?.firstFailure?.reason || '';
    // Evidence from BOTH attempts matters: a second assertion must not hide a
    // first challenge/network failure, nor may recovery be called clean success.
    const reasons = [review?.firstFailure?.reason, review?.secondFailure?.reason, reason].filter(Boolean);
    const kinds = [...new Set((reasons.length ? reasons : ['']).map(groupFailureKind))];
    const reportable = kinds.filter(kind => kind !== '断言或交互检查异常');
    return { title: row.title, reason, kinds: reportable.length ? reportable : ['断言或交互检查异常'], suppressed: reportable.length === 0 };
  });
  const evidenceGap = Boolean(summary.readError || summary.reportErrors?.length || !summary.caseResults?.length);
  return { reportable: rows.filter(row => !row.suppressed), suppressed: rows.filter(row => row.suppressed),
    suppress: !evidenceGap && rows.length > 0 && rows.every(row => row.suppressed), evidenceGap };
}

const escape = value => String(value ?? '').replace(/[&<>*`_\[\]]/g, c => `&#${c.charCodeAt(0)};`);
export function buildGroupFailureCard(summary, policy, runUrl) {
  const labels = [...new Set(policy.reportable.flatMap(row => row.kinds))];
  const label = labels.length === 1 ? labels[0] : '分类异常报告';
  const cookies = gaCookieRows(summary);
  return { schema: '2.0', config: { width_mode: 'compact' },
    header: { title: { tag: 'plain_text', content: `JuJuBit · ${label}` }, template: 'red' },
    body: { elements: [
      { tag: 'markdown', content: `本次需关注 ${policy.reportable.length} 条${policy.suppressed.length ? `；另有 ${policy.suppressed.length} 条断言／交互检查未作群告警` : ''}。测试失败状态和完整证据仍保留在运行记录。` },
      ...policy.reportable.map(row => ({ tag: 'markdown', content: `**${escape(row.title)}**\n分类：${escape(row.kinds.join('、'))}\n${escape(row.reason).slice(0, 1800)}` })),
      ...(policy.evidenceGap ? [{ tag: 'markdown', content: '执行或报告存在证据缺口，不能确认通过，请核对完整运行。' }] : []),
      { tag: 'collapsible_panel', expanded: false, header: { title: { tag: 'plain_text', content: 'GA Cookie诊断' } }, elements: cookies.length ? cookies.map(row => ({ tag: 'markdown', content: `${escape(row.title)}\ncookieValue=${escape(row.cookieValue)}\ncookieClientId=${escape(row.cookieClientId)}` })) : [{ tag: 'markdown', content: '未采集' }] },
      ...(runUrl?.startsWith('https://') ? [{ tag: 'button', text: { tag: 'plain_text', content: '查看完整运行与证据' }, behaviors: [{ type: 'open_url', default_url: runUrl }] }] : []),
    ] } };
}
