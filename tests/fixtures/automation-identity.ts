import { test as base, expect, type Browser, type BrowserContext, type BrowserContextOptions } from '@playwright/test';

export const SDK_ANONYMOUS_ID_KEY = 'sdk_anonymous_id';
export const SDK_ANONYMOUS_ID_VALUE = 'test';

export function automationOrigins(baseURL?: string): string[] {
  const url = new URL(baseURL ?? process.env.TRACKING_BASE_URL ?? process.env.BASE_URL ?? 'https://jujubit.ai');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('自动化目标必须是 HTTP(S) 地址');
  const origins = new Set([url.origin]);
  // Allow the storefront's www redirect, not arbitrary payment/login domains.
  if (['jujubit.ai', 'www.jujubit.ai'].includes(url.hostname)) {
    origins.add('https://jujubit.ai');
    origins.add('https://www.jujubit.ai');
  }
  return [...origins];
}

export async function installAutomationIdentity(context: BrowserContext, baseURL?: string): Promise<void> {
  await context.addInitScript(({ origins, key, value }) => {
    if (!origins.includes(window.location.origin)) return;
    // Run before the site's SDK initializes, on every navigation/new page.
    // Only set this exact key; do not change _anonymous_id or Statsig stable IDs.
    window.localStorage.setItem(key, value);
  }, { origins: automationOrigins(baseURL), key: SDK_ANONYMOUS_ID_KEY, value: SDK_ANONYMOUS_ID_VALUE });
}

export async function createAutomationContext(browser: Browser, options: BrowserContextOptions = {}): Promise<BrowserContext> {
  const context = await browser.newContext(options);
  try {
    await installAutomationIdentity(context, options.baseURL);
    return context;
  } catch (error) {
    await context.close();
    throw error;
  }
}

export const test = base.extend({
  context: async ({ context, baseURL }, use, testInfo) => {
    await installAutomationIdentity(context, baseURL);
    testInfo.annotations.push({ type: SDK_ANONYMOUS_ID_KEY, description: SDK_ANONYMOUS_ID_VALUE });
    await use(context);
  }
});
export { expect };
