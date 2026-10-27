// Uses production UI and API client with intercepted model requests. No credits used.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const sharp = require('sharp');
const base = process.env.STUDIO_BASE_URL || 'http://127.0.0.1:5173';
const output = process.env.LEG_REPAIR_SCREENSHOT_DIR || 'tests/browser/artifacts/leg-repair';
await mkdir(output, { recursive: true });
const images = {};
for (const [name, color] of [['original', '#41526c'], ['repaired', '#557e68'], ['repaired2', '#7773a1'], ['yang', '#a77d51'], ['yin', '#9e536d']]) {
  const svg = `<svg width="900" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="900" height="600" fill="${color}"/><text x="50" y="90" font-size="35" font-family="sans-serif" fill="white">${name.toUpperCase()} / LOCAL TEST FIXTURE</text></svg>`;
  images[name] = 'data:image/png;base64,' + (await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64');
}
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const errors = [], checks = [];
function checked(text) { checks.push(text); console.log('PASS ' + text); }
async function screenshot(page, name) {
  const editing = await page.getByRole('dialog', { name: '连续图片编辑' }).count();
  await page.screenshot({ path: join(output, name + '.png'), fullPage: editing === 0 });
}
async function state(page) {
  return page.evaluate(() => window.__legRepairTest.read());
}
async function waitForImage(page, image) {
  await page.waitForFunction((expected) => {
    const editor = window.__legRepairTest.read();
    return editor.current === expected && !editor.generating;
  }, image);
}
async function setup(width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 900 : 1100 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const requests = [];
  const control = { next: 'success', release: null, held: null, result: images.repaired };
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (entry) => { if (entry.type() === 'error') errors.push(entry.text()); });
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/inpaint') {
      const bytes = request.postDataBuffer();
      const body = bytes.toString('utf8');
      requests.push({ priority: body.includes('完整程度相近时，优先保留处于画面上方'), connected: body.includes('每个膝盖只接一条小腿'),
        usesPreviousRepair: bytes.includes(Buffer.from(images.repaired.split(',')[1], 'base64')) });
      const behavior = control.next;
      control.next = 'success';
      if (behavior === 'hold') await new Promise((resolve) => { control.release = resolve; control.held?.(); });
      if (behavior === 'safety') return route.fulfill({ json: { ok: false, code: 'CONTENT_REJECTED', message: '上游返回内容审核拒绝', upstreamError: {
        source: 'upstream', message: 'Local safety-rejection test fixture', httpStatus: 400, category: 'sexual', requestId: 'req-leg-repair-fixture', redacted: false, truncated: false,
      } } });
      return route.fulfill({ json: { ok: true, images: [control.result] } });
    }
    if (path === '/api/generate') { errors.push('one-click repair must not call /generate'); return route.fulfill({ json: { ok: false, code: 'UNKNOWN', message: 'unexpected generation' } }); }
    return route.fulfill({ json: { ok: true, rows: [], hasMore: false, sponsors: [], presetQualityOptions: ['auto', 'high'] } });
  });
  await page.goto(base + '/tests/browser/leg-repair.html#/workshop/yinghua');
  await page.getByRole('button', { name: '两阶段生成', exact: true }).waitFor();
  await page.evaluate((source) => window.__legRepairTest.configure(source), images.original);
  return { context, page, requests, control, stage: page.locator('#yinghua-current-stage') };
}
try {
  const { context, page, stage, requests, control } = await setup();
  await screenshot(page, '01-repair-entry');
  control.next = 'hold';
  const held = new Promise((resolve) => { control.held = resolve; });
  await stage.getByRole('button', { name: '一键修腿', exact: true }).evaluate((button) => { button.click(); button.click(); });
  await held;
  const editor = page.getByRole('dialog', { name: '连续图片编辑' });
  await editor.waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].priority, true);
  assert.equal(requests[0].connected, true);
  assert.equal((await state(page)).versions, 1);
  assert.equal((await state(page)).draft, images.original);
  assert.equal(await editor.getByRole('button', { name: '替换动作底稿', exact: true }).isDisabled(), true);
  await screenshot(page, '02-repair-running');
  control.release();
  await waitForImage(page, images.repaired);
  assert.equal((await state(page)).versions, 2);
  assert.equal((await state(page)).draft, images.original);
  await editor.getByText('原图', { exact: true }).click();
  assert.equal((await state(page)).current, images.original);
  await editor.getByText('v1', { exact: true }).click();
  assert.equal((await state(page)).current, images.repaired);
  await screenshot(page, '03-repair-comparison');
  checked('one click starts one edit, keeps the original and provides version comparison');

  const root = (await state(page)).root;
  control.result = images.repaired2;
  await editor.getByRole('button', { name: '一键修腿', exact: true }).click();
  await waitForImage(page, images.repaired2);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].usesPreviousRepair, true);
  assert.equal((await state(page)).root, root);
  assert.equal((await state(page)).versions, 3);
  await editor.getByRole('button', { name: '替换动作底稿', exact: true }).click();
  assert.equal((await state(page)).draft, images.repaired2);
  assert.equal(requests.length, 2, 'replacement must not request another image');
  await editor.getByRole('button', { name: '✕ 关闭', exact: true }).first().click();
  checked('repeat repair uses the selected version; explicit apply updates only its draft');

  await page.evaluate((sources) => window.__legRepairTest.loadSix(sources), images);
  await page.getByRole('navigation', { name: '影画制作步骤' }).getByRole('button', { name: /六命全彩/ }).click();
  await stage.getByRole('button', { name: '切换到六命阴', exact: true }).click();
  control.result = images.repaired;
  await stage.getByRole('button', { name: '一键修腿', exact: true }).click();
  await waitForImage(page, images.repaired);
  assert.equal((await state(page)).target.index, 1);
  await editor.getByRole('button', { name: '替换影画原图', exact: true }).click();
  assert.equal((await state(page)).slots[3].images[0], images.yang);
  assert.equal((await state(page)).slots[3].images[1], images.repaired);
  await editor.getByRole('button', { name: '✕ 关闭', exact: true }).first().click();
  checked('six-fate Yin repair preserves Yang and writes back to the exact displayed face');

  control.next = 'safety';
  const beforeRejection = requests.length;
  await stage.getByRole('button', { name: '一键修腿', exact: true }).click();
  await editor.getByRole('alert').getByText('内容审核未通过', { exact: true }).waitFor();
  assert.equal(requests.length, beforeRejection + 1);
  assert.equal((await state(page)).versions, 1);
  assert.equal((await state(page)).error.upstreamError.requestId, 'req-leg-repair-fixture');
  assert.equal((await state(page)).slots[3].images[1], images.repaired);
  assert.equal(await editor.getByRole('button', { name: '一键修腿', exact: true }).isEnabled(), true);
  await screenshot(page, '04-repair-rejected');
  control.result = images.repaired2;
  await editor.getByRole('button', { name: '一键修腿', exact: true }).click();
  await waitForImage(page, images.repaired2);
  assert.equal(requests.length, beforeRejection + 2);
  assert.equal((await state(page)).versions, 2);
  checked('rejection preserves inputs and source, shows provider evidence, and retries only on another click');
  await context.close();

  const mobile = await setup(390);
  await mobile.stage.getByRole('button', { name: '一键修腿', exact: true }).click();
  await waitForImage(mobile.page, images.repaired);
  const mobileEditor = mobile.page.getByRole('dialog', { name: '连续图片编辑' });
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await mobileEditor.getByRole('button', { name: '替换动作底稿', exact: true }).isEnabled(), true);
  await screenshot(mobile.page, '05-mobile-repair');
  await mobileEditor.getByRole('button', { name: '替换动作底稿', exact: true }).click();
  assert.equal((await state(mobile.page)).draft, images.repaired);
  await mobile.context.close();
  checked('390px repair preview and explicit replacement remain usable without horizontal overflow');
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'results.json'), JSON.stringify({ checks, errors, allModelCallsIntercepted: true }, null, 2));
  console.log(`PASS ${checks.length} checks; 0 errors; all model calls intercepted`);
} finally { await browser.close(); }
