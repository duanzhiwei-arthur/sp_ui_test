// Explicit allowlist: no resource URLs, response bodies, cookies or arbitrary
// page text may enter the diagnostic bundle or Feishu notification.
export function sanitizeBrowserEvidence(value) {
  if (!value || typeof value !== 'object') return undefined;
  const id = v => /^[a-zA-Z0-9_-]{1,128}$/.test(String(v ?? '')) ? String(v) : undefined;
  const at = v => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v ?? '') ? v : undefined;
  const rows = (v, limit) => Array.isArray(v) ? v.filter(r => r && typeof r === 'object').slice(-limit) : [];
  const events = /^(task_start|asset_start|asset_2d_done|asset_3d_start|asset_3d_done|asset_done|task_done|asset_error|task_error)$/;
  const resource = r => ({ visible: r.visible === true,
    status: Number.isInteger(r.status) && r.status >= 100 && r.status <= 599 ? r.status : undefined,
    failed: r.failed === true });
  const f = value.frontend;
  return {
    timeline: rows(value.timeline, 40).filter(r => events.test(r.event)).map(r => ({
      at: at(r.at), event: r.event, taskId: id(r.taskId), assetId: id(r.assetId),
    })),
    frontend: f && typeof f === 'object' ? {
      available: f.available === true, capturedAt: at(f.capturedAt),
      progress: rows(f.progress, 5).map(r => ({ kind: ['image','model'].includes(r.kind) ? r.kind : 'unknown',
        percent: Number.isFinite(r.percent) && r.percent >= 0 && r.percent <= 100 ? r.percent : null })),
      images: rows(f.images, 10).map(r => ({ ...resource(r), complete: r.complete === true,
        naturalWidth: Number.isFinite(r.naturalWidth) && r.naturalWidth >= 0 ? r.naturalWidth : null })),
      models: rows(f.models, 5).map(r => ({ ...resource(r), loaded: r.loaded === true })),
    } : undefined,
    taskQuery: 'not-performed', timingBasis: 'browser-first-observed-or-completed-response',
  };
}

export function formatBrowserEvidence(raw) {
  const e = sanitizeBrowserEvidence(raw);
  if (!e) return [];
  const f = e.frontend;
  const terminal = e.timeline.some(r => ['task_done','task_error','asset_done','asset_error'].includes(r.event));
  return ['浏览器侧诊断（仅本次首次尝试）：',
    `生成事件：${e.timeline.map(r => r.event).join(' → ') || '未采集到'}；${terminal ? '观察到结束事件，需区分成功/错误' : '未观察到结束事件，不等于后台未结束'}`,
    ...(f?.available ? [
      `生成遮罩：${f.progress.map(r => `${r.kind}${r.percent === null ? '' : ` ${r.percent}%`}`).join('、') || '未见可见进度条'}`,
      `图片：${f.images.length ? f.images.map(r => `可见=${r.visible}，解码完成=${r.complete && r.naturalWidth > 0}，HTTP=${r.status ?? '未知'}，请求失败=${r.failed}`).join('；') : '未找到图片节点'}`,
      `模型：${f.models.length ? f.models.map(r => `可见=${r.visible}，loaded=${r.loaded}，HTTP=${r.status ?? '未知'}，请求失败=${r.failed}`).join('；') : '未找到模型节点'}`,
    ] : ['页面状态：未取得可用快照']),
    '证据边界：事件时间为浏览器首次观察/响应读完时间；未主动查询后台终态，无法仅据此归责前端、后端或网络。',
  ];
}
