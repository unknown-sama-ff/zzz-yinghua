import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { providers } from './providers.js';
import { maxInputImagesForGptModel, supportsGptImageTransparency, validateGptImageBackground } from './lib/gptImageCapabilities.js';

process.env.VERCEL = '1';
const { default: app } = await import('./index.js');
const imageBuffer = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ffffff' } }).png().toBuffer();
const imageBase64 = imageBuffer.toString('base64');
const ok = () => new Response(JSON.stringify({ data: [{ b64_json: imageBase64 }] }), { headers: { 'Content-Type': 'application/json' } });

function env(t, values) {
  for (const [name, value] of Object.entries(values)) {
    const old = process.env[name];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
    t.after(() => { if (old === undefined) delete process.env[name]; else process.env[name] = old; });
  }
}

async function start(t) {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => { server.close(); server.closeAllConnections(); });
  await new Promise(resolve => server.once('listening', resolve));
  return 'http://127.0.0.1:' + server.address().port;
}

function request(base, body) {
  return fetch(base + '/api/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'gpt-image', prompt: 'sticker', useServerPreset: true, ...body }),
  });
}

test('documented GPT image families support sixteen inputs; unknown names remain conservative', () => {
  for (const model of ['gpt-image-1', 'gpt-image-1.5', 'gpt-image-1-mini', 'gpt-image-2', 'gpt-image-2.5', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2.6', 'gpt-image-2.6-sunburst', 'gpt-image-2.6-flare']) {
    assert.equal(maxInputImagesForGptModel(model), 16, model);
    assert.equal(maxInputImagesForGptModel(model + '-2026-09-08'), 16, model);
  }
  for (const model of [undefined, '', 'gpt-image-3', 'gpt-image-2.5-custom', 'gpt-image-2.6-beta', 'gpt-image-2-custom', 'gpt-image-2-2026', 'other-model']) {
    assert.equal(maxInputImagesForGptModel(model), 1, String(model));
  }
  assert.equal(maxInputImagesForGptModel(' GPT-IMAGE-2 '), 16);
});

test('transparency is limited to documented families and validates output/provider independently', () => {
  for (const model of ['gpt-image-1', 'gpt-image-1.5', 'gpt-image-1-mini', 'gpt-image-2', 'gpt-image-2-2026-04-21', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare-2026-09-08', 'gpt-image-2.6-sunburst', 'gpt-image-2.6-flare', 'gpt-image-2.6-sunburst-2026-09-08', 'gpt-image-2.6-flare-2026-09-08']) {
    assert.equal(supportsGptImageTransparency(model), true, model);
    for (const output_format of [undefined, 'png', 'webp']) {
      assert.equal(validateGptImageBackground({ provider: 'gpt-image', model, background: 'transparent', output_format }), null);
    }
  }
  for (const model of ['gpt-image-2.5', 'gpt-image-2.6', 'gpt-image-2.6-beta', 'gpt-image-2-custom', undefined]) {
    assert.equal(supportsGptImageTransparency(model), false, String(model));
    assert.match(validateGptImageBackground({ provider: 'gpt-image', model, background: 'transparent' }), /未确认支持透明背景/);
  }
  for (const output_format of ['jpeg', 'gif']) {
    assert.match(validateGptImageBackground({ provider: 'gpt-image', model: 'gpt-image-2', background: 'transparent', output_format }), /PNG 或 WebP/);
  }
  assert.match(validateGptImageBackground({ provider: 'seedream', background: 'opaque' }), /仅支持 gpt-image/);
  assert.match(validateGptImageBackground({ provider: 'gpt-image', background: 'invalid' }), /无效/);
});

test('invalid background requests leave the preset budget intact and never reach upstream', async (t) => {
  env(t, { PRESET_DAILY_CAP: '1', GPT_IMAGE_MODEL: 'gpt-image-2' });
  const originalProvider = providers['gpt-image'];
  let calls = 0;
  providers['gpt-image'] = async () => { calls += 1; return { images: ['fixture'] }; };
  t.after(() => { providers['gpt-image'] = originalProvider; });
  const base = await start(t);
  for (const body of [
    { background: 'invalid' }, { background: '' }, { background: null },
    { provider: 'seedream', background: 'transparent' },
    { background: 'transparent', output_format: 'jpeg' },
    { background: 'transparent', output_format: 'gif' },
  ]) {
    const response = await request(base, body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_INPUT');
  }
  process.env.GPT_IMAGE_MODEL = 'gpt-image-2.6';
  const unsupported = await request(base, { background: 'transparent', model: 'gpt-image-2' });
  assert.equal(unsupported.status, 400, 'a client model cannot unlock preset transparency');
  assert.match((await unsupported.json()).message, /未确认支持透明背景/);
  assert.equal(calls, 0);
  process.env.GPT_IMAGE_MODEL = 'gpt-image-2';
  assert.equal((await request(base, { background: 'transparent', output_format: 'png' })).status, 200);
  assert.equal(calls, 1);
  assert.equal((await request(base, { background: 'opaque' })).status, 429);
  assert.equal(calls, 1);
});

test('generation API enforces the known-model reference ceiling before spending budget', async (t) => {
  env(t, { PRESET_DAILY_CAP: '100000', GPT_IMAGE_MODEL: 'gpt-image-2' });
  const originalProvider = providers['gpt-image'];
  const received = [];
  providers['gpt-image'] = async body => { received.push(body); return { images: ['fixture'] }; };
  t.after(() => { providers['gpt-image'] = originalProvider; });
  const base = await start(t);
  const inputs = { imageBase64, refImages: Array.from({ length: 15 }, () => ({ base64: imageBase64, mime: 'image/png' })) };
  assert.equal((await request(base, inputs)).status, 200);
  assert.equal(received[0].refImages.length, 15);
  assert.equal((await request(base, { ...inputs, refImages: [...inputs.refImages, inputs.refImages[0]] })).status, 400);
  process.env.GPT_IMAGE_MODEL = 'gpt-image-unknown';
  const unknown = await request(base, { ...inputs, refImages: inputs.refImages.slice(0, 1) });
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).message, /最多支持 1 张/);
  assert.equal(received.length, 1);
});

test('static generation JSON and image-edit multipart forward background and output format', async (t) => {
  env(t, { PRESET_DAILY_CAP: '100000', GPT_IMAGE_API_KEY: 'test-key', GPT_IMAGE_BASE_URL: 'https://sticker-test.invalid/v1', GPT_IMAGE_MODEL: 'gpt-image-2' });
  const base = await start(t);
  const originalFetch = globalThis.fetch;
  const received = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).startsWith(base)) return originalFetch(url, init);
    const editing = String(url).endsWith('/images/edits');
    const payload = editing ? Object.fromEntries(init.body) : JSON.parse(init.body);
    received.push({ editing, payload });
    return ok();
  });
  for (const background of ['transparent', 'opaque', 'auto']) {
    for (const output_format of ['png', 'webp']) {
      for (const editing of [false, true]) {
        let response;
        if (editing) {
          const form = new FormData();
          for (const [name, value] of Object.entries({ provider: 'gpt-image', prompt: 'sticker', useServerPreset: 'true', background, output_format })) form.append(name, value);
          form.append('image', new Blob([imageBuffer], { type: 'image/png' }), 'image.png');
          response = await fetch(base + '/api/generate', { method: 'POST', body: form });
        } else response = await request(base, { background, output_format });
        assert.equal(response.status, 200, JSON.stringify(await response.json()));
        const last = received.at(-1);
        assert.equal(last.editing, editing);
        assert.equal(last.payload.background, background);
        assert.equal(last.payload.output_format, output_format);
        assert.equal(last.payload.model, 'gpt-image-2');
      }
    }
  }
  assert.equal(received.length, 12);
});

test('capability API reports additive limits without revealing preset credentials or model', async (t) => {
  env(t, { GPT_IMAGE_API_KEY: 'private-test-key', GPT_IMAGE_BASE_URL: 'https://private-test.invalid', GPT_IMAGE_MODEL: 'gpt-image-2' });
  const base = await start(t);
  for (const [model, limit, transparent] of [['gpt-image-2', 16, true], ['gpt-image-2.5-flare-2026-09-08', 16, true], ['gpt-image-2.6-sunburst', 16, true], ['gpt-image-2.6-flare', 16, true], ['gpt-image-2.6-flare-2026-09-08', 16, true], ['gpt-image-2.6', 16, false], ['gpt-image-custom', 1, false]]) {
    process.env.GPT_IMAGE_MODEL = model;
    const response = await fetch(base + '/api/image-capabilities');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ['ok', 'presetQualityOptions', 'presetGifSupported', 'presetMaxInputImages', 'presetTransparencySupported'].sort());
    assert.equal(body.presetMaxInputImages, limit);
    assert.equal(body.presetTransparencySupported, transparent);
    assert.doesNotMatch(JSON.stringify(body), /private-test|gpt-image-/);
  }
});

test('direct GPT image callers validate transparent outputs before contacting upstream', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return ok(); });
  await assert.rejects(() => providers['gpt-image']({ model: 'gpt-image-2', prompt: 'sticker', background: 'transparent', output_format: 'jpeg' }), /PNG 或 WebP/);
  await assert.rejects(() => providers['gpt-image']({ model: 'gpt-image-2.6', prompt: 'sticker', background: 'transparent' }), /未确认支持透明背景/);
  assert.equal(calls, 0);
});
