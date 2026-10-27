// Run against Vite. Image generation/editing is intercepted; no credits used.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const sharp = require('sharp');
const base = process.env.STUDIO_BASE_URL || 'http://127.0.0.1:5173';
const output = process.env.STUDIO_SCREENSHOT_DIR || 'tests/browser/artifacts/zero-fate-two-stage';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const fixtures = {};
for (const [name, color] of [['character', '#285a8f'], ['draft', '#58b9b1'], ['edited', '#92bd53'], ['zero', '#40395c'], ['three', '#888888'], ['six', '#cc9944']]) {
  fixtures[name] = 'data:image/png;base64,' + (await sharp({ create: { width: 1536, height: 1024, channels: 3, background: color } }).png().toBuffer()).toString('base64');
}
const errors = [];
const checks = [];
const upstreamOriginalMessage = 'Your request was rejected by the safety system. If you believe this is an error, contact us at help.openai.com and include request ID req-provider-qa-123. safety_violations=[sexual].';
function checked(message) { checks.push(message); console.log('PASS ' + message); }
async function screenshot(page, name) {
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.screenshot({ path: join(output, name + '.png'), fullPage: true });
}
async function centerColor(request) {
  return [...await sharp(Buffer.from(request.imageBase64, 'base64')).extract({ left: 768, top: 512, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
}
function closeColor(actual, expected) { assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) <= 4), `unexpected primary image center: ${actual}`); }

async function setup(viewport = { width: 1440, height: 1100 }, model = 'gpt-image-2.5-sunburst') {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const requests = [];
  const edits = [];
  const control = { next: 'success', release: null };
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (event) => { if (event.type() === 'error') errors.push(event.text()); });
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/generate') {
      const body = request.postDataJSON();
      requests.push(body);
      const behavior = control.next;
      control.next = 'success';
      if (behavior === 'hold') await new Promise((resolve) => { control.release = resolve; control.onHeld?.(); });
      if (behavior === 'fail') return route.fulfill({ json: { ok: false, code: 'UPSTREAM_ERROR', message: '本地模拟生成失败' } });
      if (behavior === 'safety') return route.fulfill({ json: { ok: false, code: 'CONTENT_REJECTED', message: 'Your request was rejected by the safety system. safety_violations=[sexual].' } });
      if (behavior === 'safety-detail') return route.fulfill({ json: {
        ok: false, code: 'CONTENT_REJECTED', message: '上游返回内容审核拒绝（sexual）。',
        upstreamError: { source: 'upstream', message: upstreamOriginalMessage, httpStatus: 400, code: 'moderation_blocked', type: 'image_generation_error', category: 'sexual', requestId: 'req-provider-qa-123', redacted: false, truncated: false },
      } });
      const isDraft = /动作底稿·第一阶段|ACTION DRAFT — STAGE 1/.test(body.prompt);
      return route.fulfill({ json: { ok: true, images: [isDraft ? fixtures.draft : fixtures.zero] } });
    }
    if (path === '/api/inpaint') {
      const body = request.postDataBuffer().toString('utf8');
      edits.push({ preservesSelectedBranches: body.includes('用户明确指定保留的分支不得删除或替换'), removesCompleteBranch: body.includes('删除多余分支及其脚踝、鞋袜') });
      return route.fulfill({ json: { ok: true, images: [fixtures.edited] } });
    }
    if (path === '/api/gallery' || path === '/api/prompts') return route.fulfill({ json: { ok: true, rows: [], hasMore: false } });
    if (path === '/api/payments/sponsors') return route.fulfill({ json: { ok: true, sponsors: [] } });
    if (path === '/api/image-capabilities') return route.fulfill({ json: { ok: true, presetQualityOptions: ['auto', 'high'] } });
    errors.push('Unexpected API: ' + path);
    return route.fulfill({ json: { ok: false, message: 'Unexpected test API' } });
  });
  await page.goto(base + '/#/workshop/yinghua');
  await page.getByRole('button', { name: '两阶段生成', exact: true }).waitFor();
  await page.evaluate(async ({ source, model }) => {
    const { useUploadStore } = await import('/src/store/useUploadStore.ts');
    const { useProviderStore } = await import('/src/store/useProviderStore.ts');
    const { useIdentityStore } = await import('/src/store/useIdentityStore.ts');
    useUploadStore.getState().setUpload(source, 'local-character.png');
    useProviderStore.getState().setProvider('gpt-image');
    useProviderStore.getState().setCred('gpt-image', { apiKey: 'local-intercept-only', baseUrl: 'https://example.invalid/v1', model });
    useIdentityStore.getState().setCharacterName('QA HERO');
  }, { source: fixtures.character, model });
  const panel = page.locator('section[data-inpaint-zone="yinghua"]');
  const zero = panel.locator('#yinghua-current-stage');
  await page.waitForFunction(async () => {
    const { useYinghuaStore } = await import('/src/store/useYinghuaStore.ts');
    return useYinghuaStore.getState().yinghuaPrompts[1].includes('QA');
  });
  return { context, page, zero, panel, requests, edits, control };
}
async function goToStep(panel, name) {
  await panel.getByRole('navigation', { name: '影画制作步骤' }).getByRole('button', { name: new RegExp(name) }).click();
}
async function state(page) {
  return page.evaluate(async () => {
    const { useYinghuaStore } = await import('/src/store/useYinghuaStore.ts');
    const { zeroFateDraft, zeroFateDraftPrompt, yinghuaSlots, activeGeneration } = useYinghuaStore.getState();
    return { zeroFateDraft, zeroFateDraftPrompt, yinghuaSlots, activeGeneration };
  });
}

try {
  const { context, page, zero, panel, requests, edits, control } = await setup();
  assert.equal(await panel.getByRole('button', { name: '两阶段生成', exact: true }).getAttribute('aria-pressed'), 'true');
  const modeNotice = panel.getByRole('note');
  assert.equal(await modeNotice.isVisible(), true);
  assert.match(await modeNotice.textContent(), /两阶段生成可能收到上游内容审核拒绝/);
  assert.match(await modeNotice.textContent(), /两种模式均须通过内容审核/);
  assert.equal(await panel.locator('[data-yinghua-stage]').count(), 1);
  assert.equal(await panel.locator('textarea:visible').count(), 0, 'prompt editors are collapsed by default');
  await goToStep(panel, '三命灰阶');
  assert.equal(await panel.getByRole('button', { name: '需先生成零命', exact: true }).isDisabled(), true);
  await goToStep(panel, '动作底稿');
  const canvas = await zero.locator('.yinghua-preview-canvas').boundingBox();
  const controls = await zero.locator('.yinghua-stage-controls').boundingBox();
  assert.ok(canvas.width > controls.width * 1.4, 'preview is the primary workspace, not a narrow card');
  await screenshot(page, '01-ready');
  await panel.screenshot({ path: join(output, 'workspace-desktop.png'), style: '.studio-header,.studio-edit-button { visibility: hidden !important; }' });
  control.next = 'hold';
  let heldFirst;
  const firstHeld = new Promise((resolve) => { heldFirst = resolve; });
  control.onHeld = heldFirst;
  await zero.getByRole('button', { name: '生成动作底稿', exact: true }).click();
  await firstHeld;
  await screenshot(page, '01b-generating');
  await panel.screenshot({ path: join(output, 'workspace-generating.png'), style: '.studio-header,.studio-edit-button { visibility: hidden !important; }' });
  const loadingCanvas = await zero.locator('.yinghua-preview-canvas').boundingBox();
  assert.ok(Math.abs(loadingCanvas.height - canvas.height) < 2, 'loading keeps a steady preview area');
  control.release();
  await zero.getByRole('button', { name: '确认结构并生成零命', exact: true }).waitFor();
  assert.equal(requests.length, 1, 'stage 2 requires explicit confirmation');
  assert.equal(requests[0].refImages?.length ?? 0, 0, 'draft should not receive silhouette samples');
  assert.equal(requests[0].inputImageMaxDimension, 1536);
  assert.match(requests[0].prompt, /【文字关闭】/);
  assert.match(requests[0].prompt, /每个膝盖只接一条小腿/);
  assert.doesNotMatch(requests[0].prompt, /卸防感|毫无戒备|慵懒|defenseless|unguarded|languid/i);
  assert.deepEqual((await state(page)).yinghuaSlots[1].images, []);
  await goToStep(panel, '三命灰阶');
  assert.equal(await panel.getByRole('button', { name: '需先生成零命', exact: true }).isDisabled(), true);
  await goToStep(panel, '动作底稿');
  checked('draft is previewed independently, preserves readable input size and never unlocks three-fate');

  await zero.getByRole('button', { name: '修改动作底稿', exact: true }).click();
  await page.getByPlaceholder('直接描述下一步改进', { exact: false }).fill('删除左下方多余的腿，保留底部中间的腿，其余保持不变');
  await page.getByRole('button', { name: '✨ 继续生成', exact: true }).click();
  await page.waitForFunction(async (edited) => {
    const { useInpaintStore } = await import('/src/store/useInpaintStore.ts');
    return useInpaintStore.getState().currentVersionUrl === edited;
  }, fixtures.edited);
  await page.getByRole('button', { name: '替换动作底稿', exact: true }).click();
  assert.equal((await state(page)).zeroFateDraft.images[0], fixtures.edited);
  assert.equal((await state(page)).yinghuaSlots[1].images.length, 0);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].preservesSelectedBranches, true);
  assert.equal(edits[0].removesCompleteBranch, true);
  await page.getByRole('button', { name: '✕ 关闭', exact: true }).first().click();
  await screenshot(page, '02-reviewed-draft');
  await zero.screenshot({ path: join(output, 'reviewed-draft-card.png') });
  checked('real edit workspace applies an edited version only to the action draft');

  control.next = 'fail';
  await zero.getByRole('button', { name: '确认结构并生成零命', exact: true }).click();
  await zero.getByRole('button', { name: '重试零命转换（沿用底稿）', exact: true }).waitFor();
  assert.equal(requests.length, 2);
  closeColor(await centerColor(requests[1]), [146, 189, 83]);
  assert.equal(requests[1].refImages[0].base64, fixtures.character.split(',')[1]);
  assert.equal(requests[1].refImages.length, 4, 'canonical character then three style samples');
  assert.doesNotMatch(requests[1].prompt, /优先采用大仰视/);
  assert.match(requests[1].prompt, /不在大腿或膝盖处分叉出额外小腿/);
  assert.equal((await state(page)).zeroFateDraft.images[0], fixtures.edited);
  await screenshot(page, '03-conversion-retry');
  await page.evaluate(async ({ three, six }) => {
    const { useYinghuaStore } = await import('/src/store/useYinghuaStore.ts');
    useYinghuaStore.getState().setYinghuaSlot(2, { status: 'done', images: [three] });
    useYinghuaStore.getState().setYinghuaSlot(3, { status: 'done', images: [six] });
  }, fixtures);
  await zero.getByRole('button', { name: '重试零命转换（沿用底稿）', exact: true }).click();
  await zero.locator('img[alt="yinghua-style1-1"]').waitFor();
  assert.equal(requests.length, 3);
  closeColor(await centerColor(requests[2]), [146, 189, 83]);
  assert.equal((await state(page)).yinghuaSlots[1].images[0], fixtures.zero);
  assert.deepEqual((await state(page)).yinghuaSlots[2].images, []);
  assert.deepEqual((await state(page)).yinghuaSlots[3].images, []);
  assert.equal(new Set(requests.map((request) => request.idempotencyKey)).size, requests.length);
  await screenshot(page, '04-zero-complete');
  checked('conversion edits the approved draft; failure retries only conversion; success clears outdated dependent tiers');

  await goToStep(panel, '动作底稿');
  control.next = 'fail';
  await zero.getByRole('button', { name: '重新生成动作底稿', exact: true }).click();
  await zero.getByRole('alert').waitFor();
  assert.equal((await state(page)).zeroFateDraft.images[0], fixtures.edited);
  assert.equal(await zero.getByRole('button', { name: '确认结构并生成零命', exact: true }).isEnabled(), true);
  checked('failed draft regeneration preserves the previous matching draft and finished zero-fate');

  await panel.locator('.yinghua-settings > summary').click();
  await panel.getByLabel('角色动态', { exact: true }).fill('侧躺，左腿屈膝右腿自然伸展');
  await zero.getByRole('status').waitFor();
  control.next = 'hold';
  const held = new Promise((resolve) => { control.onHeld = resolve; });
  await zero.getByRole('button', { name: '重新生成动作底稿', exact: true }).click();
  await page.waitForFunction(async () => {
    const { useYinghuaStore } = await import('/src/store/useYinghuaStore.ts');
    return useYinghuaStore.getState().activeGeneration?.phase === 'draft';
  });
  await held;
  assert.equal(typeof control.release, 'function');
  await panel.getByLabel('角色动态', { exact: true }).fill('倚靠，双腿自然弯曲');
  control.release();
  await zero.getByRole('alert').filter({ hasText: '生成期间角色或动作输入已更新' }).waitFor();
  assert.equal((await state(page)).yinghuaSlots[1].images[0], fixtures.zero);
  assert.equal(await zero.getByRole('button', { name: '重新生成动作底稿', exact: true }).isEnabled(), true);
  await panel.locator('.yinghua-settings > summary').click();
  await screenshot(page, '05-stale-draft');
  checked('changed inputs invalidate a draft, including when the change happens during generation');

  const beforeSafety = requests.length;
  const contextBeforeSafety = (await state(page)).zeroFateDraft.context;
  const promptBeforeSafety = (await state(page)).zeroFateDraftPrompt;
  control.next = 'safety';
  await zero.getByRole('button', { name: '重新生成动作底稿', exact: true }).click();
  await zero.getByRole('alert').getByText('内容审核未通过', { exact: true }).waitFor();
  assert.equal(requests.length, beforeSafety + 1, 'moderation rejection does not automatically resubmit');
  assert.deepEqual((await state(page)).zeroFateDraft.context, contextBeforeSafety);
  assert.equal((await state(page)).zeroFateDraftPrompt, promptBeforeSafety);
  assert.equal(requests.at(-1).prompt, promptBeforeSafety);
  assert.equal(await panel.getByRole('button', { name: '两阶段生成', exact: true }).getAttribute('aria-pressed'), 'true', 'a rejection must not switch modes automatically');
  await zero.getByText('查看应用提示（非上游原文）', { exact: true }).waitFor();
  assert.equal(await zero.getByText('查看上游原始错误', { exact: true }).count(), 0, 'old responses must not fabricate an upstream original');
  await screenshot(page, '05b-content-rejection');
  checked('content rejection shows actionable guidance, preserves inputs and never automatically retries');

  control.next = 'safety-detail';
  await zero.getByRole('button', { name: '重新生成动作底稿', exact: true }).click();
  await zero.getByText('查看上游原始错误', { exact: true }).waitFor();
  await zero.getByText('查看上游原始错误', { exact: true }).click();
  assert.equal(await zero.locator('[data-upstream-error-message]').textContent(), upstreamOriginalMessage);
  assert.equal(await zero.getByText('req-provider-qa-123', { exact: true }).count(), 1);
  assert.equal((await state(page)).zeroFateDraft.upstreamError.requestId, 'req-provider-qa-123');
  assert.equal(requests.at(-1).prompt, promptBeforeSafety);
  await screenshot(page, '05c-upstream-original-error');
  await zero.locator('.yinghua-error').screenshot({ path: join(output, 'upstream-error-provenance.png'), style: '.studio-header,.studio-edit-button { visibility: hidden !important; }' });
  checked('provider original message, request ID and category remain distinct from local guidance');

  await panel.getByRole('button', { name: '直接生成', exact: true }).click();
  const beforeDirect = requests.length;
  const directRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/generate');
  await zero.getByRole('button', { name: '生成零命', exact: true }).click();
  await directRequest;
  await page.waitForFunction(async () => {
    const { useYinghuaStore } = await import('/src/store/useYinghuaStore.ts');
    return useYinghuaStore.getState().yinghuaSlots[1].status === 'done' && !useYinghuaStore.getState().activeGeneration;
  });
  assert.equal(requests.length, beforeDirect + 1);
  assert.match(requests.at(-1).prompt, /优先采用大仰视、大俯视/);
  await screenshot(page, '06-direct-mode');
  checked('original direct mode remains a single explicit generation');
  await context.close();

  const mobile = await setup({ width: 390, height: 844 }, 'single-image-test-model');
  await mobile.panel.screenshot({ path: join(output, 'workspace-mobile.png'), style: '.studio-header,.studio-edit-button { visibility: hidden !important; }' });
  await mobile.zero.getByRole('button', { name: '生成动作底稿', exact: true }).click();
  await mobile.zero.getByRole('button', { name: '确认结构并生成零命', exact: true }).waitFor();
  await screenshot(mobile.page, '07-mobile-draft');
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await mobile.zero.getByRole('button', { name: '修改动作底稿', exact: true }).isVisible(), true);
  await mobile.zero.getByRole('button', { name: '确认结构并生成零命', exact: true }).click();
  await mobile.zero.locator('img[alt="yinghua-style1-1"]').waitFor();
  assert.equal(mobile.requests.length, 2);
  assert.equal(mobile.requests[1].refImages?.length ?? 0, 0);
  const meta = await sharp(Buffer.from(mobile.requests[1].imageBase64, 'base64')).metadata();
  assert.deepEqual([meta.width, meta.height], [1536, 1024], 'thumbnail fallback preserves the approved canvas');
  closeColor(await centerColor(mobile.requests[1]), [88, 185, 177]);
  await screenshot(mobile.page, '08-mobile-zero');
  checked('390px layout is usable; single-image conversion preserves the draft canvas and embeds references');
  await mobile.page.setViewportSize({ width: 320, height: 844 });
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await screenshot(mobile.page, '09-mobile-320');
  await mobile.context.close();
  assert.deepEqual(errors, [], 'browser console/runtime/API errors');
  await writeFile(join(output, 'results.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(`PASS ${checks.length} checks; 0 errors; screenshots: ${output}`);
} finally {
  await browser.close();
}
