import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { providers } from './providers.js';
import { gptImageQualityOptionsForModel, validateGptImageQuality } from './lib/gptImageCapabilities.js';
import { RETRY_SIZE_KB_THRESHOLD } from './lib/constants.js';

process.env.VERCEL = '1';
const { default: app } = await import('./index.js');
const six = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];
const four = six.slice(0, 4);
const ok = () => new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), { headers: { 'Content-Type': 'application/json' } });
const imageBuffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).png().toBuffer();
const maskBuffer = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
const imageBase64 = imageBuffer.toString('base64');
function env(t, values) {
  for (const [name, value] of Object.entries(values)) {
    const old = process.env[name];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
    t.after(() => { if (old === undefined) delete process.env[name]; else process.env[name] = old; });
  }
}
function preset(t) {
  env(t, { GPT_IMAGE_API_KEY: 'test-key', GPT_IMAGE_BASE_URL: 'https://quality-test.invalid/v1', GPT_IMAGE_MODEL: 'gpt-image-2.5-sunburst' });
}
function mockFetch(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => { globalThis.fetch = original; });
}
async function startApp(t) {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => { server.close(); server.closeAllConnections(); });
  await new Promise((resolve) => server.once('listening', resolve));
  return 'http://127.0.0.1:' + server.address().port;
}
function editForm(quality, precise = false, useServerPreset = true) {
  const form = new FormData();
  form.append('image', new Blob([imageBuffer], { type: 'image/png' }), 'image.png');
  if (precise) form.append('mask', new Blob([maskBuffer], { type: 'image/png' }), 'mask.png');
  form.append('editMode', precise ? 'precise' : 'smart');
  form.append('prompt', 'test');
  form.append('provider', 'gpt-image');
  if (quality !== undefined) form.append('quality', quality);
  if (useServerPreset) form.append('useServerPreset', 'true');
  else form.append('model', 'gpt-image-2');
  return form;
}

test('quality capabilities and validation preserve legacy requests and reject invalid values', () => {
  assert.deepEqual(gptImageQualityOptionsForModel(' GPT-IMAGE-2.5-FLARE '), six);
  for (const model of ['gpt-image-2', 'other', undefined]) assert.deepEqual(gptImageQualityOptionsForModel(model), four);
  for (const quality of six) assert.equal(validateGptImageQuality({ provider: 'gpt-image', model: 'gpt-image-2.5', quality }), null);
  for (const quality of [null, 1, {}, [], '', 'HIGH', 'ultra']) assert.match(validateGptImageQuality({ provider: 'gpt-image', model: 'gpt-image-2.5', quality }), /无效/);
  assert.match(validateGptImageQuality({ provider: 'gpt-image', model: 'gpt-image-2', quality: 'max' }), /不支持/);
  assert.equal(validateGptImageQuality({ provider: 'gpt-image' }), null);
  assert.equal(validateGptImageQuality({ provider: 'seedream', quality: 'ultra' }), null);
});

test('provider forwards six quality levels in generations and edits, preserving mask and references', async (t) => {
  preset(t);
  let quality;
  let editing = false;
  let calls = 0;
  mockFetch(t, async (url, init) => {
    calls += 1;
    if (editing) {
      assert.ok(url.endsWith('/images/edits'));
      assert.equal(init.body.get('quality'), quality ?? null);
      assert.equal(init.body.getAll('image').length, 2);
      assert.ok(init.body.get('mask'));
      assert.equal(init.body.get('size'), '1024x1024');
    } else {
      assert.ok(url.endsWith('/images/generations'));
      const body = JSON.parse(init.body);
      assert.equal(body.quality, quality);
      assert.equal(Object.hasOwn(body, 'quality'), quality !== undefined);
    }
    return ok();
  });
  for (quality of [...six, undefined]) {
    editing = false;
    await providers['gpt-image']({ provider: 'gpt-image', useServerPreset: true, prompt: 'test', quality });
    editing = true;
    await providers['gpt-image']({ provider: 'gpt-image', useServerPreset: true, prompt: 'test', quality, imageBase64, imageMime: 'image/png', refImages: [{ base64: imageBase64, mime: 'image/png' }], maskBase64: maskBuffer.toString('base64') });
  }
  assert.equal(calls, 14);
});

test('quality rejection is surfaced once, without a downgraded edit or generation retry', async (t) => {
  preset(t);
  // Preserve enough incompressible input to trigger the pre-existing size retry.
  const pixels = Buffer.alloc(900 * 900 * 3);
  let seed = 123456;
  for (let i = 0; i < pixels.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; pixels[i] = seed & 255; }
  const large = await sharp(pixels, { raw: { width: 900, height: 900, channels: 3 } }).png().toBuffer();
  assert.ok(large.length > RETRY_SIZE_KB_THRESHOLD * 1024);
  let calls = 0;
  let status;
  mockFetch(t, async () => { calls += 1; return new Response(JSON.stringify({ error: { param: 'quality', message: 'Unsupported quality' } }), { status }); });
  for (status of [400, 422]) for (const image of [undefined, large.toString('base64')]) {
    const before = calls;
    await assert.rejects(() => providers['gpt-image']({ provider: 'gpt-image', useServerPreset: true, prompt: 'test', quality: 'max', imageBase64: image, imageMime: 'image/png' }), /上游不支持当前生成精细度/);
    assert.equal(calls, before + 1);
  }
});

test('a size-related edit retry keeps the selected generation quality and mask', async (t) => {
  preset(t);
  const pixels = Buffer.alloc(900 * 900 * 3);
  let seed = 654321;
  for (let i = 0; i < pixels.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; pixels[i] = seed & 255; }
  const large = await sharp(pixels, { raw: { width: 900, height: 900, channels: 3 } }).png().toBuffer();
  let calls = 0;
  mockFetch(t, async (_url, init) => {
    calls += 1;
    assert.equal(init.body.get('quality'), 'xhigh');
    assert.ok(init.body.get('mask'));
    return calls === 1 ? new Response('input image too large', { status: 400 }) : ok();
  });
  await providers['gpt-image']({ provider: 'gpt-image', useServerPreset: true, prompt: 'test', quality: 'xhigh', inputImageMaxDimension: 2048, imageBase64: large.toString('base64'), imageMime: 'image/png', maskBase64: maskBuffer.toString('base64') });
  assert.equal(calls, 2);
});

test('invalid quality on either route is rejected before consuming public budget or contacting upstream', async (t) => {
  preset(t);
  env(t, { PRESET_DAILY_CAP: '1' });
  const base = await startApp(t);
  const original = globalThis.fetch;
  let calls = 0;
  mockFetch(t, async (url, init) => String(url).startsWith(base) ? original(url, init) : (calls += 1, ok()));
  for (const quality of ['ultra', '']) {
    let response = await fetch(base + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'gpt-image', prompt: 'test', useServerPreset: true, quality }) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_INPUT');
    response = await fetch(base + '/api/inpaint', { method: 'POST', body: editForm(quality) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_INPUT');
  }
  // The request's client model cannot unlock unsupported server-preset quality.
  process.env.GPT_IMAGE_MODEL = 'gpt-image-2';
  const incompatible = await fetch(base + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'gpt-image', prompt: 'test', useServerPreset: true, model: 'gpt-image-2.5', quality: 'max' }) });
  assert.equal(incompatible.status, 400);
  const editIncompatible = await fetch(base + '/api/inpaint', { method: 'POST', body: editForm('max') });
  assert.equal(editIncompatible.status, 400);
  assert.equal(calls, 0);
  const valid = await fetch(base + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'gpt-image', prompt: 'test', useServerPreset: true, quality: 'high' }) });
  assert.equal(valid.status, 200);
  assert.equal(calls, 1, 'invalid requests must leave the one-image budget intact');
  const exhausted = await fetch(base + '/api/inpaint', { method: 'POST', body: editForm('high') });
  assert.equal(exhausted.status, 429);
  assert.equal(calls, 1);
});

test('capability endpoint reveals only options for the actual preset model and disables caching', async (t) => {
  preset(t);
  const base = await startApp(t);
  for (const [model, expected] of [['gpt-image-2.5-sunburst', six], ['gpt-image-2.5-flare', six], [undefined, four]]) {
    if (model === undefined) delete process.env.GPT_IMAGE_MODEL; else process.env.GPT_IMAGE_MODEL = model;
    const response = await fetch(base + '/api/image-capabilities');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { ok: true, presetQualityOptions: expected });
  }
});

test('HTTP routes forward six levels for JSON generation and smart/precise multipart edits', async (t) => {
  preset(t);
  env(t, { PRESET_DAILY_CAP: '100000' });
  const base = await startApp(t);
  const original = globalThis.fetch;
  let expected;
  let calls = 0;
  mockFetch(t, async (url, init) => {
    if (String(url).startsWith(base)) return original(url, init);
    calls += 1;
    if (init.body instanceof FormData) assert.equal(init.body.get('quality'), expected ?? null);
    else assert.equal(JSON.parse(init.body).quality, expected);
    return ok();
  });
  for (expected of [...six, undefined]) {
    const response = await fetch(base + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'gpt-image', prompt: 'test', useServerPreset: true, quality: expected }) });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    for (const precise of [false, true]) {
      const response = await fetch(base + '/api/inpaint', { method: 'POST', body: editForm(expected, precise) });
      assert.equal(response.status, 200, JSON.stringify(await response.json()));
    }
  }
  assert.equal(calls, 21);
});


test('direct provider callers without a provider field still validate quality', async (t) => {
  preset(t);
  let calls = 0;
  mockFetch(t, async () => { calls += 1; return ok(); });
  await assert.rejects(() => providers['gpt-image']({ useServerPreset: true, prompt: 'test', quality: 'ultra' }), /无效的生成精细度/);
  assert.equal(calls, 0);
});
