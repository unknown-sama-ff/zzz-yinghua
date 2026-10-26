// Against Vite: node tests/browser/studio-smoke.mjs
// PLAYWRIGHT_MODULE can point to an existing bundled Playwright installation.
// BROWSER_EXECUTABLE and STUDIO_SCREENSHOT_DIR are optional.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const sharp = require('sharp');
const base = process.env.STUDIO_BASE_URL || 'http://localhost:5173';
const output = process.env.STUDIO_SCREENSHOT_DIR;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const checks = [];
const errors = [];
function checked(message) { checks.push(message); console.log('PASS ' + message); }

async function screenshot(page, name) {
  if (output) await page.screenshot({ path: join(output, name + '.png'), fullPage: true });
}
function noOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  const image = await sharp({ create: { width: 120, height: 120, channels: 3, background: '#cc2244' } }).png().toBuffer();
  const dataUrl = 'data:image/png;base64,' + image.toString('base64');
  const apiCalls = [];
  const attempts = [];
  let failGallery = false;
  let completeGeneration;
  await context.route('**/api/**', async (request) => {
    const pathname = new URL(request.request().url()).pathname;
    apiCalls.push(pathname);
    if (pathname === '/api/generate') {
      attempts.push(request.request().postDataJSON());
      if (attempts.length === 1) return request.fulfill({ status: 400, json: { ok: false, code: 'UPSTREAM_ERROR', message: '模拟生成失败，可原位重试' } });
      await new Promise((resolve) => { completeGeneration = resolve; });
      return request.fulfill({ json: { ok: true, images: [dataUrl] } });
    }
    if (pathname === '/api/prompts') return request.fulfill({ json: { ok: true, hasMore: false, rows: [{ id: 'qa-prompt', created_at: '2026-10-25T00:00:00Z', title: '城市夜色', prompt: '雨后的城市，角色站在灯光下。', category: '场景', reference_image_urls: [] }] } });
    if (pathname === '/api/gallery') return request.fulfill(failGallery ? { status: 503, json: { ok: false, message: '模拟画廊暂时不可用' } } : { json: { ok: true, rows: [], hasMore: false } });
    if (pathname === '/api/payments/sponsors') return request.fulfill({ json: { ok: true, sponsors: [] } });
    return request.fulfill({ json: { ok: true, presetQualityOptions: ['auto', 'low', 'medium', 'high'] } });
  });

  await page.goto(base);
  await page.locator('#home-title').waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(apiCalls.length, 0, 'home must not fetch gallery, prompts or model APIs');
  assert.equal(await page.getByRole('button', { name: '编辑图片', exact: true }).count(), 0);
  assert.ok(await noOverflow(page));
  await screenshot(page, 'home-desktop');
  checked('home: local images, no API dependencies, no editor button, no overflow');

  await page.getByRole('link', { name: '角色工坊', exact: true }).click();
  const assets = page.locator('.studio-page[aria-label="角色素材"]');
  await assets.getByLabel('角色英文名').fill('STUDIO QA');
  const upload = assets.locator('input[type=file]').first();
  await upload.setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: image });
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--zzz-primary') === '#cc2244');
  for (const [name, color] of [['teal', '#00c4ba'], ['pale', '#ffeecc'], ['gray', '#888888'], ['red', '#cc2244']]) {
    const buffer = await sharp({ create: { width: 120, height: 120, channels: 3, background: color } }).png().toBuffer();
    await upload.setInputFiles({ name: name + '.png', mimeType: 'image/png', buffer });
    const expected = name === 'gray' ? '#b026ff' : color;
    await page.waitForFunction((value) => document.documentElement.style.getPropertyValue('--zzz-primary') === value, expected);
  }
  const threeViewPrompt = assets.locator('textarea').last();
  await threeViewPrompt.fill('保留这个三视图草稿');
  await page.getByRole('link', { name: '海报创作' }).click();
  await page.locator('.studio-page[aria-label="海报创作"] button').first().waitFor();
  await page.getByRole('link', { name: '角色素材', exact: true }).click();
  assert.equal(await assets.getByLabel('角色英文名').inputValue(), 'STUDIO QA');
  assert.equal(await threeViewPrompt.inputValue(), '保留这个三视图草稿');
  await page.getByRole('link', { name: '首页', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--zzz-primary')), '#cc2244');
  await screenshot(page, 'home-red-theme');
  checked('theme: real red/teal/pale/grayscale uploads; drafts and character survive navigation');

  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '工坊设置', exact: true });
  await settings.waitFor();
  await page.keyboard.press('Tab');
  assert.ok(await settings.evaluate((element) => element.contains(document.activeElement)), 'settings traps focus');
  await page.evaluate(async () => {
    const { useProviderStore } = await import('/src/store/useProviderStore.ts');
    useProviderStore.getState().setCred('gpt-image', { apiKey: 'qa-placeholder', baseUrl: 'https://example.invalid/v1' });
  });
  await screenshot(page, 'settings-desktop');
  await page.keyboard.press('Escape');
  await settings.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: '设置', exact: true }).evaluate((element) => document.activeElement === element), true);
  checked('settings: model panel, focus containment, Escape and focus restoration');

  await page.getByRole('button', { name: '自由创作', exact: false }).first().click();
  const free = page.locator('#free-create-window');
  assert.equal(await free.getByText('固定角色换画面', { exact: true }).isVisible(), false, 'batch stays collapsed');
  await free.locator('textarea').fill('保留自由创作草稿');
  await free.getByRole('button', { name: '添加参考图' }).click();
  await free.locator('input[type=file]').first().setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: image });
  await free.getByRole('button', { name: '找灵感？浏览提示词画廊' }).click();
  await page.getByRole('heading', { name: '城市夜色' }).waitFor();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '使用提示词', exact: true }).click();
  assert.equal(await free.isVisible(), false, 'declining replacement keeps prompts open');
  await page.getByRole('button', { name: '自由创作', exact: false }).first().click();
  assert.equal(await free.locator('textarea').inputValue(), '保留自由创作草稿');
  assert.ok(await free.getByRole('img', { name: 'reference.png', exact: true }).isVisible());
  await free.getByRole('button', { name: '收起自由创作' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '使用提示词', exact: true }).click();
  assert.equal(await free.locator('textarea').inputValue(), '雨后的城市，角色站在灯光下。');
  await free.getByRole('button', { name: '发送创作请求' }).click();
  await free.getByText('模拟生成失败，可原位重试', { exact: true }).waitFor();
  const retried = page.waitForRequest('**/api/generate');
  await free.getByRole('button', { name: '重试', exact: true }).click();
  await retried;
  await page.waitForFunction(() => document.querySelector('#free-create-window')?.textContent?.includes('正在生成'));
  await free.getByRole('button', { name: '收起自由创作' }).click();
  await page.getByRole('link', { name: '首页', exact: true }).click();
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].prompt, attempts[1].prompt);
  assert.deepEqual(attempts[0].refImages, attempts[1].refImages);
  assert.equal(attempts[0].imageBase64, attempts[1].imageBase64);
  assert.notEqual(attempts[0].idempotencyKey, attempts[1].idempotencyKey);
  completeGeneration();
  await page.getByRole('button', { name: '自由创作', exact: false }).first().click();
  await free.getByText('已完成', { exact: true }).waitFor();
  await free.getByRole('button', { name: '收起自由创作' }).click();
  checked('free creation: prompt handoff, draft/reference retention, confirmed failure retry, background completion across routes');

  await page.getByRole('link', { name: '角色工坊', exact: true }).click();
  await page.getByRole('link', { name: '影画创作', exact: true }).click();
  await page.getByRole('heading', { name: '影画查看器' }).waitFor();
  await page.evaluate(async (source) => {
    const { useYinghuaStore } = await import('/src/store/useYinghuaStore.ts');
    useYinghuaStore.getState().setYinghuaSlot(1, { status: 'done', images: [source] });
  }, dataUrl);
  await page.getByRole('button', { name: '全屏', exact: true }).click();
  await page.getByRole('button', { name: '退出全屏', exact: true }).waitFor();
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await page.getByRole('button', { name: '编辑图片', exact: true }).click();
  await page.locator('[data-inpaint-portal]').first().waitFor();
  const selectedZones = await page.locator('[data-inpaint-portal]').evaluateAll((items) => items.map((item) => item.getAttribute('data-inpaint-portal')));
  assert.ok(selectedZones.every((zone) => zone.startsWith('yinghua-')), 'hidden assets are not selectable');
  await page.locator('[data-inpaint-portal]').first().click();
  await page.getByRole('heading', { name: '连续编辑', exact: false }).waitFor();
  await page.getByRole('button', { name: '关闭', exact: false }).last().click();
  await page.getByRole('link', { name: '首页', exact: true }).click();
  assert.equal(await page.locator('[data-inpaint-portal]').count(), 0);
  checked('viewer: fullscreen and return; image editor selects only visible workspace images');

  await page.getByRole('button', { name: '支持工坊', exact: false }).click();
  const support = page.getByRole('dialog', { name: '支持工坊', exact: true });
  await support.getByRole('button', { name: '扫码赞助', exact: false }).click();
  assert.ok(await support.locator('#personal-alipay-qr').isVisible());
  await support.getByRole('button', { name: '赞助名单', exact: true }).click();
  await page.getByRole('dialog', { name: '赞助名单', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.ok(await support.isVisible(), 'Escape closes the nested list first');
  await page.keyboard.press('Escape');
  await support.waitFor({ state: 'hidden' });
  checked('support: inline QR and nested sponsor list without clipping');

  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('link', { name: '首页', exact: true }).click();
    await page.waitForFunction(() => window.scrollY === 0);
    assert.ok(await noOverflow(page), 'home overflow at ' + width);
    await screenshot(page, 'home-' + width);
    await page.getByRole('link', { name: '角色工坊', exact: true }).click();
    assert.ok(await noOverflow(page), 'assets overflow at ' + width);
    await screenshot(page, 'assets-' + width);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    assert.ok(await noOverflow(page), 'settings overflow at ' + width);
    await page.keyboard.press('Escape');
  }
  await page.getByRole('link', { name: '角色素材', exact: true }).click();
  await assets.getByRole('button', { name: '清除', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--zzz-primary') === '#b026ff');
  checked('responsive: home/assets/settings at 320/390/768/1024; clear resets theme');

  await page.goto(base + '/#prompt-gallery');
  await page.getByRole('heading', { name: '提示词画廊' }).waitFor();
  assert.ok(page.url().endsWith('#/prompts'));
  await page.getByRole('link', { name: '画廊', exact: true }).click();
  await page.getByText('还没有保存的作品', { exact: false }).waitFor();
  await page.reload();
  await page.getByText('还没有保存的作品', { exact: false }).waitFor();
  await page.goBack();
  await page.getByRole('heading', { name: '提示词画廊' }).waitFor();
  checked('routing: legacy prompt anchor, gallery deep-link reload and browser back');
  failGallery = true;
  await page.getByRole('link', { name: '画廊', exact: true }).click();
  await page.getByRole('button', { name: '刷新画廊', exact: true }).click();
  await page.getByText('模拟画廊暂时不可用', { exact: false }).waitFor();
  await page.getByRole('link', { name: '首页', exact: true }).click();
  await page.locator('#home-title').waitFor();
  await page.getByRole('button', { name: '支持工坊', exact: false }).scrollIntoViewIfNeeded();
  await page.getByRole('link', { name: '首页', exact: true }).click();
  await page.waitForFunction(() => window.scrollY === 0);
  checked('resilience: gallery failure leaves home usable; repeated home link returns to top');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const effectsToggle = settings.getByRole('checkbox', { name: '鼠标与落樱特效', exact: false });
  await effectsToggle.uncheck();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.ambient-petals').count(), 0);
  await page.reload();
  assert.equal(await page.locator('.ambient-petals').count(), 0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await effectsToggle.isChecked(), false);
  await settings.getByRole('checkbox', { name: '使用作者免费通道', exact: false }).check();
  await settings.locator('#gpt-image-quality option[value="high"]').waitFor({ state: 'attached' });
  await settings.locator('#gpt-image-quality').selectOption('high');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await effectsToggle.isDisabled(), true);
  await page.keyboard.press('Escape');
  checked('preferences: effects survive reload, reduced motion is respected, preset model quality remains available');
  assert.deepEqual(errors, [], 'no runtime errors');
  console.log(JSON.stringify({ checks, runtimeErrors: errors, mockedGenerations: attempts.length }, null, 2));
  await context.close();
} finally {
  await browser.close();
}
