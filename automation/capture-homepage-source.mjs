import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const sourceUrl = process.env.HOMEPAGE_SOURCE_URL ?? 'https://jujubit.ai/';
const outputDir = path.resolve(
  process.cwd(),
  process.env.HOMEPAGE_SOURCE_DIR ?? 'reference/jujubit-homepage/source'
);
const resourceDir = path.join(outputDir, 'resources');

await mkdir(resourceDir, { recursive: true });

const pageResponse = await fetch(sourceUrl, {
  headers: { 'user-agent': 'JuJuBit UI regression source capture' },
  signal: AbortSignal.timeout(60_000)
});
if (!pageResponse.ok) {
  throw new Error(`首页源码下载失败：HTTP ${pageResponse.status}`);
}

const html = await pageResponse.text();
await writeFile(path.join(outputDir, 'index.html'), html, 'utf8');

const resourceUrls = collectCodeResources(html, sourceUrl);
const resources = [];
for (const url of resourceUrls) {
  try {
    const { response, downloadedFrom } = await fetchCodeResource(url);
    const contentType = response.headers.get('content-type') ?? '';
    const data = Buffer.from(await response.arrayBuffer());
    const fileName = resourceFileName(url, contentType);
    await writeFile(path.join(resourceDir, fileName), data);
    resources.push({
      url,
      ...(downloadedFrom === url ? {} : { downloadedFrom }),
      file: `resources/${fileName}`,
      bytes: data.length,
      contentType
    });
  } catch (error) {
    resources.push({
      url,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

const manifest = {
  sourceUrl,
  capturedAt: new Date().toISOString(),
  htmlBytes: Buffer.byteLength(html),
  resourceCount: resources.length,
  successfulResources: resources.filter((item) => !item.error).length,
  resources
};
await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(
  `[homepage-source] HTML ${manifest.htmlBytes} bytes; ` +
  `code resources ${manifest.successfulResources}/${manifest.resourceCount}; ${outputDir}`
);

function collectCodeResources(document, baseUrl) {
  const urls = new Set();
  for (const match of document.matchAll(/<script\b[^>]*\bsrc=(['"])(.*?)\1[^>]*>/giu)) {
    addUrl(urls, match[2], baseUrl);
  }
  for (const match of document.matchAll(/<link\b[^>]*>/giu)) {
    const tag = match[0];
    const href = tag.match(/\bhref=(['"])(.*?)\1/iu)?.[2];
    const rel = tag.match(/\brel=(['"])(.*?)\1/iu)?.[2]?.toLowerCase() ?? '';
    const as = tag.match(/\bas=(['"])(.*?)\1/iu)?.[2]?.toLowerCase() ?? '';
    if (href && (rel.includes('stylesheet') || as === 'style' || as === 'script' || /\.(?:css|js)(?:[?#]|$)/iu.test(href))) {
      addUrl(urls, href, baseUrl);
    }
  }
  return [...urls].sort();
}

function addUrl(urls, candidate, baseUrl) {
  if (!candidate || candidate.startsWith('data:')) return;
  const normalized = candidate.startsWith('//') ? `https:${candidate}` : new URL(candidate, baseUrl).href;
  urls.add(normalized);
}

async function fetchCodeResource(url) {
  const candidates = [url, ...fallbackUrls(url)];
  const errors = [];
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        headers: { 'user-agent': 'JuJuBit UI regression source capture' },
        signal: AbortSignal.timeout(60_000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { response, downloadedFrom: candidate };
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(errors.join('; '));
}

function fallbackUrls(url) {
  const parsed = new URL(url);
  if (parsed.hostname !== 'cdn.jsdelivr.net' || !parsed.pathname.startsWith('/npm/')) return [];
  const npmPath = parsed.pathname.slice('/npm/'.length);
  const urls = [`https://unpkg.com/${npmPath}`];
  if (npmPath.includes('.min.js')) urls.push(`https://unpkg.com/${npmPath.replace('.min.js', '.js')}`);
  return urls;
}

function resourceFileName(url, contentType) {
  const parsed = new URL(url);
  const originalBase = path.basename(parsed.pathname) || 'resource';
  const safeBase = originalBase.replace(/[^A-Za-z0-9._-]+/gu, '-').slice(0, 100);
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 12);
  const hasExtension = /\.[A-Za-z0-9]{1,8}$/u.test(safeBase);
  const extension = hasExtension ? '' : contentType.includes('css') ? '.css' : '.js';
  return `${hash}-${safeBase}${extension}`;
}
