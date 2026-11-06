import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { providers } from './providers.js';
import { validateGptImageAnimation } from './lib/gptImageAnimation.js';
import { pluckImages } from './lib/pluckImages.js';

process.env.VERCEL = '1';
const { default: app } = await import('./index.js');
const gif = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const request = { provider: 'gpt-image', model: 'gpt-image-2.6-flare', prompt: 'cat waves, seamless loop', output_format: 'gif' };
function env(t, values) {
  for (const [name, value] of Object.entries(values)) {
    const prior = process.env[name]; process.env[name] = value;
    t.after(() => { if (prior === undefined) delete process.env[name]; else process.env[name] = prior; });
  }
}
function preset(t) { env(t, { GPT_IMAGE_API_KEY: 'gif-test-key', GPT_IMAGE_BASE_URL: 'https://gif-test.invalid/v1', GPT_IMAGE_MODEL: request.model }); }
function mock(t, handler) { const prior = globalThis.fetch; globalThis.fetch = handler; t.after(() => { globalThis.fetch = prior; }); }
const ok = () => new Response(JSON.stringify({ data: [{ b64_json: gif }] }), { headers: { 'Content-Type': 'application/json' } });

test('GIF validation accepts guide limits and rejects incompatible inputs and unsupported features', () => {
  assert.equal(validateGptImageAnimation(request), null);
  assert.equal(validateGptImageAnimation({ ...request, frame_count: 16, frame_duration_ms: 2000, stream: false, size: '512x512' }), null);
  assert.equal(validateGptImageAnimation({ ...request, imageBase64: 'image', refImages: [{ base64: 'reference' }] }), null);
  for (const patch of [{ frame_count: 1 }, { frame_count: 17 }, { frame_count: 2.5 }, { frame_count: '16' },
    { frame_duration_ms: 19 }, { frame_duration_ms: 2001 }, { frame_duration_ms: NaN },
    { model: 'gpt-image-2.5-flare' }, { provider: 'seedream' },
    { maskBase64: 'mask' }, { mask: {} }, { stream: true }, { partial_images: 1 },
    { output_compression: 50 }, { prompt_rewriter: true }, { size: '511x512' }, { size: '999999x999999' }, { aspectRatio: '1:1' }]) {
    assert.ok(validateGptImageAnimation({ ...request, ...patch }), JSON.stringify(patch));
  }
  assert.match(validateGptImageAnimation({ ...request, output_format: 'png', frame_count: 16 }), /仅适用于 GIF/);
  assert.equal(validateGptImageAnimation({ provider: 'gpt-image' }), null);
});

test('GIF results use actual GIF MIME without relabeling existing raster formats', () => {
  assert.deepEqual(pluckImages({ data: [{ b64_json: gif }] }), ['data:image/gif;base64,' + gif]);
  assert.match(pluckImages({ data: [{ b64_json: 'iVBORw0KGgoAAA==' }] }, 'gif')[0], /^data:image\/png;/);
});

test('provider forwards text GIF options to generations and leaves complexity at its default', async (t) => {
  preset(t);
  let calls = 0;
  mock(t, async (url, init) => {
    assert.equal(url, 'https://gif-test.invalid/v1/images/generations');
    const body = JSON.parse(init.body);
    assert.equal(body.output_format, 'gif'); assert.equal(body.stream, false); assert.equal(body.size, 'auto');
    assert.equal(Object.hasOwn(body, 'complexity'), false);
    assert.equal(Object.hasOwn(body, 'reasoning_effort'), false);
    if (calls++) { assert.equal(body.frame_count, 16); assert.equal(body.frame_duration_ms, 100); }
    else { assert.equal(Object.hasOwn(body, 'frame_count'), false); assert.equal(Object.hasOwn(body, 'frame_duration_ms'), false); }
    return ok();
  });
  const first = await providers['gpt-image']({ ...request, useServerPreset: true });
  assert.equal(first.images[0], 'data:image/gif;base64,' + gif);
  await providers['gpt-image']({ ...request, useServerPreset: true, frame_count: 16, frame_duration_ms: 95 });
  assert.equal(calls, 2);
});

test('provider sends still images and GIF options to edits and validates returned animation bytes', async (t) => {
  preset(t);
  const imageBase64 = (await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).png().toBuffer()).toString('base64');
  let calls = 0;
  mock(t, async (url, init) => {
    assert.equal(url, 'https://gif-test.invalid/v1/images/edits');
    const form = init.body;
    assert.ok(form instanceof FormData);
    assert.equal(form.get('output_format'), 'gif');
    assert.equal(form.get('stream'), 'false');
    assert.equal(form.get('size'), 'auto');
    assert.equal(form.get('n'), '1');
    assert.equal(form.get('quality'), 'high');
    assert.equal(form.get('frame_count'), '16');
    assert.equal(form.get('frame_duration_ms'), '100');
    assert.equal(form.has('complexity'), false);
    assert.equal(form.has('reasoning_effort'), false);
    assert.equal(form.has('mask'), false);
    assert.equal(form.getAll('image').length, 2);
    assert.ok((await form.get('image').arrayBuffer()).byteLength > 0);
    return calls++ === 0 ? ok() : Response.json({ data: [{ b64_json: 'iVBORw0KGgoAAA==' }] });
  });
  const input = { ...request, useServerPreset: true, imageBase64, imageMime: 'image/png',
    refImages: [{ base64: imageBase64, mime: 'image/png' }], frame_count: 16, frame_duration_ms: 95, quality: 'high' };
  assert.deepEqual((await providers['gpt-image'](input)).images, ['data:image/gif;base64,' + gif]);
  await assert.rejects(() => providers['gpt-image'](input), /未返回 GIF/);
  assert.equal(calls, 2);
});

test('a relay returning a static image for GIF fails explicitly without silently changing output', async (t) => {
  preset(t);
  let calls = 0;
  mock(t, async () => { calls++; return new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAA==' }] })); });
  await assert.rejects(() => providers['gpt-image']({ ...request, useServerPreset: true }), /未返回 GIF/);
  assert.equal(calls, 1);
});

test('GIF HTTP validation precedes public budget use, allows still inputs and rejects inpaint output', async (t) => {
  preset(t); env(t, { PRESET_DAILY_CAP: '1' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const original = globalThis.fetch; let calls = 0;
  mock(t, async (url, init) => String(url).startsWith(base) ? original(url, init) : (calls++, ok()));
  const generate = (body) => fetch(base + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, useServerPreset: true, ...body }) });
  for (const patch of [{ frame_count: 17 }, { maskBase64: 'mask' }, { stream: true },
    { imageBase64: 'image', refImages: [{}] },
    { freeCreate: true, imageBase64: 'image', refImages: Array.from({ length: 16 }, () => ({ base64: 'image' })) }]) {
    assert.equal((await generate(patch)).status, 400);
  }
  process.env.GPT_IMAGE_MODEL = 'gpt-image-2.5-flare';
  assert.equal((await generate({ model: 'gpt-image-2.6-flare' })).status, 400, 'client model cannot override preset capability');
  process.env.GPT_IMAGE_MODEL = request.model;
  const edit = new FormData(); edit.set('output_format', 'gif');
  assert.equal((await fetch(base + '/api/inpaint', { method: 'POST', body: edit })).status, 400);
  assert.equal(calls, 0);
  const imageBase64 = (await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).png().toBuffer()).toString('base64');
  const result = await generate({ frame_count: 16, frame_duration_ms: 100, imageBase64 });
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).images, ['data:image/gif;base64,' + gif]);
  assert.equal((await generate({})).status, 429);
  assert.equal(calls, 1);
});
