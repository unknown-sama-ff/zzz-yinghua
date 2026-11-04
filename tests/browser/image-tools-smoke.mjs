// Offline browser regression: real workers/PNG exports, mocked vision responses.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { createServer } from 'vite';

const output = resolve(process.env.IMAGE_TOOLS_SCREENSHOTS || 'node_modules/.cache/image-tools-qa');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const vite = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await vite.listen();
const base = vite.resolvedUrls.local[0];
const errors = [], checks = [];
const mark = (text) => { checks.push(text); console.log('PASS ' + text); };
const reference = await readFile('public/作者推荐/自由版.webp');
const copy = {
  summary: '人物占据右侧，紫色剪影和黑白印刷纹理形成鲜明对比。',
  promptZh: '横向画幅，人物位于画面右侧，保持原有动作与裁切。黑白印刷纹理与紫色块面相互叠加，背景保留大面积留白及明确的几何分区，侧向光突出轮廓，保持原图的插画媒介与色彩关系。',
  promptEn: 'A horizontal illustration with the subject on the right. Preserve the pose, crop and geometric background; black-and-white print textures contrast with violet shapes and directional side lighting.',
  negativePrompt: '', editablePrompt: '人物位于画面右侧，保留原有动作和几何留白，以【紫色】块面搭配【黑白印刷纹理】，保持插画媒介与侧光。', tips: '建议横向 3:2。以可见构图和色彩关系为准；无法从图片确认原始模型、种子或镜头。',
};
let mode = 'success', release, calls = 0;
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'], reducedMotion: 'reduce', acceptDownloads: true });
await context.route('**/api/**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/image-to-prompt') {
    calls++;
    const selected = mode;
    if (selected === 'hold') await new Promise((done) => { release = done; });
    if (selected === 'error') return route.fulfill({ status: 401, json: { ok: false, message: '测试：视觉模型尚未配置' } });
    return route.fulfill({ json: { ok: true, result: { ...copy, ...(selected === 'hold' ? { promptZh: '旧图的过时结果' } : {}) }, image: { width: 1536, height: 1024, aspectRatio: '3:2' } } }).catch(() => {});
  }
  if (path === '/api/generate' || path === '/api/inpaint') throw new Error('Image tools must not call image-generation APIs');
  return route.fulfill({ json: { ok: true, rows: [], hasMore: false, presetQualityOptions: ['auto'], sponsors: [] } });
});
const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
try {
  await page.goto(base + '#/image-to-prompt');
  const links = await page.locator('.studio-navigation a').allTextContents();
  assert.equal(links[links.indexOf('美图拼图') + 1], '看图反推');
  await page.locator('.image-prompt-source input[type=file]').setInputFiles({ name: 'reference.webp', mimeType: 'image/webp', buffer: reference });
  await page.getByRole('button', { name: '反推提示词', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '请先打开右上角' }).waitFor(); assert.equal(calls, 0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '工坊设置' });
  await settings.getByRole('checkbox', { name: /使用作者免费通道/ }).check();
  await page.getByRole('button', { name: '关闭工坊设置' }).click();
  await page.getByRole('button', { name: '反推提示词', exact: true }).click();
  await page.locator('.image-prompt-result-text').waitFor(); assert.equal(await page.locator('.image-prompt-result-text').inputValue(), copy.promptZh);
  await page.getByRole('button', { name: '复制当前提示词' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), copy.promptZh);
  await page.getByRole('button', { name: 'English Prompt', exact: true }).click();
  assert.equal(await page.locator('.image-prompt-result-text').inputValue(), copy.promptEn);
  await page.getByRole('button', { name: '可编辑版本', exact: true }).click();
  assert.match(await page.locator('.image-prompt-result-text').inputValue(), /【紫色】/);
  await page.getByRole('button', { name: '复制全部版本' }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText()); assert.ok(copied.includes(copy.promptEn)); assert.ok(copied.includes(copy.editablePrompt));
  await page.screenshot({ path: resolve(output, 'reverse-desktop.png'), fullPage: true });
  mark('navigation order, settings guard, upload, Chinese/English/editable prompts and clipboard');

  mode = 'hold';
  await page.getByRole('button', { name: '重新反推提示词' }).click();
  await page.getByRole('button', { name: '停止等待' }).waitFor();
  await page.locator('.image-prompt-source input[type=file]').setInputFiles({ name: 'new-reference.webp', mimeType: 'image/webp', buffer: reference });
  mode = 'success';
  await page.getByRole('button', { name: '反推提示词', exact: true }).click();
  await page.locator('.image-prompt-result-text').waitFor(); release?.();
  assert.equal(await page.locator('.image-prompt-result-text').inputValue(), copy.promptZh);
  mode = 'error'; await page.getByRole('button', { name: '重新反推提示词' }).click();
  await page.getByRole('alert').filter({ hasText: '测试：视觉模型尚未配置' }).waitFor();
  mode = 'success'; await page.getByRole('button', { name: '反推提示词', exact: true }).click();
  await page.locator('.image-prompt-result-text').waitFor();
  mark('changing upload ignores stale vision response; service errors remain visible and retry succeeds');

  let seed = 7; const width = 256, height = 128;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, value = x < width / 2 ? 65 : 190;
    for (let c = 0; c < 3; c++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels[i + c] = value + Math.round((seed / 2 ** 32 - .5) * 35); }
    pixels[i + 3] = x < 8 ? 0 : x < 16 ? 128 : 255;
  }
  const noisy = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  await page.locator('.studio-navigation').getByRole('link', { name: '图片降噪', exact: true }).click();
  await page.locator('.local-denoise-file').setInputFiles({ name: 'noisy.png', mimeType: 'image/png', buffer: noisy });
  await page.getByRole('status').filter({ hasText: '已就绪' }).waitFor();
  await page.getByRole('button', { name: '开始本地降噪' }).click();
  const downloadLink = page.getByRole('link', { name: '下载 PNG' }); await downloadLink.waitFor();
  const downloadPromise = page.waitForEvent('download'); await downloadLink.click(); const download = await downloadPromise;
  const exported = await sharp(await download.path()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(exported.info.width, width); assert.equal(exported.info.height, height);
  let before = 0, after = 0, count = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4; assert.equal(exported.data[i + 3], pixels[i + 3]);
    if (x < 16) continue;
    const clean = x < width / 2 ? 65 : 190;
    for (let c = 0; c < 3; c++) { before += (pixels[i + c] - clean) ** 2; after += (exported.data[i + c] - clean) ** 2; count++; }
  }
  assert.ok(after < before * .4);
  await page.getByRole('checkbox', { name: '100% 像素查看' }).check();
  await page.getByRole('radio', { name: /较强/ }).check(); await page.getByRole('button', { name: '重新处理原图' }).click();
  await downloadLink.waitFor();
  await page.screenshot({ path: resolve(output, 'denoise-desktop.png'), fullPage: true });
  mark(`real local worker and PNG download preserve dimensions/alpha; synthetic RGB MSE ${(before / count).toFixed(2)} → ${(after / count).toFixed(2)}`);

  const large = await sharp({ create: { width: 1800, height: 1800, channels: 3, background: '#9b83ad' } }).png().toBuffer();
  await page.locator('.local-denoise-file').setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: large });
  await page.getByRole('status').filter({ hasText: '已就绪' }).waitFor();
  await page.getByRole('button', { name: '开始本地降噪' }).click(); await page.getByRole('button', { name: '取消处理' }).click();
  await page.getByRole('status').filter({ hasText: '已取消' }).waitFor();
  await page.getByRole('button', { name: '开始本地降噪' }).click(); await downloadLink.waitFor();
  const oversized = await sharp({ create: { width: 2001, height: 2000, channels: 3, background: '#998899' } }).png().toBuffer();
  await page.locator('.local-denoise-file').setInputFiles({ name: 'over-limit.png', mimeType: 'image/png', buffer: oversized });
  await page.getByRole('alert').filter({ hasText: '400 万像素' }).waitFor();
  mark('denoise cancellation/restart and oversized image rejection');

  for (const route of ['#/image-to-prompt', '#/denoise']) {
    await page.goto(base + route); await page.setViewportSize({ width: 360, height: 800 });
    await page.locator(route.includes('prompt') ? '.image-prompt-page' : '.local-denoise').waitFor();
    assert.equal(await overflow(), false);
    await page.screenshot({ path: resolve(output, route.includes('prompt') ? 'reverse-mobile.png' : 'denoise-mobile.png'), fullPage: true });
  }
  assert.deepEqual(errors, []); mark('mobile 360px layout and no uncaught browser errors');
  console.log(JSON.stringify({ checks, visionCalls: calls, screenshots: output }));
} finally {
  release?.();
  // Let the application release its workers before closing Chromium targets.
  if (!page.isClosed()) { await page.goto(base + '#/'); await page.locator('.exhibition-home').waitFor(); }
  await browser.close(); await vite.close();
}
