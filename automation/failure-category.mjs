// 分类只解释证据，不参与退出码、复核次数或通过判定。
export function failureCategory(reason = '') {
  if (/\[UI_INPUT_RESET\]/u.test(reason)) return 'ui-input-reset';
  if (/\[UI_VIEW_TIMEOUT\]/u.test(reason)) return 'ui-view-timeout';
  if (/\[SITE_(VERIFICATION|RATE_LIMITED|ACCESS_DENIED)\]/u.test(reason)) return 'access-blocked';
  if (/\[EXPERIMENT_ASSIGNMENT\]/u.test(reason)) return 'experiment-precondition';
  if (/\[READ_HTTP\]/u.test(reason)) return 'read-http';
  if (/\[READ_TRANSPORT\]/u.test(reason)) return 'read-transport';
  if (/\[READ_PAYLOAD\]|\[READ_CONTEXT\]/u.test(reason)) return 'read-contract';
  if (/\[ASSET_OWNERSHIP\]/u.test(reason)) return 'ownership-unconfirmed';
  if (/\[CART_ASSET\]/u.test(reason)) return 'cart-asset-mismatch';
  if (/\[GENERATION_FAILED\]/u.test(reason)) return 'generation-failed';
  if (/\[GENERATION_TIMEOUT\]/u.test(reason)) return 'generation-timeout';
  if (/net::ERR_|\[NAV_RESPONSE\]|\[NAV_DOM_READY\]/u.test(reason)) return 'navigation-or-network';
  return 'assertion-or-unknown';
}
export function failureCategoryLabel(category) {
  return ({ 'access-blocked':'验证/访问阻断', 'ownership-unconfirmed':'资产归属未确认', 'cart-asset-mismatch':'本轮加购核验失败',
    'experiment-precondition':'实验分组前置未满足', 'read-http':'只读接口HTTP异常', 'read-transport':'只读接口连接或超时', 'read-contract':'只读接口响应或会话异常',
    'ui-input-reset':'输入状态被重置', 'ui-view-timeout':'视图切换超时', 'generation-failed':'生成明确失败', 'generation-timeout':'生成超时待查', 'navigation-or-network':'导航/网络待查',
    'assertion-or-unknown':'断言失败/原因待查' })[category] ?? '原因待查';
}
export function firstFailureCategoryMessages(summary) {
  const cases=(summary.recheck?.cases??[]).filter(item=>item.firstFailure?.reason);
  if(!cases.length)return [];
  const counts=cases.reduce((all,item)=>{const label=failureCategoryLabel(failureCategory(item.firstFailure.reason));all[label]=(all[label]??0)+1;return all;},{});
  return [`首次原因分类：${Object.entries(counts).map(([name,count])=>`${name} ${count}条`).join('；')}（分类不改变复核/通过判定）`];
}
