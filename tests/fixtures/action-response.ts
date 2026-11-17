import { test, type Page, type Request, type Response } from '@playwright/test';

/** Listen before the action, budget response time from the actual request.
 * Await the bounded action before returning an observation error: Promise.all
 * would leave clicks/dialogs running after mutation authorization was revoked.
 * Never retries a write. Callers supply bounded Playwright actions.
 */
export async function actionResponse(page: Page, action: () => Promise<void>, matches: (request: Request) => boolean,
  options: { label: string; responseTimeoutMs?: number; requestTimeoutMs?: number }): Promise<Response> {
  const responseMs = options.responseTimeoutMs ?? 30_000;
  const requestMs = options.requestTimeoutMs ?? 30_000;
  const started = Date.now();
  let request: Request | undefined, requestedAt: number | undefined, actionEndedAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, settled = false;
  type Outcome = { response: Response } | { error: Error };
  let finish!: (outcome: Outcome) => void;
  const outcome = new Promise<Outcome>(resolve => { finish = value => {
    if (settled) return;
    settled = true; clearTimeout(timer); resolve(value);
  }; });
  let phase = 'action';
  const onRequest = (candidate: Request) => {
    if (request || settled || !matches(candidate)) return;
    request = candidate; requestedAt = Date.now(); clearTimeout(timer);
    timer = setTimeout(() => finish({ error: new Error(`[WRITE_RESPONSE_TIMEOUT] ${options.label}：请求已发出，${responseMs}ms内未收到响应；未重发操作`) }), responseMs);
  };
  const onResponse = (response: Response) => {
    if (response.request() === request) finish({ response });
  };
  const onFailure = (failed: Request) => {
    if (failed === request) finish({ error: new Error(`[WRITE_REQUEST_FAILED] ${options.label}：请求传输失败（${failed.failure()?.errorText ?? 'unknown'}）；未重发操作`) });
  };
  const onClose = () => finish({ error: new Error(`[WRITE_CONTEXT_CLOSED] ${options.label}：页面已关闭，结果未确认`) });
  page.on('request', onRequest); page.on('response', onResponse);
  page.on('requestfailed', onFailure); page.on('close', onClose);
  try {
    await action();
    actionEndedAt = Date.now(); phase = request ? 'response' : 'request';
    if (!request && !settled) timer = setTimeout(() => finish({ error: new Error(
      `[WRITE_REQUEST_NOT_SENT] ${options.label}：交互已结束，${requestMs}ms内未观察到目标请求；未重发操作`) }), requestMs);
    const result = await outcome;
    if ('error' in result) throw result.error;
    phase = 'response-received'; return result.response;
  } finally {
    clearTimeout(timer);
    page.off('request', onRequest); page.off('response', onResponse);
    page.off('requestfailed', onFailure); page.off('close', onClose);
    try { await test.info().attach('mutation-timings', { contentType: 'application/json', body: JSON.stringify({
      label: options.label, phase, elapsedMs: Date.now() - started,
      requestAfterMs: requestedAt === undefined ? null : requestedAt - started,
      actionMs: actionEndedAt === undefined ? null : actionEndedAt - started,
      responseTimeoutMs: responseMs, requestTimeoutMs: requestMs, replayed: false,
    }) }); } catch { /* Diagnostics must not change the operation result. */ }
  }
}
