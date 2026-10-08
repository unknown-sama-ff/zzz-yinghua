import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';
import { gptImageQualityOptionsForModel as serverOptions } from '../../server/lib/gptImageCapabilities.js';

const m = await loadFrontend(`
  export * from './src/lib/gptImageCapabilities';
  export * from './src/store/useProviderStore';
  export { useToast } from './src/store/useToast';
  export { buildFreeCreateRequest } from './src/lib/freeCreate';
  export { useBuildRequest } from './src/components/useBuildRequest';
  export { ProviderSelect } from './src/components/ProviderSelect';
  export { generate, inpaint, ApiError } from './src/lib/apiClient';
  export { createElement } from 'react';
  export { renderToString } from 'react-dom/server';
`);
const store = m.useProviderStore;
const six = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];
const four = six.slice(0, 4);
function reset() {
  store.getState().setFreeloadEnabled(false);
  store.setState({ provider: 'gpt-image', gptImageQuality: 'auto' });
  store.getState().setCred('gpt-image', { model: 'gpt-image-2.5-sunburst' });
  m.useToast.getState().clear();
}
function mockFetch(t, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => { globalThis.fetch = original; });
}
function caps(options) {
  return new Response(JSON.stringify({ ok: true, presetQualityOptions: options }));
}
async function settled() {
  while (store.getState().presetQualityStatus === 'loading') await new Promise((resolve) => setImmediate(resolve));
}
// Zustand server rendering reads its initial snapshot; mirror the current state
// only for this render so hook/request tests exercise the selected settings.
function renderCurrentState(element) {
  const initial = store.getInitialState();
  const saved = { ...initial };
  Object.assign(initial, store.getState());
  try { return m.renderToString(element); }
  finally { Object.assign(initial, saved); }
}
function builtRequest() {
  let request;
  function Probe() {
    const build = m.useBuildRequest();
    request = build('test', { size: '1536x1024' });
    return null;
  }
  renderCurrentState(m.createElement(Probe));
  return request;
}

test('frontend and server agree on 2.5 aliases, normalization, old and unknown models', () => {
  for (const model of ['gpt-image-2.5', 'gpt-image-2.5-sunburst', ' GPT-IMAGE-2.5-FLARE ', 'gpt-image-2', 'gpt-image-1', 'relay-alias', '', undefined]) {
    const actual = m.gptImageQualityOptionsForModel(model);
    assert.deepEqual(actual, serverOptions(model));
    assert.deepEqual(actual, model?.trim().toLowerCase().startsWith('gpt-image-2.5') ? six : four);
  }
});

test('quality defaults to auto and all six values are available in memory', () => {
  assert.equal(store.getInitialState().gptImageQuality, 'auto');
  reset();
  for (const quality of six) {
    store.getState().setGptImageQuality(quality);
    assert.equal(m.gptImageQualityForRequest(store.getState()), quality);
  }
});

test('changing to an incompatible model resets quality and explains why', () => {
  reset();
  store.getState().setGptImageQuality('max');
  store.getState().setCred('gpt-image', { model: 'gpt-image-2' });
  assert.equal(store.getState().gptImageQuality, 'auto');
  assert.match(m.useToast.getState().message, /已重置为自动/);
  store.getState().setGptImageQuality('max');
  assert.equal(store.getState().gptImageQuality, 'auto');
});

test('shared builder forwards every quality for GPT, but not seedream or custom URL', () => {
  reset();
  for (const quality of six) {
    store.getState().setGptImageQuality(quality);
    assert.equal(builtRequest().quality, quality);
    assert.equal(builtRequest().size, '1536x1024');
  }
  for (const provider of ['seedream', 'custom-url']) {
    store.getState().setProvider(provider);
    assert.equal(Object.hasOwn(builtRequest(), 'quality'), false);
  }
});

test('free-create forwards quality and preserves old calls that omit it', () => {
  const input = { prompt: 'test', contextImageUrl: null, references: [], credentials: { apiKey: '', baseUrl: '', model: '' }, useServerPreset: false, imageCount: 2, aspectRatio: '16:9' };
  assert.equal(Object.hasOwn(m.buildFreeCreateRequest(input), 'quality'), false);
  for (const quality of six) {
    const request = m.buildFreeCreateRequest({ ...input, quality });
    assert.equal(request.quality, quality);
    assert.equal(request.n, 2);
    assert.equal(request.size, '1536x864');
  }
});

test('preset discovery omits quality until ready, then exposes server options', async (t) => {
  reset();
  let complete;
  mockFetch(t, (url, init) => {
    assert.equal(url, '/api/image-capabilities');
    assert.equal(init.cache, 'no-store');
    return new Promise((resolve) => { complete = resolve; });
  });
  store.getState().setGptImageQuality('max');
  store.getState().setFreeloadEnabled(true);
  assert.equal(m.gptImageQualityForRequest(store.getState()), undefined);
  assert.equal(Object.hasOwn(builtRequest(), 'quality'), false);
  complete(caps(six));
  await settled();
  assert.deepEqual(m.gptImageQualityOptions(store.getState()), six);
  assert.equal(builtRequest().quality, 'max');
  assert.equal(builtRequest().useServerPreset, true);
});

test('preset old-model discovery resets unsupported quality with a notification', async (t) => {
  reset();
  store.getState().setGptImageQuality('xhigh');
  mockFetch(t, async () => caps(four));
  store.getState().setFreeloadEnabled(true);
  await settled();
  assert.equal(store.getState().gptImageQuality, 'auto');
  assert.match(m.useToast.getState().message, /已重置为自动/);
});

test('leaving preset mode reconciles against the client model', async (t) => {
  reset();
  store.getState().setCred('gpt-image', { model: 'gpt-image-2' });
  mockFetch(t, async () => caps(six));
  store.getState().setFreeloadEnabled(true);
  await settled();
  store.getState().setGptImageQuality('max');
  store.getState().setFreeloadEnabled(false);
  assert.equal(store.getState().gptImageQuality, 'auto');
});

test('failed or malformed discovery disables selection, omits quality, and supports retry', async (t) => {
  reset();
  let response = new Response('offline', { status: 503 });
  mockFetch(t, async () => response);
  store.getState().setFreeloadEnabled(true);
  await settled();
  assert.equal(store.getState().presetQualityStatus, 'error');
  assert.equal(m.gptImageQualityForRequest(store.getState()), undefined);
  let html = renderCurrentState(m.createElement(m.ProviderSelect));
  assert.match(html, /id="gpt-image-quality"[^>]*disabled/);
  assert.match(html, /仍可按服务器默认生成/);
  response = caps(['auto', 'unsupported']);
  await store.getState().loadPresetQualityOptions();
  assert.equal(store.getState().presetQualityStatus, 'error');
  response = caps(six);
  await store.getState().loadPresetQualityOptions();
  assert.equal(store.getState().presetQualityStatus, 'ready');
  html = renderCurrentState(m.createElement(m.ProviderSelect));
  assert.match(html, /最高/);
});

test('stale preset response cannot overwrite a newer discovery or a mode switch', async (t) => {
  reset();
  const pending = [];
  mockFetch(t, () => new Promise((resolve) => { pending.push(resolve); }));
  store.getState().setFreeloadEnabled(true);
  const newest = store.getState().loadPresetQualityOptions();
  pending[1](caps(six));
  await newest;
  pending[0](caps(four));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(store.getState().presetQualityOptions, six);
  const abandoned = store.getState().loadPresetQualityOptions();
  store.getState().setFreeloadEnabled(false);
  pending[2](caps(four));
  await abandoned;
  assert.equal(store.getState().presetQualityOptions, null);
  assert.equal(store.getState().presetQualityStatus, 'idle');
});

test('quality UI offers six choices for 2.5, four for legacy, and hides for other providers', () => {
  reset();
  let html = renderCurrentState(m.createElement(m.ProviderSelect));
  for (const quality of six) assert.ok(html.includes('value="' + quality + '"'));
  assert.match(html, /更高精细度可能增加生成耗时和费用/);
  store.getState().setCred('gpt-image', { model: 'gpt-image-2' });
  html = renderCurrentState(m.createElement(m.ProviderSelect));
  assert.equal(html.includes('value="max"'), false);
  store.getState().setProvider('seedream');
  assert.equal(renderCurrentState(m.createElement(m.ProviderSelect)).includes('id="gpt-image-quality"'), false);
});

test('generate transports quality and preserves useful HTTP error details', async (t) => {
  let calls = 0;
  mockFetch(t, async (_url, init) => {
    calls += 1;
    assert.equal(JSON.parse(init.body).quality, 'max');
    return new Response(JSON.stringify({ ok: false, code: 'INVALID_INPUT', message: '上游不支持当前生成精细度' }), { status: 422 });
  });
  await assert.rejects(() => m.generate({ provider: 'gpt-image', prompt: 'test', quality: 'max' }), (error) => {
    assert.equal(error.code, 'INVALID_INPUT');
    assert.match(error.message, /上游不支持当前生成精细度/);
    return true;
  });
  assert.equal(calls, 1);
});

test('inpaint transports all six quality values and omits quality for legacy callers', async (t) => {
  let expected;
  mockFetch(t, async (_url, init) => {
    assert.equal(init.body.get('quality'), expected ?? null);
    return new Response(JSON.stringify({ ok: true, images: ['fake'] }));
  });
  for (const quality of [...six, undefined]) {
    expected = quality;
    const images = await m.inpaint({ imageDataUrl: 'data:image/png;base64,ZmFrZQ==', prompt: 'test', quality });
    assert.deepEqual(images, ['fake']);
  }
});
