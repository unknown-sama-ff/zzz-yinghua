import assert from 'node:assert/strict';
import test from 'node:test';
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
  assert.equal(validateGptImageAnimation({ ...request, frame_count: 64, frame_duration_ms: 2000, stream: false, size: '512x512' }), null);
  for (const patch of [{ frame_count: 1 }, { frame_count: 65 }, { frame_count: 2.5 }, { frame_count: '16' },
    { frame_duration_ms: 19 }, { frame_duration_ms: 2001 }, { frame_duration_ms: NaN },
    { model: 'gpt-image-2.5-flare' }, { provider: 'seedream' }, { imageBase64: 'image' },
    { refImages: [{}] }, { maskBase64: 'mask' }, { stream: true }, { partial_images: 1 },
    { output_compression: 50 }, { prompt_rewriter: true }, { size: '511x512' }, { size: '999999x999999' }, { aspectRatio: '1:1' }]) {
    assert.ok(validateGptImageAnimation({ ...request, ...patch }), JSON.stringify(patch));
  }
  assert.match(validateGptImageAnimation({ ...request, output_format: 'png', frame_count: 16 }), /仅适用于 GIF/);
  assert.match(validateGptImageAnimation(request, { editing: true }), /编辑不支持/);
  assert.equal(validateGptImageAnimation({ provider: 'gpt-image' }), null);
});

test('GIF results use actual GIF MIME without relabeling existing raster formats', () => {
  assert.deepEqual(pluckImages({ data: [{ b64_json: gif }] }), ['data:image/gif;base64,' + gif]);
  assert.match(pluckImages({ data: [{ b64_json: 'iVBORw0KGgoAAA==' }] }, 'gif')[0], /^data:image\/png;/);
});

test('provider forwards GIF options only to generations and leaves complexity at its default', async (t) => {
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

test('a relay returning a static image for GIF fails explicitly without silently changing output', async (t) => {
  preset(t);
  let calls = 0;
  mock(t, async () => { calls++; return new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAA==' }] })); });
  await assert.rejects(() => providers['gpt-image']({ ...request, useServerPreset: true }), /未返回 GIF/);
  assert.equal(calls, 1);
});

test('GIF HTTP validation precedes public budget use and edits reject animation output', async (t) => {
  preset(t); env(t, { PRESET_DAILY_CAP: '1' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const original = globalThis.fetch; let calls = 0;
  mock(t, async (url, init) => String(url).startsWith(base) ? original(url, init) : (calls++, ok()));
  const generate = (body) => fetch(base + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, useServerPreset: true, ...body }) });
  for (const patch of [{ frame_count: 65 }, { imageBase64: 'image' }, { stream: true }]) assert.equal((await generate(patch)).status, 400);
  process.env.GPT_IMAGE_MODEL = 'gpt-image-2.5-flare';
  assert.equal((await generate({ model: 'gpt-image-2.6-flare' })).status, 400, 'client model cannot override preset capability');
  process.env.GPT_IMAGE_MODEL = request.model;
  const edit = new FormData(); edit.set('output_format', 'gif');
  assert.equal((await fetch(base + '/api/inpaint', { method: 'POST', body: edit })).status, 400);
  assert.equal(calls, 0);
  const result = await generate({ frame_count: 16, frame_duration_ms: 100 });
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).images, ['data:image/gif;base64,' + gif]);
  assert.equal((await generate({})).status, 429);
  assert.equal(calls, 1);
});
