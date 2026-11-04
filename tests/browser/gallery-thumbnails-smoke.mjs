// Real thumbnail transforms with mocked storage reads; no hosted writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { createGalleryThumbnailService, encodeGalleryThumbnail } from '../../server/lib/galleryThumbnails.js';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const original = await readFile('public/作者推荐/自由版.webp');
const thumbnail = await encodeGalleryThumbnail(original);
const output = resolve('node_modules/.cache/gallery-thumbnails-20261105'); await mkdir(output, { recursive: true });
const vite = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } }); await vite.listen();
const base = vite.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
let originalRequests = 0, proxyRequests = 0, thumbnailFailures = 0, backendReads = 0;
const rows = [{ id: 1, style: '海报版', image_url: base + '/gallery-original.webp', created_at: '' }, { id: 2, style: '自由创作', image_url: base + '/new-full.webp', created_at: '' }];
let fallbackMode = false;
const service = createGalleryThumbnailService({ lookupImage: async (id) => rows.find((row) => row.id === Number(id)), loadImage: async (url) => { backendReads++; return url.endsWith('-thumb.webp') ? thumbnail : original; } });
service.remember(rows);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.route('**/api/**', async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/gallery') return route.fulfill({ json: { ok: true, rows: fallbackMode ? [{ id: 3, style: '回退作品', image_url: base + '/fallback-original.webp', created_at: '' }] : rows, hasMore: false } });
  const id = url.pathname.match(/^\/api\/gallery\/(\d+)\/thumbnail$/)?.[1];
  if (id) {
    if (id === '3') { thumbnailFailures++; return route.fulfill({ status: 503, body: '' }); }
    return route.fulfill({ contentType: 'image/webp', body: await service.get(id) });
  }
  if (url.pathname === '/api/proxy-image') { proxyRequests++; return route.fulfill({ contentType: 'image/webp', body: original }); }
  return route.fulfill({ json: { ok: true, rows: [], sponsors: [] } });
});
await page.route('**/gallery-original.webp', (route) => { originalRequests++; return route.fulfill({ contentType: 'image/webp', body: original }); });
try {
  await page.goto(base + '/#/gallery');
  const gallery = page.locator('.studio-page[aria-label="画廊"]');
  await gallery.getByAltText('海报版', { exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.studio-page[aria-label="画廊"] img')].every((image) => image.complete && image.naturalWidth > 0));
  assert.equal(originalRequests, 0, 'gallery tiles must not request full images'); assert.equal(proxyRequests, 0);
  assert.equal(await gallery.getByAltText('海报版', { exact: true }).evaluate((image) => image.naturalWidth), 640);
  assert.equal(backendReads, 2, 'one legacy source and one stored thumbnail');
  await gallery.getByRole('button', { name: '放大查看' }).first().click();
  const lightbox = page.getByRole('dialog', { name: '海报版' }); await lightbox.waitFor();
  await page.waitForFunction(() => document.querySelector('[role="dialog"] img')?.naturalWidth > 640);
  assert.equal(originalRequests, 1); assert.match(await lightbox.locator('img').getAttribute('src'), /gallery-original\.webp$/);
  await page.getByRole('button', { name: '关闭大图' }).click();
  fallbackMode = true; await gallery.getByRole('button', { name: '刷新画廊' }).click();
  await page.waitForFunction(() => document.querySelector('img[alt="回退作品"]')?.naturalWidth > 0);
  assert.equal(thumbnailFailures, 1); assert.equal(proxyRequests, 1);
  assert.match(await gallery.getByAltText('回退作品', { exact: true }).getAttribute('src'), /\/proxy-image\?/);
  await page.setViewportSize({ width: 360, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: resolve(output, 'gallery-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ originalBytes: original.length, thumbnailBytes: thumbnail.length, reductionPercent: Math.round((1 - thumbnail.length / original.length) * 100), listOriginalRequests: 0, zoomOriginalRequests: originalRequests, thumbnailFallbacks: proxyRequests, browserErrors: errors }));
} finally { await browser.close(); await vite.close(); }
