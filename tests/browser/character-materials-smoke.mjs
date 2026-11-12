// Original-art lineage and two-stage orchestration; all generation is mocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const sharp = require('sharp');
const base = process.env.STUDIO_BASE_URL || 'http://127.0.0.1:5173';
const output = process.env.STUDIO_SCREENSHOT_DIR || 'work/character-materials-browser';
await mkdir(output, { recursive: true });
const images = {};
for (const [name, color] of Object.entries({ originalA: '#274365', sideA: '#376342', originalB: '#9d5634', manual: '#358e91', viewA: '#b47633', viewB: '#85596d', viewB2: '#597c8a', sheetA: '#b3aa85', sheetB: '#759447', sheetB2: '#7767a6' })) {
  images[name] = 'data:image/png;base64,' + (await sharp({ create: { width: 1536, height: 1024, channels: 3, background: color } }).png().toBuffer()).toString('base64');
}
const bytes = (url) => url.split(',')[1];
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const checks = [], requests = [], errors = [];
let release;
let holdNext = false;
let failSheet = false;
let bViews = 0;
let diagnosticPage;
function checked(message) { checks.push(message); console.log('PASS ' + message); }
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  diagnosticPage = page;
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/generate') {
      const request = route.request().postDataJSON();
      const sheet = request.prompt.includes('全景式角色深度概念分解图');
      requests.push({ kind: sheet ? 'breakdown' : 'three-view', body: request });
      if (holdNext) { holdNext = false; await new Promise((resolve) => { release = resolve; }); }
      if (sheet && failSheet) {
        failSheet = false;
        return route.fulfill({ json: { ok: false, code: 'UPSTREAM_ERROR', message: '模拟拆解图失败，三视图已保留' } });
      }
      const alpha = request.prompt.includes('角色名字：ALPHA');
      if (!sheet && !alpha) bViews++;
      const image = sheet ? (alpha ? images.sheetA : bViews === 1 ? images.sheetB : images.sheetB2)
        : alpha ? images.viewA : bViews === 1 ? images.viewB : images.viewB2;
      return route.fulfill({ json: { ok: true, images: [image] } });
    }
    if (path === '/api/image-capabilities') return route.fulfill({ json: { ok: true, presetQualityOptions: ['auto', 'high'] } });
    if (path === '/api/payments/sponsors') return route.fulfill({ json: { ok: true, sponsors: [] } });
    if (path === '/api/gallery' || path === '/api/prompts') return route.fulfill({ json: { ok: true, rows: [], hasMore: false } });
    errors.push('Unexpected API: ' + path);
    return route.fulfill({ json: { ok: false, message: 'Unexpected API' } });
  });
  await page.goto(base + '/#/workshop/assets');
  const oneClick = page.getByRole('button', { name: '一键生成角色素材', exact: true });
  await oneClick.waitFor();
  assert.equal(await oneClick.isDisabled(), true);
  await page.evaluate(async (images) => {
    const { useWorkbenchStore } = await import('/src/store/useWorkbenchStore.ts');
    const { useProviderStore } = await import('/src/store/useProviderStore.ts');
    useWorkbenchStore.getState().setThreeViewUpload('front', images.originalA);
    useWorkbenchStore.getState().setThreeViewUpload('side', images.sideA);
    useProviderStore.getState().setProvider('gpt-image');
    useProviderStore.getState().setCred('gpt-image', { apiKey: 'mock-only', baseUrl: 'https://example.invalid/v1', model: 'gpt-image-2.5-sunburst' });
  }, images);
  assert.equal(await oneClick.isDisabled(), true);
  await page.locator('#character-name').fill('ALPHA');
  checked('one-click generation requires original art and a nonblank character name');

  holdNext = true;
  const firstRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/generate');
  await oneClick.click();
  await firstRequest;
  assert.equal(await page.getByRole('button', { name: '生成三视图中…', exact: true }).isDisabled(), true);
  assert.equal(requests.length, 1);
  await page.locator('#character-name').fill('BETA');
  await page.evaluate(async (source) => {
    const { useWorkbenchStore } = await import('/src/store/useWorkbenchStore.ts');
    useWorkbenchStore.getState().setThreeViewUpload('front', source);
    useWorkbenchStore.getState().setThreeViewUpload('side', null);
  }, images.originalB);
  await page.waitForFunction(() => document.querySelector('.character-materials-generate')?.textContent.includes('生成三视图中'));
  while (!release) await new Promise((resolve) => setTimeout(resolve, 20));
  const secondRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/generate');
  release(); release = undefined;
  await secondRequest;
  await page.waitForFunction(async () => (await import('/src/store/useWorkbenchStore.ts')).useWorkbenchStore.getState().materialsJob?.status === 'done');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.imageBase64, bytes(images.originalA));
  assert.equal(requests[0].body.refImages[0].base64, bytes(images.sideA));
  assert.equal(requests[1].body.imageBase64, bytes(images.originalA));
  assert.deepEqual(requests[1].body.refImages.map((image) => image.base64), [bytes(images.sideA), bytes(images.viewA)]);
  assert.match(requests[1].body.prompt, /与原图冲突时以原图为准/);
  const retained = await page.evaluate(async (source) => {
    const { useCharacterSheetStore } = await import('/src/store/useCharacterSheetStore.ts');
    const { useUploadStore } = await import('/src/store/useUploadStore.ts');
    return { originalCount: useCharacterSheetStore.getState().originalsBySource[source].length,
      breakdown: useCharacterSheetStore.getState().sheets[source].selectedImage,
      selected: useUploadStore.getState().uploadedImage };
  }, images.viewA);
  assert.deepEqual(retained, { originalCount: 2, breakdown: images.sheetA, selected: null });
  assert.equal(await page.locator('#character-name').inputValue(), 'BETA');
  checked('two requests retain captured originals; changing character mid-run never overwrites the new selection');

  await oneClick.click();
  await page.waitForFunction(async () => (await import('/src/store/useWorkbenchStore.ts')).useWorkbenchStore.getState().materialsJob?.status === 'done');
  await page.getByAltText('当前配套角色拆解图', { exact: true }).waitFor();
  assert.equal(requests.length, 4);
  assert.equal(requests[2].body.imageBase64, bytes(images.originalB));
  assert.equal(requests[3].body.imageBase64, bytes(images.originalB));
  assert.equal(requests[3].body.refImages[0].base64, bytes(images.viewB));
  assert.equal(await page.getByAltText('当前配套角色拆解图', { exact: true }).getAttribute('src'), images.sheetB);
  checked('one-click success automatically selects the new three-view and its matching breakdown');

  failSheet = true;
  await oneClick.click();
  await page.waitForFunction(async () => (await import('/src/store/useWorkbenchStore.ts')).useWorkbenchStore.getState().materialsJob?.status === 'error');
  assert.equal(requests.length, 6);
  assert.equal(await page.locator('section[data-inpaint-zone="three-view"] img[alt="three-view-1"]').getAttribute('src'), images.viewB2);
  await page.getByText('上次三视图已保留，再次点击仅重试拆解图。', { exact: false }).waitFor();
  await oneClick.click();
  await page.waitForFunction(async () => (await import('/src/store/useWorkbenchStore.ts')).useWorkbenchStore.getState().materialsJob?.status === 'done');
  assert.equal(requests.length, 7);
  assert.equal(requests[6].kind, 'breakdown');
  assert.equal(requests[6].body.imageBase64, bytes(images.originalB));
  assert.equal(requests[6].body.refImages[0].base64, bytes(images.viewB2));
  assert.equal(await page.getByAltText('当前配套角色拆解图', { exact: true }).getAttribute('src'), images.sheetB2);
  checked('a failed breakdown preserves its successful three-view and retry makes only one additional generation');

  const assets = page.getByRole('region', { name: '角色拆解图工作台' });
  await assets.getByLabel('上传原始角色参考', { exact: true }).setInputFiles({ name: 'original-manual.png', mimeType: 'image/png', buffer: Buffer.from(bytes(images.manual), 'base64') });
  await page.waitForFunction(async (source) => {
    const { useCharacterSheetStore } = await import('/src/store/useCharacterSheetStore.ts');
    return !useCharacterSheetStore.getState().sheets[source]?.uploading;
  }, images.viewB2);
  const manualRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/generate');
  await assets.getByRole('button', { name: '生成角色拆解图', exact: true }).click();
  await manualRequest;
  assert.equal(requests.at(-1).body.imageBase64, bytes(images.manual));
  assert.equal(requests.at(-1).body.refImages[0].base64, bytes(images.viewB2));
  await assets.getByRole('button', { name: '生成角色拆解图', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /动作参考/ }).count(), 0);
  checked('manual original association changes the canonical input while keeping the selected three-view as auxiliary; no action-reference control is added');

  await page.screenshot({ path: output + '/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: output + '/mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  checked('one-click controls and original-reference previews fit desktop and mobile');
  await writeFile(output + '/report.json', JSON.stringify({ ok: true, checks, requestCount: requests.length, errors }, null, 2));
} catch (error) {
  const state = diagnosticPage ? await diagnosticPage.evaluate(async () => {
    const { useWorkbenchStore } = await import('/src/store/useWorkbenchStore.ts');
    const job = useWorkbenchStore.getState().materialsJob;
    return { job: job ? { status: job.status, phase: job.phase, name: job.input.name, error: job.error } : null,
      button: document.querySelector('.character-materials-generate')?.textContent };
  }).catch(() => null) : null;
  await writeFile(output + '/report.json', JSON.stringify({ ok: false, checks, errors, error: String(error).slice(0, 1200),
    state, requests: requests.map((request) => ({ kind: request.kind, prompt: request.body.prompt.slice(0, 180), referenceCount: request.body.refImages?.length ?? 0 })) }, null, 2));
  throw error;
} finally { await browser.close(); }
