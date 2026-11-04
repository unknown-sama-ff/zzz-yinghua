import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';

const m = await loadFrontend([
  "export * from './src/lib/denoise';",
  "export { useProviderStore } from './src/store/useProviderStore';",
  "export { useFreeCreateStore } from './src/store/useFreeCreateStore';",
  "export { useBuildRequest } from './src/components/useBuildRequest';",
  "export { DenoiseToggle } from './src/components/DenoiseToggle';",
  "export { buildFreeCreateRequest, buildFreeCreateBatchRequests } from './src/lib/freeCreate';",
  "export { generate, inpaint } from './src/lib/apiClient';",
  "export { createElement } from 'react';",
  "export { renderToString } from 'react-dom/server';",
].join('\n'));
const settings = m.useProviderStore;
const free = m.useFreeCreateStore;
const image = { id: 'reference', name: 'reference.png', dataUrl: 'data:image/png;base64,aW1hZ2U=' };
const input = { prompt: 'keep my requested style', contextImageUrl: null, references: [image], credentials: { apiKey: 'test', baseUrl: 'https://example.invalid/v1', model: 'gpt-image-2' }, useServerPreset: false, imageCount: 1, aspectRatio: '4:3' };
const countDenoise = (prompt) => prompt.split(m.DENOISE_PROMPT).length - 1;
function mockFetch(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => { globalThis.fetch = original; });
}
function success() { return new Response(JSON.stringify({ ok: true, images: ['result'] })); }
function render(element) {
  const initial = settings.getInitialState();
  const saved = { ...initial };
  Object.assign(initial, settings.getState());
  try { return m.renderToString(element); }
  finally { Object.assign(initial, saved); }
}

test('denoise is opt-in, preserves requested content, and appends its constraint once', () => {
  assert.equal(settings.getInitialState().denoiseEnabled, false);
  const request = { provider: 'gpt-image', prompt: 'original instruction', quality: 'high', size: '2048x1024', inputImageMaxDimension: 2048 };
  assert.deepEqual(m.withDenoise(request, false), { ...request, denoiseEnabled: false });
  const enabled = m.withDenoise(request, true);
  assert.equal(enabled.prompt, request.prompt + '\n\n' + m.DENOISE_PROMPT);
  assert.equal(countDenoise(m.withDenoise(enabled, true).prompt), 1);
  assert.equal(enabled.inputImageMaxDimension, 2048);
  assert.equal(enabled.size, request.size);
  assert.equal(enabled.quality, request.quality);
  assert.equal(request.prompt, 'original instruction');
  assert.match(m.DENOISE_PROMPT, /不以磨皮、模糊、过度锐化/);
  assert.match(m.DENOISE_PROMPT, /局部编辑时仅在允许编辑的范围内处理/);
});

test('the shared builder applies denoise to every provider without changing output size', () => {
  settings.getState().setDenoiseEnabled(true);
  for (const provider of ['gpt-image', 'seedream', 'custom-url']) {
    settings.getState().setProvider(provider);
    let request;
    function Probe() {
      request = m.useBuildRequest()('test', { size: '1536x1024' });
      return null;
    }
    render(m.createElement(Probe));
    assert.equal(countDenoise(request.prompt), 1);
    assert.equal(request.denoiseEnabled, true);
    assert.equal(request.size, '1536x1024');
    assert.equal(request.preserveInputQuality, provider === 'gpt-image' ? true : undefined);
    assert.equal(request.inputImageMaxDimension, provider === 'gpt-image' ? 1536 : undefined);
  }
});

test('transport covers direct generation calls and respects a captured disabled choice', async (t) => {
  const bodies = [];
  mockFetch(t, async (_url, init) => { bodies.push(JSON.parse(init.body)); return success(); });
  settings.getState().setDenoiseEnabled(true);
  for (const provider of ['gpt-image', 'seedream', 'custom-url']) {
    await m.generate({ provider, prompt: 'literal caller' });
    assert.equal(countDenoise(bodies.at(-1).prompt), 1);
  }
  await m.generate({ provider: 'gpt-image', prompt: 'captured before enabling', denoiseEnabled: false });
  assert.equal(bodies.at(-1).prompt, 'captured before enabling');
  assert.equal(bodies.at(-1).preserveInputQuality, undefined);
});

test('free creation repeats keep their captured denoise choice after the setting changes', async (t) => {
  const bodies = [];
  mockFetch(t, async (_url, init) => { bodies.push(JSON.parse(init.body)); return success(); });
  for (const enabled of [false, true]) {
    free.getState().newConversation();
    const sessionId = free.getState().activeSessionId;
    const request = m.buildFreeCreateRequest({ ...input, denoiseEnabled: enabled });
    const first = free.getState().enqueueGeneration({ prompt: input.prompt, references: [image], request });
    free.getState().completeGeneration(free.getState().claimNextGeneration().generation, ['original']);
    settings.getState().setDenoiseEnabled(!enabled);
    free.getState().repeatGeneration(sessionId, first.userMessageId);
    const claimed = free.getState().claimNextGeneration();
    await m.generate(claimed.request);
    assert.equal(bodies.at(-1).denoiseEnabled, enabled);
    assert.equal(countDenoise(bodies.at(-1).prompt), enabled ? 1 : 0);
    const session = free.getState().sessions.find((item) => item.id === sessionId);
    assert.equal(session.messages[0].prompt, input.prompt);
    free.getState().completeGeneration(claimed.generation, ['repeated']);
  }
});

test('both free creation batch modes include denoise once in every item request', () => {
  for (const mode of ['fixed-character', 'fixed-scene']) {
    const items = m.buildFreeCreateBatchRequests({ ...input, mode, denoiseEnabled: true, sharedReference: image, targets: [image, { ...image, id: 'second' }] });
    for (const { request } of items) {
      assert.equal(countDenoise(request.prompt), 1);
      assert.equal(request.n, 1);
      assert.equal(request.preserveInputQuality, true);
    }
  }
});

test('inpaint includes denoise and lossless input options while preserving its mask and mode', async (t) => {
  const forms = [];
  mockFetch(t, async (_url, init) => { forms.push(init.body); return success(); });
  settings.getState().setDenoiseEnabled(true);
  await m.inpaint({ imageDataUrl: image.dataUrl, maskDataUrl: image.dataUrl, prompt: 'local edit only', editMode: 'precise' });
  assert.equal(countDenoise(forms[0].get('prompt')), 1);
  assert.equal(forms[0].get('preserveInputQuality'), 'true');
  assert.equal(forms[0].get('inputImageMaxDimension'), '1536');
  assert.equal(forms[0].get('editMode'), 'precise');
  assert.ok(forms[0].get('mask'));
  await m.inpaint({ imageDataUrl: image.dataUrl, prompt: 'original prompt', denoiseEnabled: false });
  assert.equal(forms[1].get('prompt'), 'original prompt');
  assert.equal(forms[1].get('preserveInputQuality'), null);
});

test('settings and free creation controls display the shared denoise state', () => {
  for (const enabled of [false, true]) {
    settings.getState().setDenoiseEnabled(enabled);
    for (const id of ['generation-denoise', 'free-create-denoise']) {
      const html = render(m.createElement(m.DenoiseToggle, { id }));
      assert.equal(/checked=/.test(html), enabled);
      assert.ok(html.includes('aria-describedby="' + id + '-help"'));
    }
  }
});
