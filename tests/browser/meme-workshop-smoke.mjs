// Real browser/canvas/download regression; generation and gallery calls are mocked.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve('node_modules/.cache/meme-workshop-qa');
await mkdir(output, { recursive: true });
const png = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
const sheet = async (columns, opaque = false) => {
  const cells = Array.from({ length: columns * 3 }, (_, i) => {
    const x = (i % columns) * 201 + 100, y = Math.floor(i / columns) * 201 + 95;
    return `<g><circle cx="${x}" cy="${y}" r="65" fill="hsl(${i * 29},75%,75%)" stroke="white" stroke-width="12"/><path d="M${x - 25} ${y - 10}h8m35 0h8M${x - 16} ${y + 18}q16 20 32 0" fill="none" stroke="#2e2542" stroke-width="6"/><text x="${x}" y="${y + 85}" text-anchor="middle" font-size="25" fill="#2e2542" stroke="white" stroke-width="1">${i + 1}</text></g>`;
  }).join('');
  const image = sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${columns * 201}" height="603">${cells}</svg>`));
  return opaque ? image.flatten({ background: '#fff' }).png().toBuffer() : image.png().toBuffer();
};
const reference = await sharp({ create: { width: 84, height: 84, channels: 4, background: '#ac71ff' } }).png().toBuffer();
const style = await sharp({ create: { width: 84, height: 84, channels: 4, background: '#ffbc70' } }).png().toBuffer();
const expression = await sharp({ create: { width: 84, height: 84, channels: 4, background: '#71d2c5' } }).png().toBuffer();
const single = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><circle cx="75" cy="75" r="45" fill="#ff69aa" stroke="white" stroke-width="10"/></svg>')).png().toBuffer();
const nine = await sheet(3), fifteen = await sheet(5), opaque = await sheet(3, true);
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const vite = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await vite.listen();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
const page = await context.newPage();
const errors = [], calls = [], saves = [];
let mode = 'hold', release, fixtureLoads = 0;
page.on('pageerror', (error) => errors.push(error.message));
await context.route('**/api/**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/generate') {
    const body = route.request().postDataJSON(); calls.push(body);
    const selected = mode;
    if (selected === 'hold') await new Promise((resolve) => { release = resolve; });
    if (selected === 'network') return route.abort('failed');
    if (selected === 'error') return route.fulfill({ status: 429, json: { ok: false, code: 'RATE_LIMITED', message: '测试：额度不足' } });
    if (selected === 'unsupported') return route.fulfill({ status: 400, json: { ok: false, code: 'INVALID_INPUT', message: '测试：接口不支持透明背景' } });
    if (selected === 'processing') return route.fulfill({ json: { ok: true, images: ['/meme-recovery-fixture.png'] } });
    const isSingle = body.prompt.includes('只生成一张独立表情');
    const image = selected === 'opaque' ? opaque : isSingle ? single : body.prompt.includes('共15格') ? fifteen : nine;
    return route.fulfill({ json: { ok: true, images: [png(image)] } });
  }
  if (path === '/api/gallery' && route.request().method() === 'POST') {
    saves.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, row: { id: 1, image_url: 'https://example.invalid/saved.webp' } } });
  }
  return route.fulfill({ json: { ok: true, rows: [], hasMore: false, sponsors: [], presetQualityOptions: ['auto', 'low', 'medium', 'high'], presetMaxInputImages: 16, presetTransparencySupported: true } });
});
await context.route('**/meme-recovery-fixture.png', (route) => ++fixtureLoads === 1 ? route.fulfill({ status: 503, body: 'temporary fixture error' }) : route.fulfill({ contentType: 'image/png', body: nine }));
const upload = async (label, name, buffer) => {
  await page.getByLabel(`上传${label}`, { exact: true }).setInputFiles({ name, mimeType: 'image/png', buffer });
  await page.getByRole('button', { name: `移除${label}：${name}`, exact: true }).waitFor();
};
const resultTiles = () => page.locator('.meme-result-tile');
const sources = () => page.locator('.meme-tile-image img').evaluateAll((images) => images.map((image) => image.src));
const idle = () => page.getByRole('button', { name: '重新生成整套', exact: true }).waitFor({ state: 'visible' }).then(() => page.waitForFunction(() => !document.querySelector('.meme-generate-bar button').disabled));
const decode = (url) => sharp(Buffer.from(url.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
try {
  const base = vite.resolvedUrls.local[0];
  await page.goto(base + '#/memes');
  await page.getByRole('heading', { name: /同一个角色/ }).waitFor();
  assert.equal(await page.locator('.meme-tile-draft').count(), 9);
  await upload('角色图', 'character.png', reference);
  // Draft references can be prepared before the user configures an interface.
  await upload('风格参考', 'style.png', style);
  await upload('共用表情参考', 'expression.png', expression);
  await upload('第5格表情参考', 'cell5.png', reference);
  await page.getByRole('button', { name: '一键生成表情包', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'GPT 图片通道' }).waitFor(); assert.equal(calls.length, 0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('dialog', { name: '工坊设置' }).getByRole('checkbox', { name: /使用作者免费通道/ }).check();
  await page.getByRole('button', { name: '关闭工坊设置' }).click();
  await page.getByText(/当前通道上限16张/).waitFor();
  await page.getByRole('button', { name: '一键生成表情包', exact: true }).click({ clickCount: 2 });
  await page.waitForFunction(() => Boolean(document.querySelector('.meme-status')));
  await page.locator('.studio-navigation').getByRole('link', { name: '画廊', exact: true }).click();
  await page.locator('.studio-navigation').getByRole('link', { name: '表情包工坊', exact: true }).click();
  release(); await idle();
  assert.equal(calls.length, 1); assert.equal(calls[0].background, 'transparent'); assert.equal(calls[0].output_format, 'png'); assert.equal(calls[0].n, 1);
  assert.equal(calls[0].imageBase64, reference.toString('base64'));
  assert.deepEqual(calls[0].refImages.map((image) => image.base64), [style, expression, reference].map((bytes) => bytes.toString('base64')));
  assert.match(calls[0].prompt, /图片4：仅用于第5格/); assert.equal(await resultTiles().count(), 9);
  assert.equal(await page.locator('.meme-tile-image img').first().evaluate((image) => image.naturalWidth), 201);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'desktop overflow');
  await page.screenshot({ path: resolve(output, 'desktop-setup.png') });
  console.log('PASS roles, one request, immutable ordering, duplicate click guard and navigation during generation');

  const before = await sources();
  await page.getByLabel('第1格文案', { exact: true }).fill('改好了'); mode = 'success';
  await resultTiles().first().getByRole('button', { name: '重做这张', exact: true }).click(); await idle();
  const after = await sources(); assert.notEqual(after[0], before[0]); assert.deepEqual(after.slice(1), before.slice(1));
  assert.match(calls[1].prompt, /改好了/); assert.ok(calls[1].refImages.some((image) => image.base64 === before[0].split(',')[1]));
  assert.ok(!calls[1].prompt.includes('仅用于第5格')); assert.equal(calls[1].refImages.length, 3);
  await page.getByText('调整拆图切线', { exact: false }).first().click();
  await page.getByLabel('竖向切线1', { exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: '应用切线', exact: true }).click(); await idle();
  assert.equal((await sources())[0], after[0], 'recutting keeps regenerated tile');
  const callCount = calls.length;
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载全部 PNG（ZIP）', exact: true }).click();
  const download = await downloadEvent; const files = unzipSync(await readFile(await download.path()));
  assert.equal(Object.keys(files).length, 9); assert.ok(Object.keys(files).some((name) => name.includes('改好了')));
  const first = await sharp(files[Object.keys(files)[0]]).metadata(); assert.equal(first.hasAlpha, true); assert.equal(first.width, 150);
  const fullEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '下载整图', exact: true }).click();
  const full = await fullEvent; const fullMeta = await sharp(await readFile(await full.path())).metadata(); assert.equal(fullMeta.width, 603); assert.equal(fullMeta.hasAlpha, true);
  await page.locator('.meme-result-heading').getByRole('button', { name: '保存到画廊', exact: true }).click();
  await page.locator('.meme-result-heading').getByText('已保存', { exact: true }).waitFor();
  assert.equal((await sharp(Buffer.from(saves[0].imageBase64, 'base64')).metadata()).hasAlpha, true);
  assert.equal(calls.length, callCount, 'cuts, downloads and gallery save never regenerate');
  await page.locator('.meme-result-heading').evaluate((node) => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 120));
  await page.screenshot({ path: resolve(output, 'desktop-transparent-results.png') });
  console.log('PASS per-tile redo, unchanged siblings, cuts, real PNG/ZIP downloads and gallery alpha');

  await page.getByRole('button', { name: '15 格', exact: true }).click();
  assert.equal(await page.locator('.meme-tile-draft').count(), 15);
  await page.getByRole('button', { name: '重新生成整套', exact: true }).click(); await idle();
  assert.equal(await resultTiles().count(), 15); assert.equal(calls.at(-1).size, '1536x1024');
  const fifteenBefore = await sources(); mode = 'opaque';
  await resultTiles().first().getByRole('button', { name: '重做这张', exact: true }).click(); await idle();
  await page.getByRole('alert').filter({ hasText: '已保留原来的单张' }).waitFor(); assert.deepEqual(await sources(), fifteenBefore);
  mode = 'error'; await page.getByRole('button', { name: '重新生成整套', exact: true }).click(); await idle();
  await page.getByRole('alert').filter({ hasText: '额度不足' }).waitFor(); assert.deepEqual(await sources(), fifteenBefore);
  mode = 'unsupported'; await page.getByRole('button', { name: '重新生成整套', exact: true }).click(); await idle();
  await page.getByRole('alert').filter({ hasText: '接口不支持透明背景' }).waitFor(); assert.deepEqual(await sources(), fifteenBefore);
  console.log('PASS 15-grid, opaque redo preservation, quota errors and transparency errors');

  mode = 'network'; await page.getByRole('button', { name: '重新生成整套', exact: true }).click();
  await page.getByRole('button', { name: '重试原请求', exact: true }).waitFor();
  const uncertainKey = calls.at(-1).idempotencyKey; assert.equal(await page.getByRole('button', { name: '重新生成整套', exact: true }).isDisabled(), true);
  mode = 'success'; await page.getByRole('button', { name: '重试原请求', exact: true }).click(); await idle();
  assert.equal(calls.at(-1).idempotencyKey, uncertainKey);
  mode = 'processing'; await page.getByRole('button', { name: '九宫格', exact: true }).click();
  await page.getByRole('button', { name: '重新生成整套', exact: true }).click();
  await page.getByRole('button', { name: '重试图片处理（不生图）', exact: true }).waitFor(); const processingCalls = calls.length;
  await page.getByRole('button', { name: '重试图片处理（不生图）', exact: true }).click(); await idle();
  assert.equal(calls.length, processingCalls); assert.equal(await resultTiles().count(), 9); assert.equal(fixtureLoads, 2);
  mode = 'opaque'; await page.getByRole('button', { name: '重新生成整套', exact: true }).click(); await idle();
  await page.getByRole('alert').filter({ hasText: '上游返回了不透明图片' }).waitFor();
  const opaquePixels = await decode((await sources())[0]); assert.equal(opaquePixels.data.filter((_, i) => i % 4 === 3).every((alpha) => alpha === 255), true);
  console.log('PASS uncertain request identifier reuse, local processing retry without generation, opaque result disclosure');

  await page.setViewportSize({ width: 1366, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'laptop overflow');
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => scrollTo(0, 0));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile overflow');
  await page.screenshot({ path: resolve(output, 'mobile-setup.png') });
  await page.locator('.meme-results').scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(output, 'mobile-results.png') });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.locator('.meme-results').scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(output, 'desktop-results.png') });
  assert.deepEqual(errors, []); console.log('PASS desktop/mobile layout and zero page errors');
  console.log(`Screenshots: ${output}`);
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally { await context.close(); await browser.close(); await vite.close(); }
