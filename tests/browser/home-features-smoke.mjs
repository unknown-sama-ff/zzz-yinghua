// Scroll assembly and layered mermaid showcase. API calls stay local.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.STUDIO_BASE_URL || 'http://localhost:5190';
const output = resolve(process.env.HOME_SCREENSHOT_DIR || 'work/home-features-qa');
await mkdir(output, { recursive: true });
let vite;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const errors = []; const failedAssets = []; const apiCalls = [];
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function scrollAssembly(page, progress) {
  await page.locator('.feature-scroll-track').evaluate((node, progress) => {
    window.scrollTo({ top: node.getBoundingClientRect().top + scrollY - innerHeight * .68 + progress * innerHeight * 1.03, behavior: 'instant' });
  }, progress);
  await page.waitForFunction((target) => Math.abs(parseFloat(document.querySelector('.feature-scroll-track').style.getPropertyValue('--assembly-progress')) - target * 100) < 2, progress);
}
async function settledTransform(locator) {
  return locator.evaluate(async (node) => {
    getComputedStyle(node).transform;
    await Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
    const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
    return { x: matrix.m41, y: matrix.m42, tiltX: matrix.m23, tiltY: matrix.m13 };
  });
}
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
  const memes = page.locator('.home-memes');
  await memes.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('.home-meme-art img')?.naturalWidth > 0);
  await memes.screenshot({ path: resolve(output, 'memes-desktop.png') });
  await memes.getByRole('button', { name: '放大星云无字表情包九宫格', exact: true }).click();
  await page.waitForFunction(() => [...document.images].some((image) => image.getAttribute('src') === '/作品示例/xingyun-meme-grid.webp' && image.naturalWidth === 1536));
  await page.keyboard.press('Escape');
  assert.equal(await memes.getByRole('link', { name: '制作我的表情包', exact: false }).getAttribute('href'), '#/memes');
  const features = page.locator('.home-features');
  const previewStyle = '.studio-header,.studio-skip-link,.cursor-effects-root{visibility:hidden!important}';
  await scrollAssembly(page, 0);
  const scattered = await settledTransform(features.locator('.feature-puzzle-piece').first());
  assert.ok(Math.abs(scattered.x) > 20);
  await scrollAssembly(page, .36);
  const assembling = await settledTransform(features.locator('.feature-puzzle-piece').first());
  assert.ok(Math.abs(assembling.x) < Math.abs(scattered.x));
  await page.screenshot({ path: resolve(output, 'puzzle-assembling-desktop.png') });
  await scrollAssembly(page, 1);
  assert.equal(await features.locator('.feature-scroll-track').getAttribute('data-assembly'), 'complete');
  assert.ok(await features.locator('.feature-puzzle-pieces').evaluate((node) => Number(getComputedStyle(node).opacity) < .001));
  assert.equal(await features.locator('.feature-portrait-art').evaluate((node) => getComputedStyle(node).opacity), '1');
  const stage = await features.locator('.feature-stage').boundingBox();
  assert.ok(stage.y > 60 && stage.y < 150, 'artwork stays visible while the page scrolls');
  assert.equal(await features.getByRole('button', { name: '2.5D视觉', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await features.locator('.feature-puzzle-piece').count(), 15);
  assert.equal(await features.getByRole('button', { name: /散开|拼合|GIF|降噪|反推/ }).count(), 0);
  await features.locator('.feature-portrait.is-layered').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.feature-portrait-art img')].every((image) => image.complete && image.naturalWidth === 941 && image.naturalHeight === 1672));
  const sources = await features.locator('.feature-portrait-art img').evaluateAll((images) => images.map((image) => image.getAttribute('src')));
  assert.equal(sources.length, 2); assert.ok(sources.every((source) => source.includes('mermaid-demo-')));
  assert.match(await features.innerText(), /位于角色前方的独立物体/);
  assert.match(await features.innerText(), /主体与背景两层/);
  assert.match(await features.innerText(), /角色附带特效/);
  assert.match(await features.innerText(), /鱼尾/);
  assert.equal(await features.locator('.feature-play-note').count(), 0);
  assert.doesNotMatch(await features.innerText(), /停留 5 秒或开始移动碎片后准备分层/);
  const art = await features.locator('.feature-portrait-art').boundingBox();
  assert.ok(Math.abs(art.width / art.height - 941 / 1672) < 0.001, 'the complete portrait stays at its original ratio');
  const portrait = features.locator('.feature-portrait');
  const bounds = await portrait.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.15, bounds.y + bounds.height * 0.25);
  const backgroundLeft = await settledTransform(features.locator('.feature-portrait-art img').first());
  const subjectLeft = await settledTransform(features.locator('.feature-portrait-art img').nth(1));
  await page.mouse.move(bounds.x + bounds.width * 0.85, bounds.y + bounds.height * 0.75);
  const backgroundRight = await settledTransform(features.locator('.feature-portrait-art img').first());
  const subjectRight = await settledTransform(features.locator('.feature-portrait-art img').nth(1));
  assert.ok((backgroundRight.x - backgroundLeft.x) * (subjectRight.x - subjectLeft.x) < 0, 'layers move in opposite directions');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: resolve(output, 'puzzle-assembled-desktop.png') });
  await features.getByRole('button', { name: '原画 2D', exact: true }).click();
  await features.locator('.feature-portrait.is-flat').waitFor();
  assert.equal(await features.locator('.feature-portrait-art img').count(), 1);
  await features.getByRole('button', { name: '悬浮相片', exact: true }).press('Enter');
  await features.locator('.feature-portrait.is-floating').waitFor();
  await page.mouse.move(bounds.x + bounds.width * 0.15, bounds.y + bounds.height * 0.25);
  const floatingLeft = await settledTransform(features.locator('.feature-portrait-art'));
  await page.mouse.move(bounds.x + bounds.width * 0.85, bounds.y + bounds.height * 0.75);
  const floatingRight = await settledTransform(features.locator('.feature-portrait-art'));
  await features.screenshot({ path: resolve(output, 'mermaid-floating-desktop.png'), style: previewStyle });
  console.log('MOTION', JSON.stringify({ backgroundLeft, backgroundRight, floatingLeft, floatingRight }));
  assert.ok(Math.abs(backgroundRight.x - backgroundLeft.x) >= 8, '2.5D background must visibly follow pointer movement');
  assert.ok(Math.abs(floatingRight.tiltY - floatingLeft.tiltY) > 0.04, 'floating photo must tilt in response to the pointer');
  assert.ok(Math.abs(floatingRight.x - floatingLeft.x) > 4, 'floating photo must move as a complete photo');
  await features.getByRole('button', { name: '2.5D视觉', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.feature-portrait-art img')].every((image) => image.complete && image.naturalWidth === 941));
  assert.equal(await features.locator('.feature-portrait-frame').evaluate((node) => node.style.getPropertyValue('--demo-x')), '', 'mode changes return the preview to neutral');
  assert.deepEqual(apiCalls, [], 'local showcase must not start gallery or model requests');
  assert.ok(await noOverflow(page));
  await features.screenshot({ path: resolve(output, 'mermaid-desktop.png'), style: previewStyle });
  console.log('PASS nine-grid showcase/lightbox, scroll assembly, sticky portrait, three modes and real 2.5D layers');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await memes.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `memes-mobile-${width}.png`) });
    await scrollAssembly(page, .36);
    assert.ok(await noOverflow(page), `scatter overflows at ${width}px`);
    await page.screenshot({ path: resolve(output, `puzzle-assembling-mobile-${width}.png`) });
    await scrollAssembly(page, 1);
    const before = await settledTransform(features.locator('.feature-portrait-art img').first());
    await page.evaluate(() => window.scrollBy({ top: 100, behavior: 'instant' }));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await settledTransform(features.locator('.feature-portrait-art img').first());
    assert.ok(Math.abs(after.x - before.x) > .1, 'mobile scrolling drives parallax');
    const mobileStage = await features.locator('.feature-stage').boundingBox();
    assert.ok(mobileStage.y >= 100 && mobileStage.y <= 130);
    await page.screenshot({ path: resolve(output, `puzzle-assembled-mobile-${width}.png`) });
    for (const name of ['原画 2D', '悬浮相片', '2.5D视觉']) {
      await features.getByRole('button', { name, exact: true }).click();
      assert.ok(await noOverflow(page), `${name} overflows at ${width}px`);
    }
    await features.screenshot({ path: resolve(output, `mermaid-mobile-${width}.png`), style: previewStyle });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await features.locator('.feature-puzzle-pieces').evaluate((node) => getComputedStyle(node).display), 'none');
  assert.equal(await features.locator('.feature-portrait-art').evaluate((node) => getComputedStyle(node).opacity), '1');
  assert.equal(await features.locator('.feature-portrait-art img').nth(1).evaluate((image) => getComputedStyle(image).transform), 'none');
  await features.getByRole('button', { name: '悬浮相片', exact: true }).click();
  assert.equal(await features.locator('.feature-portrait-art').evaluate((image) => getComputedStyle(image).transform), 'none');
  await features.getByRole('link', { name: '打开美图拼图', exact: false }).click();
  await page.waitForFunction(() => location.hash === '#/puzzle');
  assert.ok(!apiCalls.includes('/api/puzzle-layers') && !apiCalls.includes('/api/generate'));
  assert.deepEqual(errors, []); assert.deepEqual(failedAssets, []);
  console.log('PASS mobile 390/320px, reduced motion, actual puzzle entry and all local mermaid assets');
  await context.close();
} finally { await browser.close(); await vite?.close(); }
