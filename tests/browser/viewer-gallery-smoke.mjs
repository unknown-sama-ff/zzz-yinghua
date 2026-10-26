// Run against Vite; all gallery writes are intercepted, never sent to storage.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const sharp = require('sharp');
const base = process.env.STUDIO_BASE_URL || 'http://localhost:5173';
const output = process.env.STUDIO_SCREENSHOT_DIR;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const sources = {};
for (const [name, width, height, color] of [['zero', 900, 600, '#23344c'], ['three', 300, 600, '#c9a933'], ['yang', 600, 400, '#72bcec'], ['yin', 600, 400, '#e05979']]) {
  sources[name] = 'data:image/png;base64,' + (await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer()).toString('base64');
}
const rows = [];
const writes = [];
const runtimeErrors = [];
const unexpectedApis = [];
let reads = 0;
let holdNext = true;
let failNext = false;
let releaseSave;

async function intercept(context) {
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/gallery' && request.method() === 'GET') {
      ++reads;
      return route.fulfill({ json: { ok: true, rows, hasMore: false } });
    }
    if (path === '/api/gallery' && request.method() === 'POST') {
      const body = request.postDataJSON();
      writes.push(body);
      if (failNext) {
        failNext = false;
        return route.fulfill({ status: 503, json: { ok: false, message: '模拟上传失败' } });
      }
      if (holdNext) {
        holdNext = false;
        await new Promise((resolve) => { releaseSave = resolve; });
      }
      const row = { id: 'qa-' + writes.length, image_url: 'data:' + body.mime + ';base64,' + body.imageBase64, style: body.style, character_name: body.characterName, prompt: body.prompt, provider: body.provider, created_at: new Date().toISOString() };
      rows.unshift(row);
      return route.fulfill({ json: { ok: true, row } });
    }
    unexpectedApis.push(path);
    return route.fulfill({ status: 500, json: { ok: false, message: 'Unexpected API in local gallery test' } });
  });
}

async function prepare(page) {
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.locator('[data-yinghua-artboard]').waitFor();
  await page.evaluate(async (images) => {
    const { useYinghuaStore } = await import('/src/store/useYinghuaStore.ts');
    const { useViewerStore } = await import('/src/store/useViewerStore.ts');
    const { useIdentityStore } = await import('/src/store/useIdentityStore.ts');
    const { computeClipRegions } = await import('/src/lib/clipRegions.ts');
    useIdentityStore.getState().setCharacterName('QA VIEWER');
    useYinghuaStore.getState().setYinghuaSlot(1, { status: 'done', images: [images.zero] });
    useYinghuaStore.getState().setYinghuaSlot(2, { status: 'done', images: [images.three] });
    useYinghuaStore.getState().setYinghuaSlot(3, { status: 'done', images: [images.yang, images.yin] });
    useYinghuaStore.getState().setStyle3Face('back');
    useViewerStore.getState().setAllParts(false);
    useViewerStore.getState().togglePart('01');
    useViewerStore.getState().togglePart('05');
    useViewerStore.getState().setViewerClipRegions(computeClipRegions(.2, .35, -5));
  }, sources);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-yinghua-artboard] img')).every((img) => img.complete && img.naturalWidth > 0));
}

function viewerOn(page) {
  return page.locator('section').filter({ has: page.locator('[data-yinghua-artboard]') }).last();
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  await intercept(context);
  const page = await context.newPage();
  await page.goto(base + '/#/gallery');
  await page.getByText('还没有保存的作品', { exact: false }).waitFor();
  const readsBefore = reads;
  await page.getByRole('link', { name: '角色工坊', exact: true }).click();
  await page.getByRole('link', { name: '影画创作', exact: true }).click();
  const viewer = viewerOn(page);
  assert.equal(await viewer.getByRole('button', { name: '保存到画廊', exact: true }).count(), 0, 'no save without a base image');
  await prepare(page);
  const downloadPromise = page.waitForEvent('download');
  await viewer.getByRole('button', { name: '保存当前 PNG', exact: true }).click();
  const png = await readFile(await (await downloadPromise).path());

  const post = page.waitForRequest((request) => request.url().endsWith('/api/gallery') && request.method() === 'POST');
  await viewer.getByRole('button', { name: '保存到画廊', exact: true }).evaluate((button) => { button.click(); button.click(); });
  await post;
  // The browser request event precedes Playwright's route-handler callback.
  for (let wait = 0; writes.length === 0 && wait < 100; ++wait) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(writes.length, 1, 'double click issues one upload');
  assert.equal(writes[0].style, '影画合成');
  assert.equal(writes[0].provider, 'viewer-composite');
  assert.equal(writes[0].characterName, 'QA VIEWER');
  assert.match(writes[0].prompt, /零命底图、01、05/);
  assert.match(writes[0].prompt, /六命：阴/);
  assert.match(writes[0].prompt, /裁切：polygon/);
  assert.equal(writes[0].mime, 'image/webp');
  const uploaded = Buffer.from(writes[0].imageBase64, 'base64');
  const original = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const saved = await sharp(uploaded).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(saved.info.width, 900);
  assert.equal(saved.info.height, 600);
  assert.equal(saved.data.length, original.data.length);
  const meanError = saved.data.reduce((sum, value, index) => sum + Math.abs(value - original.data[index]), 0) / saved.data.length;
  assert.ok(meanError < 4, 'gallery upload must match the PNG composition apart from WebP compression');

  await viewer.getByRole('button', { name: '部分 03 已隐藏', exact: true }).click();
  await viewer.getByRole('button', { name: '全屏', exact: true }).click();
  assert.equal(await viewer.getByRole('button', { name: '保存中…', exact: true }).isDisabled(), true);
  releaseSave();
  await viewer.getByRole('button', { name: '保存到画廊', exact: true }).waitFor();
  assert.equal(await viewer.getByRole('button', { name: '保存到画廊', exact: true }).isEnabled(), true, 'a changed composition is not marked saved by an older upload');
  await viewer.getByRole('button', { name: '退出全屏', exact: true }).click();
  await viewer.getByRole('button', { name: '部分 03 已显示', exact: true }).click();
  await viewer.getByRole('button', { name: '已保存到画廊', exact: true }).waitFor();
  assert.equal(await viewer.getByRole('button', { name: '已保存到画廊', exact: true }).isDisabled(), true);
  if (output) await viewer.screenshot({ path: join(output, 'viewer-gallery-saved.png') });
  await page.getByRole('link', { name: '画廊', exact: true }).click();
  await page.getByText('角色：QA VIEWER', { exact: true }).waitFor();
  assert.ok(reads > readsBefore, 'an already mounted gallery refreshes after save');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('yinghua_gallery_tokens'))['qa-1']), writes[0].deleteToken);
  console.log('PASS exact composite pixels, snapshot metadata, double-click guard, fullscreen shared state, gallery refresh and delete ownership');

  await page.getByRole('link', { name: '角色工坊', exact: true }).click();
  await page.getByRole('link', { name: '影画创作', exact: true }).click();
  await viewer.getByRole('button', { name: '部分 03 已隐藏', exact: true }).click();
  failNext = true;
  await viewer.getByRole('button', { name: '保存到画廊', exact: true }).click();
  await page.getByText('保存到画廊失败：模拟上传失败', { exact: true }).waitFor();
  assert.equal(await viewer.getByRole('button', { name: '保存到画廊', exact: true }).isEnabled(), true);
  await viewer.getByRole('button', { name: '全屏', exact: true }).click();
  await viewer.getByRole('button', { name: '保存到画廊', exact: true }).click();
  await viewer.getByRole('button', { name: '已保存到画廊', exact: true }).waitFor();
  await viewer.getByRole('button', { name: '退出全屏', exact: true }).click();
  assert.equal(writes.length, 3);

  // Exercise the existing single-image button through the same extracted uploader.
  await page.getByRole('navigation', { name: '影画制作步骤' }).getByRole('button', { name: /零命剪影/ }).click();
  await page.locator('[data-yinghua-stage="1"]').getByRole('button', { name: '保存到画廊', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('figcaption')?.textContent?.includes('已保存'));
  assert.equal(writes.length, 4);
  assert.notEqual(writes[3].provider, 'viewer-composite');
  assert.equal('imageUrl' in writes[3], false);
  assert.equal((await sharp(Buffer.from(writes[3].imageBase64, 'base64')).metadata()).width, 900);
  console.log('PASS failure retry in fullscreen and existing generated-image save regression');

  await page.evaluate(async () => {
    const { useYinghuaStore } = await import('/src/store/useYinghuaStore.ts');
    useYinghuaStore.getState().setYinghuaSlot(3, { images: ['/tests/browser/missing-layer.png'] });
  });
  await viewer.getByRole('button', { name: '保存到画廊', exact: true }).waitFor();
  assert.equal(await viewer.getByRole('button', { name: '保存到画廊', exact: true }).isDisabled(), true);
  assert.equal(writes.length, 4);
  await context.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await intercept(mobileContext);
  const mobile = await mobileContext.newPage();
  await mobile.goto(base + '/#/workshop/yinghua');
  await prepare(mobile);
  const mobileViewer = viewerOn(mobile);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobileViewer.getByRole('button', { name: '全屏', exact: true }).click();
  await mobileViewer.getByRole('button', { name: '保存到画廊', exact: true }).click();
  await mobileViewer.getByRole('button', { name: '已保存到画廊', exact: true }).waitFor();
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (output) await mobile.screenshot({ path: join(output, 'viewer-gallery-mobile.png') });
  await mobileViewer.getByRole('button', { name: '退出全屏', exact: true }).click();
  assert.equal(writes.length, 5);
  await mobileContext.close();
  assert.deepEqual(runtimeErrors, []);
  assert.deepEqual(unexpectedApis, [], 'saving a composition must not call image generation');
  console.log(JSON.stringify({ galleryWrites: writes.length, pixelMeanAbsoluteError: meanError, runtimeErrors, mobileFullscreen: 'passed', allWritesMocked: true }, null, 2));
} finally {
  await browser.close();
}
