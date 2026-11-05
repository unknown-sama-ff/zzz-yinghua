// Uploaded mermaid showcase. API calls are intercepted to keep homepage checks local.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.STUDIO_BASE_URL || 'http://localhost:5190';
const output = resolve(process.env.HOME_SCREENSHOT_DIR || 'node_modules/.cache/home-mermaid-qa');
await mkdir(output, { recursive: true });
let vite;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const errors = []; const failedAssets = []; const apiCalls = [];
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
try {
  if (process.env.HOME_START_VITE === '1') {
    const { createServer } = await import('vite');
    const address = new URL(base);
    vite = await createServer({ server: { host: address.hostname, port: Number(address.port), strictPort: true }, clearScreen: false });
    await vite.listen();
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'no-preference' });
  await context.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname; apiCalls.push(path);
    return route.fulfill({ json: { ok: true, rows: [], hasMore: false, sponsors: [], presetQualityOptions: ['auto'] } });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => { if (response.status() >= 400 && !response.url().includes('/api/')) failedAssets.push(response.url()); });
  await page.goto(base);
  const features = page.locator('.home-features');
  await features.scrollIntoViewIfNeeded();
  assert.equal(await features.getByRole('button', { name: '主体分层', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await features.locator('.feature-selector, .feature-puzzle-pieces').count(), 0);
  assert.equal(await features.getByRole('button', { name: /散开|拼合|GIF|降噪|反推/ }).count(), 0);
  await features.locator('.feature-portrait.is-layered').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.feature-portrait-art img')].every((image) => image.complete && image.naturalWidth === 941 && image.naturalHeight === 1672));
  const sources = await features.locator('.feature-portrait-art img').evaluateAll((images) => images.map((image) => image.getAttribute('src')));
  assert.equal(sources.length, 3); assert.ok(sources.every((source) => source.includes('mermaid-demo-')));
  assert.match(await features.innerText(), /空间上位于角色前方/);
  assert.match(await features.innerText(), /本图前景层透明/);
  assert.match(await features.innerText(), /鱼尾/);
  const art = await features.locator('.feature-portrait-art').boundingBox();
  assert.ok(Math.abs(art.width / art.height - 941 / 1672) < 0.001, 'the complete portrait stays at its original ratio');
  await page.mouse.move(art.x + art.width * 0.9, art.y + art.height * 0.6);
  assert.ok(await features.locator('.feature-portrait').evaluate((node) => Math.abs(parseFloat(node.style.getPropertyValue('--demo-x'))) > 1));
  await features.getByRole('button', { name: '原画 2D', exact: true }).click();
  await features.locator('.feature-portrait.is-flat').waitFor();
  assert.equal(await features.locator('.feature-portrait-art img').count(), 1);
  await features.getByRole('button', { name: '悬浮相片', exact: true }).press('Enter');
  await features.locator('.feature-portrait.is-floating').waitFor();
  await features.getByRole('button', { name: '主体分层', exact: true }).click();
  assert.deepEqual(apiCalls, [], 'local showcase must not start gallery or model requests');
  assert.ok(await noOverflow(page));
  const previewStyle = '.studio-header,.studio-skip-link,.cursor-effects-root{visibility:hidden!important}';
  await features.screenshot({ path: resolve(output, 'mermaid-desktop.png'), style: previewStyle });
  console.log('PASS default layered mermaid, three display modes, full portrait, spatial foreground definition and no scatter/tool demos');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of ['原画 2D', '悬浮相片', '主体分层']) {
      await features.getByRole('button', { name, exact: true }).click();
      assert.ok(await noOverflow(page), `${name} overflows at ${width}px`);
    }
    await features.screenshot({ path: resolve(output, `mermaid-mobile-${width}.png`), style: previewStyle });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await features.locator('.feature-portrait-art img').nth(1).evaluate((image) => getComputedStyle(image).transform), 'none');
  await features.getByRole('link', { name: '打开美图拼图', exact: false }).click();
  await page.waitForFunction(() => location.hash === '#/puzzle');
  assert.ok(!apiCalls.includes('/api/puzzle-layers') && !apiCalls.includes('/api/generate'));
  assert.deepEqual(errors, []); assert.deepEqual(failedAssets, []);
  console.log('PASS mobile 390/320px, reduced motion, actual puzzle entry and all local mermaid assets');
  await context.close();
} finally { await browser.close(); await vite?.close(); }
