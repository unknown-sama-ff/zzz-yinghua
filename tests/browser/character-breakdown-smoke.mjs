// Local browser integration: image generation is intercepted; no paid calls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const sharp = require('sharp');
const base = process.env.STUDIO_BASE_URL || 'http://127.0.0.1:5173';
const output = process.env.STUDIO_SCREENSHOT_DIR || 'work/character-breakdown-browser';
await mkdir(output, { recursive: true });
const fixtures = {};
for (const [key, color] of Object.entries({ front: '#235173', a: '#3d759b', b: '#995c68', sheetA: '#a8bc82', sheetB: '#cebd82', manual: '#b585c7', draft: '#82b7b0', result: '#5c4d70' })) {
  fixtures[key] = 'data:image/png;base64,' + (await sharp({ create: { width: 1536, height: 1024, channels: 3, background: color } }).png().toBuffer()).toString('base64');
}
const bytes = (url) => url.split(',')[1];
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const checks = [];
const errors = [];
const requests = [];
let held;
let holdNext = false;
let failNext = false;
function checked(message) { checks.push(message); console.log('PASS ' + message); }
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/generate') {
      const body = route.request().postDataJSON();
      requests.push(body);
      if (holdNext) { holdNext = false; await new Promise((resolve) => { held = resolve; }); }
      if (failNext) { failNext = false; return route.fulfill({ json: { ok: false, code: 'UPSTREAM_ERROR', message: '本地模拟拆解图失败' } }); }
      const image = /全景式角色深度概念分解图/.test(body.prompt) ? (body.prompt.includes('BETA') ? fixtures.sheetB : fixtures.sheetA)
        : /根据角色图片特点补全三视图/.test(body.prompt) ? fixtures.a
          : /动作底稿·第一阶段|ACTION DRAFT — STAGE 1/.test(body.prompt) ? fixtures.draft : fixtures.result;
      return route.fulfill({ json: { ok: true, images: [image] } });
    }
    if (path === '/api/image-capabilities') return route.fulfill({ json: { ok: true, presetQualityOptions: ['auto', 'high'] } });
    if (path === '/api/detect-face') return route.fulfill({ json: { ok: false, message: '本地样图未检测到人脸' } });
    if (path === '/api/payments/sponsors') return route.fulfill({ json: { ok: true, sponsors: [] } });
    if (path === '/api/gallery' || path === '/api/prompts') return route.fulfill({ json: { ok: true, rows: [], hasMore: false } });
    errors.push('Unexpected API: ' + path);
    return route.fulfill({ json: { ok: false, message: 'Unexpected API' } });
  });
  await page.goto(base + '/#/workshop/assets');
  await page.getByRole('button', { name: '生成三视图', exact: true }).waitFor();
  await page.evaluate(async (fixtures) => {
    const { useWorkbenchStore } = await import('/src/store/useWorkbenchStore.ts');
    const { useProviderStore } = await import('/src/store/useProviderStore.ts');
    useWorkbenchStore.getState().setThreeViewUpload('front', fixtures.front);
    useProviderStore.getState().setProvider('gpt-image');
    useProviderStore.getState().setCred('gpt-image', { apiKey: 'local-intercept-only', baseUrl: 'https://example.invalid/v1', model: 'gpt-image-2.5-sunburst' });
  }, fixtures);
  assert.equal(await page.getByRole('button', { name: '生成三视图', exact: true }).isDisabled(), true);
  await page.locator('#character-name').fill('  ');
  assert.equal(await page.getByRole('button', { name: '生成三视图', exact: true }).isDisabled(), true);
  assert.equal(requests.length, 0);
  await page.locator('#character-name').fill('ALPHA');
  await page.getByRole('button', { name: '生成三视图', exact: true }).click();
  const threeView = page.locator('section[data-inpaint-zone="three-view"]');
  await threeView.getByRole('button', { name: '用作主立绘', exact: true }).click();
  assert.match(requests[0].prompt, /角色名字：ALPHA/);
  checked('three-view generation requires a nonblank name and includes that name');

  const assets = page.getByRole('region', { name: '角色拆解图工作台' });
  await assets.getByRole('button', { name: '生成角色拆解图', exact: true }).click();
  await assets.getByAltText('当前配套角色拆解图', { exact: true }).waitFor();
  assert.equal(requests[1].imageBase64, bytes(fixtures.a));
  assert.match(requests[1].prompt, /角色名字：ALPHA/);
  assert.match(requests[1].prompt, /中文手写注释/);
  assert.match(requests[1].prompt, /纯白色背景/);
  assert.equal(await assets.getByAltText('当前配套角色拆解图', { exact: true }).getAttribute('src'), fixtures.sheetA);
  checked('breakdown generation uses the selected three-view, named prompt, Chinese notes and white background');

  await page.evaluate(async (fixtures) => {
    const { useWorkbenchStore } = await import('/src/store/useWorkbenchStore.ts');
    const { useCharacterSheetStore } = await import('/src/store/useCharacterSheetStore.ts');
    useWorkbenchStore.getState().addCostumeChangeImages([fixtures.b]);
    useCharacterSheetStore.getState().registerSources([fixtures.b], 'BETA');
  }, fixtures);
  holdNext = true;
  await assets.getByRole('button', { name: '生成角色拆解图', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.character-breakdown-generate')?.textContent.includes('生成角色拆解图中'));
  const sourcePicker = assets.getByLabel('拆解图对应的三视图', { exact: true });
  await sourcePicker.selectOption({ label: 'BETA · 2' });
  assert.equal(await page.locator('#character-name').inputValue(), 'BETA');
  while (!held) await new Promise((resolve) => setTimeout(resolve, 20));
  held(); held = undefined;
  await page.waitForFunction(async (source) => {
    const { useCharacterSheetStore } = await import('/src/store/useCharacterSheetStore.ts');
    return useCharacterSheetStore.getState().sheets[source]?.slot.status === 'done';
  }, fixtures.a);
  assert.equal(await assets.getByAltText('当前配套角色拆解图', { exact: true }).count(), 0);
  await assets.getByRole('button', { name: '生成角色拆解图', exact: true }).click();
  await assets.getByAltText('当前配套角色拆解图', { exact: true }).waitFor();
  assert.equal(await assets.getByAltText('当前配套角色拆解图', { exact: true }).getAttribute('src'), fixtures.sheetB);
  await sourcePicker.selectOption({ label: 'ALPHA · 2' });
  assert.equal(await page.locator('#character-name').inputValue(), 'ALPHA');
  assert.equal(await assets.getByAltText('当前配套角色拆解图', { exact: true }).getAttribute('src'), fixtures.sheetA);
  checked('switching three-views restores matching names and breakdowns; late results never attach to another source');

  failNext = true;
  await assets.getByRole('button', { name: '生成角色拆解图', exact: true }).click();
  await assets.getByRole('alert').waitFor();
  assert.equal(await assets.getByAltText('当前配套角色拆解图', { exact: true }).getAttribute('src'), fixtures.sheetA);
  await page.evaluate(() => {
    const originalRead = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (file) {
      if (file.name !== 'manual.png') return originalRead.call(this, file);
      window.releaseBreakdownRead = () => { FileReader.prototype.readAsDataURL = originalRead; originalRead.call(this, file); };
    };
  });
  await assets.getByLabel('上传角色拆解图', { exact: true }).setInputFiles({ name: 'manual.png', mimeType: 'image/png', buffer: Buffer.from(bytes(fixtures.manual), 'base64') });
  assert.equal(await assets.getByRole('button', { name: '生成角色拆解图', exact: true }).isDisabled(), true, 'reading a manual upload must block simultaneous paid generation');
  await page.evaluate(() => window.releaseBreakdownRead());
  await page.waitForFunction((src) => document.querySelector('img[alt="当前配套角色拆解图"]')?.getAttribute('src') === src, fixtures.manual);
  assert.equal(await assets.getByRole('alert').count(), 0, 'a successful manual upload clears the old generation error');
  await page.evaluate(async () => (await import('/src/store/useToast.ts')).useToast.getState().clear());
  checked('manual uploads bind to the current three-view; failed generation preserves the previous usable breakdown');
  await page.screenshot({ path: output + '/assets-desktop.png', fullPage: true });

  await page.evaluate(() => { location.hash = '#/workshop/yinghua'; });
  const panel = page.locator('section[data-inpaint-zone="yinghua"]');
  await panel.getByRole('button', { name: '生成动作底稿', exact: true }).waitFor();
  await panel.locator('.yinghua-settings > summary').click();
  assert.equal(await panel.getByAltText('当前配套角色拆解图', { exact: true }).getAttribute('src'), fixtures.manual);
  await panel.getByRole('button', { name: '生成动作底稿', exact: true }).click();
  await panel.getByRole('button', { name: '确认结构并生成零命', exact: true }).waitFor();
  assert.equal(requests.at(-1).refImages[0].base64, bytes(fixtures.manual));
  assert.match(requests.at(-1).prompt, /角色名字：ALPHA/);
  assert.match(requests.at(-1).prompt, /第1张为角色三视图，随后是拆解图/);
  const conversion = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/generate');
  await panel.getByRole('button', { name: '确认结构并生成零命', exact: true }).click();
  await conversion;
  await page.waitForFunction(async () => {
    const { useYinghuaStore } = await import('/src/store/useYinghuaStore.ts');
    return !useYinghuaStore.getState().activeGeneration && useYinghuaStore.getState().yinghuaSlots[1].status === 'done';
  });
  assert.equal(requests.at(-1).refImages[0].base64, bytes(fixtures.a));
  assert.equal(requests.at(-1).refImages[1].base64, bytes(fixtures.manual));
  assert.match(requests.at(-1).prompt, /第1张为已确认动作底稿，第2张为角色三视图，第3张为拆解图/);
  checked('draft and zero conversion use the correct reference order and stage-specific priorities');

  const go = async (name) => panel.getByRole('navigation', { name: '影画制作步骤' }).getByRole('button', { name: new RegExp(name) }).click();
  const runStage = async (step, button) => {
    await go(step);
    const nextRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/generate');
    await panel.getByRole('button', { name: button, exact: true }).click();
    await nextRequest;
    await page.waitForFunction(async () => {
      const { useYinghuaStore } = await import('/src/store/useYinghuaStore.ts');
      return !useYinghuaStore.getState().activeGeneration;
    });
    assert.ok(requests.at(-1).refImages.some((image) => image.base64 === bytes(fixtures.manual)));
    assert.equal(requests.at(-1).refImages[0].base64, bytes(fixtures.a));
  };
  await runStage('三命灰阶', '生成三命');
  assert.match(requests.at(-1).prompt, /只转换灰阶、指定点缀和背景/);
  await runStage('六命全彩', '生成六命阳');
  assert.match(requests.at(-1).prompt, /仅还原全彩/);
  await panel.getByRole('button', { name: '切换到六命阴', exact: true }).click();
  await runStage('六命全彩', '生成六命阴');
  assert.match(requests.at(-1).prompt, /仅执行本阶段指定的原服装精简/);
  checked('three-fate, Yang and Yin all receive the matched sheet with distinct rendering and clothing instructions');

  await panel.getByRole('button', { name: '切换到六命阳', exact: true }).click();
  await runStage('六命全彩', '生成六命阳');
  assert.equal(await page.evaluate(async () => (await import('/src/store/useYinghuaStore.ts')).useYinghuaStore.getState().yinghuaSlots[3].images.length), 1);
  await runStage('三命灰阶', '生成三命');
  assert.equal(await page.evaluate(async () => (await import('/src/store/useYinghuaStore.ts')).useYinghuaStore.getState().yinghuaSlots[3].images.length), 0);
  checked('new Yang invalidates old Yin; new three-fate invalidates both six-fate faces');

  await panel.getByLabel('配套角色拆解图', { exact: true }).selectOption('');
  assert.equal(await panel.getByRole('button', { name: '需先生成零命', exact: true }).isDisabled(), true);
  await go('动作底稿');
  assert.equal(await panel.getByRole('button', { name: '确认结构并生成零命', exact: true }).count(), 0);
  assert.equal(await panel.getByRole('button', { name: '重新生成动作底稿', exact: true }).isEnabled(), true);
  await panel.getByLabel('配套角色拆解图', { exact: true }).selectOption('0');
  await panel.getByRole('button', { name: '直接生成', exact: true }).click();
  const direct = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/generate');
  await panel.getByRole('button', { name: '生成零命', exact: true }).click();
  await direct;
  await page.waitForFunction(async () => !(await import('/src/store/useYinghuaStore.ts')).useYinghuaStore.getState().activeGeneration);
  assert.equal(requests.at(-1).refImages[0].base64, bytes(fixtures.manual));
  assert.match(requests.at(-1).prompt, /随后是拆解图与可选道具/);
  checked('changing the sheet invalidates old draft and downstream bases; direct mode also carries the selected sheet');

  const fallback = await page.evaluate(async (fixtures) => {
    const { prepareZeroFateInputs } = await import('/src/lib/zeroFateInputs.ts');
    const { isCurrentZeroFateDraft } = await import('/src/lib/zeroFate.ts');
    const options = { sourceImage: fixtures.a, breakdownImage: fixtures.manual, addonImage: null, provider: 'seedream', model: 'local-unknown' };
    const draft = await prepareZeroFateInputs({ ...options, phase: 'draft' });
    const render = await prepareZeroFateInputs({ ...options, phase: 'render', draftImage: fixtures.draft });
    const context = { sourceImage: fixtures.a, addonImage: null, prompt: 'same', breakdownImage: fixtures.manual };
    return { draftChanged: draft.imageOverride !== fixtures.a, renderChanged: render.imageOverride !== fixtures.draft,
      noSeparateReferences: !draft.refImages && !render.refImages,
      changedInvalid: !isCurrentZeroFateDraft({ status: 'done', images: [fixtures.draft], context }, { ...context, breakdownImage: fixtures.sheetA }) };
  }, fixtures);
  assert.deepEqual(fallback, { draftChanged: true, renderChanged: true, noSeparateReferences: true, changedInvalid: true });
  checked('single-image endpoints embed or compose the sheet and preserve draft invalidation');

  await page.screenshot({ path: output + '/yinghua-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: output + '/yinghua-mobile.png', fullPage: true });
  await page.evaluate(() => { location.hash = '#/workshop/assets'; });
  await assets.getByRole('button', { name: '生成角色拆解图', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: output + '/assets-mobile.png', fullPage: true });
  checked('desktop and mobile layouts retain source/sheet selection without horizontal overflow');
  assert.deepEqual(errors, []);
  await writeFile(output + '/report.json', JSON.stringify({ ok: true, checks, requestCount: requests.length, errors }, null, 2));
} catch (error) {
  const summary = await Promise.all(requests.map(async (request) => ({
    prompt: request.prompt.slice(0, 240),
    primary: [...await sharp(Buffer.from(request.imageBase64, 'base64')).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer()],
    references: await Promise.all((request.refImages ?? []).map(async (image) => [...await sharp(Buffer.from(image.base64, 'base64')).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer()])),
  })));
  await writeFile(output + '/report.json', JSON.stringify({ ok: false, checks, errors, error: error.stack?.split('\n').filter((line) => line.trim().startsWith('at ')).join('\n') || error.name, requests: summary }, null, 2));
  throw new Error('Browser integration failed; see ' + output + '/report.json', { cause: { name: error.name, stack: error.stack?.split('\n').filter((line) => line.trim().startsWith('at ')).join('\n') } });
} finally { await browser.close(); }
