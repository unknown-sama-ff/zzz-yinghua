// Run against Vite. All API/model requests are intercepted; no paid generation occurs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.STUDIO_BASE_URL || 'http://localhost:5173';
const output = resolve(process.env.PUZZLE_SCREENSHOT_DIR || 'node_modules/.cache/puzzle-qa');
await mkdir(output, { recursive: true });
const fallback = await readFile('public/作者推荐/自由版.webp');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
let vite;
const errors = [];
let galleryMode = 'ready';
let releaseGeneration;
let generationCalls = 0;
let proxyCalls = 0;
const offsets = [];
const row = (id, style, image_url) => ({ id, style, image_url, created_at: '', character_name: '拼图测试', prompt: '', provider: '' });
const first = [row(1, '三视图', '/unused.webp')];
const second = [row(2, '自由创作', '/作者推荐/自由版.webp'), row(3, '海报版', '/作者推荐/海报版.webp'), row(4, '动作底稿', 'https://images.invalid/puzzle-broken.webp')];
async function setup(context) {
  await context.addInitScript(() => { Math.random = () => 0.37; });
  await context.route('https://images.invalid/**', (route) => route.abort());
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/gallery') {
      if (galleryMode === 'error') return route.fulfill({ status: 503, json: { ok: false, message: '模拟图库暂时不可用' } });
      if (galleryMode === 'empty') return route.fulfill({ json: { ok: true, rows: first, hasMore: false } });
      const offset = Number(url.searchParams.get('offset')); offsets.push(offset);
      return route.fulfill({ json: { ok: true, rows: offset === 0 ? first : second, hasMore: offset === 0 } });
    }
    if (url.pathname === '/api/proxy-image') { proxyCalls++; return route.fulfill({ contentType: 'image/webp', body: fallback }); }
    if (url.pathname === '/api/generate') {
      generationCalls++;
      await new Promise((done) => { releaseGeneration = done; });
      return route.fulfill({ json: { ok: true, images: ['data:image/webp;base64,' + fallback.toString('base64')] } });
    }
    return route.fulfill({ json: { ok: true, presetQualityOptions: ['auto'], sponsors: [] } });
  });
}
const check = (message) => console.log('PASS ' + message);
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const fragment = (page, id) => page.locator(`.puzzle-piece[data-piece='${id}']`);
async function center(page, id) { const box = await fragment(page, id).boundingBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }
async function visiblePoint(page, id) {
  return fragment(page, id).evaluate((el) => {
    const bounds = el.getBoundingClientRect();
    for (const y of [0.5, 0.3, 0.7, 0.2, 0.8]) for (const x of [0.5, 0.3, 0.7, 0.2, 0.8]) {
      const px = bounds.left + bounds.width * x; const py = bounds.top + bounds.height * y;
      if (el.contains(document.elementFromPoint(px, py))) return { x: px, y: py, dx: bounds.width * (x - 0.5), dy: bounds.height * (y - 0.5) };
    }
    throw new Error('Fragment is not reachable: ' + el.dataset.piece);
  });
}
async function dragTo(page, id, x, y) {
  const from = await visiblePoint(page, id);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(x + from.dx, y + from.dy, { steps: 14 }); await page.mouse.up();
  await fragment(page, id).evaluate(async (el) => { getComputedStyle(el).transform; await Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {}))); });
}
async function touchDrag(page, session, id, x, y) {
  const from = await visiblePoint(page, id);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= 12; i++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (x + from.dx - from.x) * i / 12, y: from.y + (y + from.dy - from.y) * i / 12 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await fragment(page, id).evaluate(async (el) => { getComputedStyle(el).transform; await Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {}))); });
}
try {
  if (process.env.PUZZLE_START_VITE === '1') {
    const { createServer } = await import('vite');
    const address = new URL(base);
    vite = await createServer({ server: { host: address.hostname, port: Number(address.port) || 5173, strictPort: true }, clearScreen: false });
    await vite.listen();
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 2300 }, reducedMotion: 'no-preference' });
  await setup(context);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const nav = page.getByRole('navigation', { name: '主导航' });
  await page.goto(base);
  await page.locator('.home-puzzle-hint').waitFor();
  assert.equal(offsets.length, 0, 'home does not fetch the gallery');
  await page.locator('.home-puzzle-hint').click();
  await page.locator('.puzzle-piece').first().waitFor();
  assert.equal(await page.locator('.puzzle-piece').count(), 12);
  await page.getByText(/海报版.*3 列 × 4 行/).waitFor();
  assert.deepEqual(offsets, [0, 1], 'older gallery page participates and StrictMode shares requests');
  assert.equal(await page.locator('.puzzle-board, .puzzle-target').count(), 0, 'fixed placement frame and target cells are removed');
  const dimensions = await page.locator('.puzzle-piece image').first().evaluate((el) => ({ w: Number(el.getAttribute('width')), h: Number(el.getAttribute('height')) }));
  assert.ok(Math.abs(dimensions.w / dimensions.h - 2 / 3) < 0.01);
  const cw = dimensions.w / 3; const ch = dimensions.h / 4;
  assert.ok(await noOverflow(page));
  check('home entry; gallery pagination; adaptive portrait pieces; no placement frame or target cells');

  const matBox = await page.locator('.puzzle-mat').boundingBox();
  assert.ok(Math.abs(matBox.width - matBox.height) < 0.1, 'canvas is a fixed square based on page width');
  assert.ok(await page.locator('.puzzle-piece').evaluateAll((pieces) => new Set(pieces.map((piece) => piece.getBoundingClientRect().y.toFixed(2))).size === pieces.length), 'random scatter is not arranged in rows');
  await dragTo(page, 0, matBox.x + 151 + cw / 2, matBox.y + 121 + ch / 2);
  let anchor = await center(page, 0);
  await dragTo(page, 11, anchor.x + cw, anchor.y);
  assert.equal(await page.locator('.puzzle-mat').getAttribute('data-group-count'), '12', 'wrong neighbors never attach');
  await dragTo(page, 11, matBox.x + 1050, matBox.y + 440);
  await dragTo(page, 1, anchor.x + cw + 6, anchor.y + 4);
  assert.equal(await fragment(page, 0).getAttribute('data-group'), await fragment(page, 1).getAttribute('data-group'));
  assert.equal(await fragment(page, 0).getAttribute('data-group-size'), '2');
  await page.locator('.puzzle-snap-burst').waitFor();
  assert.equal(await fragment(page, 1).evaluate((el) => getComputedStyle(el).transitionDuration), '0.17s');
  assert.equal(await fragment(page, 1).locator('.puzzle-piece-outline').evaluate((el) => getComputedStyle(el).animationName), 'puzzle-snap-glow');
  await page.screenshot({ path: resolve(output, 'puzzle-snap.png'), fullPage: true });
  const before0 = await center(page, 0); const before1 = await center(page, 1);
  await dragTo(page, 1, before1.x + 80, before1.y + 40);
  const after0 = await center(page, 0); const after1 = await center(page, 1);
  assert.ok(Math.abs((after0.x - before0.x) - (after1.x - before1.x)) < 0.5);
  assert.ok(Math.abs((after0.y - before0.y) - (after1.y - before1.y)) < 0.5);
  await dragTo(page, 3, matBox.x + 800, matBox.y + 280);
  const other = await center(page, 3);
  await dragTo(page, 4, other.x + cw + 5, other.y + 3);
  assert.equal(await fragment(page, 3).getAttribute('data-group-size'), '2');
  anchor = await center(page, 0);
  await dragTo(page, 3, anchor.x + 5, anchor.y + ch + 4);
  for (const id of [0, 1, 3, 4]) assert.equal(await fragment(page, id).getAttribute('data-group-size'), '4');
  assert.equal(await page.locator('.puzzle-mat').getAttribute('data-group-count'), '9');
  check('mouse drag joins correct neighbors; snap animation; dragging either member moves the whole; two subgroups merge');
  await nav.getByRole('link', { name: '首页', exact: true }).click();
  await nav.getByRole('link', { name: '美图拼图', exact: true }).click();
  assert.equal(await fragment(page, 0).getAttribute('data-group-size'), '4');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '查看原图', exact: true }).click();
  await page.getByRole('img', { name: '拼图原图提示' }).waitFor();
  assert.equal(await fragment(page, 0).getAttribute('data-group-size'), '4');
  const mobile0 = await center(page, 0); const mobile1 = await center(page, 1);
  const mobileWidth = await fragment(page, 0).locator('image').evaluate((el) => Number(el.getAttribute('width')) / 3);
  assert.ok(Math.abs(mobile1.x - mobile0.x - mobileWidth) < 0.1, 'connected members keep their alignment after resize');
  assert.ok(await noOverflow(page));
  await page.screenshot({ path: resolve(output, 'puzzle-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '隐藏原图', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 2300 });
  await page.waitForFunction((width) => Number(document.querySelector('.puzzle-piece image').getAttribute('width')) === width, dimensions.w);
  for (const id of [2, 5, 6, 7, 8, 9, 10, 11]) {
    anchor = await center(page, 0);
    await dragTo(page, id, anchor.x + id % 3 * cw + 3, anchor.y + Math.floor(id / 3) * ch + 2);
  }
  await page.locator('.puzzle-mat[data-complete=true]').waitFor();
  assert.equal(await page.locator('.puzzle-mat').getAttribute('data-group-count'), '1');
  await page.locator('.puzzle-reveal[data-phase=ready]').waitFor();
  const card = page.getByRole('button', { name: /^切换视差效果/ });
  await page.locator('.puzzle-reveal-presentation').evaluate(async (el) => { getComputedStyle(el).transform; await Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {}))); });
  const completedMat = await page.locator('.puzzle-mat').boundingBox(); const cardBounds = await card.boundingBox();
  assert.ok(Math.abs(cardBounds.x + cardBounds.width / 2 - completedMat.x - completedMat.width / 2) < 0.5);
  assert.ok(Math.abs(cardBounds.y + cardBounds.height / 2 - completedMat.y - completedMat.height / 2) < 0.5);
  assert.equal(await page.locator('.puzzle-mat').getAttribute('data-showcase'), 'true');
  await page.mouse.move(cardBounds.x + cardBounds.width * 0.8, cardBounds.y + cardBounds.height * 0.35);
  assert.ok(await page.locator('.puzzle-reveal').evaluate((el) => Math.abs(parseFloat(el.style.getPropertyValue('--tilt-y'))) > 1));
  await page.locator('.puzzle-mat').screenshot({ path: resolve(output, 'puzzle-complete.png') });
  for (const mode of ['layers', 'lens', 'flat']) {
    await card.click();
    await page.locator(`.puzzle-reveal[data-mode='${mode}'][data-flipping=false]`).waitFor();
    if (mode === 'layers') await page.locator('.puzzle-mat').screenshot({ path: resolve(output, 'puzzle-parallax-layers.png') });
  }
  assert.equal(await page.locator('.puzzle-reveal-tilt').evaluate((el) => getComputedStyle(el).transform), 'none');
  await page.getByRole('button', { name: '开启 2.5D', exact: true }).click();
  await page.locator('.puzzle-reveal[data-mode=float][data-flipping=false]').waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await card.click();
  await page.locator('.puzzle-reveal[data-mode=layers][data-flipping=false]').waitFor();
  assert.equal(await page.locator('.puzzle-reveal-tilt').evaluate((el) => getComputedStyle(el).transform), 'none', 'reduced motion disables pointer tilting and page turns');
  await page.getByRole('button', { name: '切回 2D', exact: true }).click();
  await page.locator('.puzzle-reveal[data-mode=flat]').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const squareMobile = await page.locator('.puzzle-mat').boundingBox();
  assert.ok(Math.abs(squareMobile.width - squareMobile.height) < 0.1);
  assert.ok(await noOverflow(page));
  await page.locator('.puzzle-mat').screenshot({ path: resolve(output, 'puzzle-complete-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 2300 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  check('free random scatter; square canvas; full mouse assembly centers automatically; pointer parallax, three page-turn modes, 2D toggle and reduced motion');

  await page.getByRole('button', { name: /普通/ }).click();
  assert.equal(await page.locator('.puzzle-piece').count(), 24);
  await page.getByRole('button', { name: /困难/ }).click();
  assert.equal(await page.locator('.puzzle-piece').count(), 48);
  await page.getByRole('button', { name: '换一张', exact: true }).click();
  await page.getByText(/自由创作.*8 列 × 6 行/).waitFor();
  assert.equal(await page.locator('.puzzle-mat').getAttribute('data-group-count'), '48');
  await page.getByRole('button', { name: '查看原图', exact: true }).click();
  await page.screenshot({ path: resolve(output, 'puzzle-desktop.png'), fullPage: true });
  await page.evaluate(() => { Math.random = () => 0.99; });
  await page.getByRole('button', { name: '换一张', exact: true }).click();
  await page.getByText(/动作底稿.*8 列 × 6 行/).waitFor();
  assert.ok(proxyCalls > 0, 'direct image failure falls back to the backend proxy');
  assert.equal(offsets.length, 2, 'redraw reuses the already loaded pool');
  check('three difficulties; landscape adaptive layout; redraw avoids current image; image proxy fallback');

  await page.evaluate(async () => {
    const { useProviderStore } = await import('/src/store/useProviderStore.ts');
    useProviderStore.getState().setCred('gpt-image', { apiKey: 'qa-placeholder', baseUrl: 'https://example.invalid/v1' });
  });
  await page.getByRole('button', { name: '自由创作', exact: false }).first().click();
  const free = page.locator('#free-create-window');
  await free.locator('textarea').fill('拼图期间继续生成');
  await free.getByRole('button', { name: '发送创作请求', exact: true }).click();
  await page.locator('.free-create-puzzle-link').waitFor();
  await page.locator('.free-create-puzzle-link').click();
  await free.waitFor({ state: 'hidden' });
  assert.equal(generationCalls, 1);
  releaseGeneration();
  await page.getByRole('button', { name: '自由创作', exact: false }).first().click();
  await free.getByRole('img', { name: '自由创作结果 1', exact: true }).waitFor();
  await free.getByRole('button', { name: '收起自由创作', exact: true }).click();
  assert.equal(await page.locator('.puzzle-piece').count(), 48);
  check('generation continues and completes after using the puzzle link');
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await setup(mobile);
  const touch = await mobile.newPage();
  touch.on('pageerror', (error) => errors.push(error.message));
  galleryMode = 'error';
  await touch.goto(base + '/#/puzzle');
  await touch.getByRole('alert').filter({ hasText: '模拟图库暂时不可用' }).waitFor();
  galleryMode = 'empty';
  await touch.getByRole('button', { name: '重新抽取', exact: true }).click();
  await touch.getByRole('alert').filter({ hasText: '图库里还没有可用' }).waitFor();
  galleryMode = 'ready';
  await touch.getByRole('button', { name: '重新抽取', exact: true }).click();
  await touch.locator('.puzzle-piece').first().waitFor();
  await touch.locator('.puzzle-mat').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 150));
  const session = await mobile.newCDPSession(touch);
  const touchMat = await touch.locator('.puzzle-mat').boundingBox();
  const touchWidth = await fragment(touch, 0).locator('image').evaluate((el) => Number(el.getAttribute('width')) / 3);
  await touchDrag(touch, session, 0, touchMat.x + 55 + touchWidth / 2, touchMat.y + 280);
  const touchAnchor = await center(touch, 0);
  await touchDrag(touch, session, 1, touchAnchor.x + touchWidth + 3, touchAnchor.y + 2);
  assert.equal(await fragment(touch, 0).getAttribute('data-group-size'), '2');
  assert.equal(await fragment(touch, 1).evaluate((el) => getComputedStyle(el).transitionDuration), '0s', 'reduced motion removes animated movement');
  assert.ok(await noOverflow(touch));
  await mobile.close();
  check('mobile touch dragging and snapping; reduced motion; gallery failure and empty states recover on retry');
  assert.deepEqual(errors, []);
  console.log('Screenshots: ' + output);
} finally { await browser.close(); await vite?.close(); }
