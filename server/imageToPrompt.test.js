import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import express from 'express';
import multer from 'multer';
import { createImageToPromptHandler, IMAGE_TO_PROMPT_SYSTEM, parseImagePromptResult } from './imageToPrompt.js';
import { UpstreamError } from './http.js';

const result = { summary: '左侧柔光和低饱和背景', promptZh: '一只猫坐在画面右下方，左侧窗光照亮毛发。', promptEn: 'A cat in the lower right, lit by soft window light from the left.', negativePrompt: '', editablePrompt: '一只【橘猫】坐在右下方，保持左侧窗光。', tips: '保持原图比例；具体镜头未知。' };
const png = await sharp({ create: { width: 20, height: 10, channels: 4, background: '#e6cfff' } }).png().toBuffer();
function fixture(dependencies = {}) {
  const state = { calls: [], budget: 0, urls: [] };
  const handler = createImageToPromptHandler({
    request: async (url, options) => { state.calls.push({ url, options }); return Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] }); },
    validateUrl: async (url) => { state.urls.push(url); }, consumeBudget: () => { state.budget++; return true; }, ...dependencies,
  });
  async function invoke(body = {}, file = { buffer: png, mimetype: 'image/png' }) {
    let status = 200, response;
    await handler({ body: { apiKey: 'test-user-key', baseUrl: 'https://vision.example/v1', model: 'vision-test', ...body }, file }, { status(value) { status = value; return this; }, json(value) { response = value; return this; } });
    return { status, body: response };
  }
  return { state, handler, invoke };
}

test('vision request uses normalized image, explicit spatial rules and separate copy-ready outputs', async () => {
  const { invoke, state } = fixture();
  const response = await invoke({ target: 'midjourney', focus: '保留窗光' });
  assert.equal(response.status, 200); assert.deepEqual(response.body.result, result);
  assert.equal(response.body.image.aspectRatio, '2:1');
  assert.equal(state.calls[0].url, 'https://vision.example/v1/chat/completions');
  const body = JSON.parse(state.calls[0].options.body);
  assert.equal(body.model, 'vision-test'); assert.equal(state.calls[0].options.headers.Authorization, 'Bearer test-user-key');
  assert.equal(body.messages[0].content, IMAGE_TO_PROMPT_SYSTEM);
  assert.match(body.messages[0].content, /untrusted visual data/);
  assert.match(body.messages[1].content[0].text, /--ar ratio/);
  assert.match(body.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(state.budget, 0);
});

test('invalid files, settings and target reject before any provider request', async () => {
  for (const [body, file] of [
    [{}, null], [{}, { buffer: Buffer.from('not an image'), mimetype: 'image/png' }],
    [{}, { buffer: png, mimetype: 'image/svg+xml' }], [{ target: '__proto__' }, undefined],
    [{ focus: 'x'.repeat(501) }, undefined], [{ baseUrl: 'https://user:pass@vision.example/v1' }, undefined],
    [{ baseUrl: 'https://vision.example/v1?secret=oops' }, undefined],
  ]) {
    const { invoke, state } = fixture(); const response = await invoke(body, file);
    assert.equal(response.status, 400); assert.equal(state.calls.length, 0); assert.equal(state.budget, 0);
  }
  const { invoke, state } = fixture();
  assert.equal((await invoke({ apiKey: '' })).status, 401); assert.equal(state.calls.length, 0);
});

test('SSRF failures and provider body timeouts preserve normalized errors without exposing credentials', async () => {
  const blocked = fixture({ validateUrl: async () => { throw new UpstreamError('SSRF_BLOCKED', 'blocked', 400); } });
  assert.equal((await blocked.invoke({ baseUrl: 'http://127.0.0.1' })).body.code, 'SSRF_BLOCKED'); assert.equal(blocked.state.calls.length, 0);
  const timeout = fixture({ request: async () => { throw new UpstreamError('UPSTREAM_TIMEOUT', 'timed out', 504); } });
  assert.equal((await timeout.invoke()).status, 504);
  const failed = fixture({ request: async () => new Response('test-user-key or internal diagnostics', { status: 401 }) });
  const response = await failed.invoke(); assert.equal(response.status, 401); assert.doesNotMatch(JSON.stringify(response.body), /test-user-key|internal diagnostics/);
});

test('preset vision credentials are selected explicitly and charged once after image validation', async (t) => {
  const saved = Object.fromEntries(['VISION_API_KEY', 'VISION_BASE_URL', 'VISION_MODEL'].map((key) => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  process.env.VISION_API_KEY = 'preset-key'; process.env.VISION_BASE_URL = 'https://preset.example/v1'; process.env.VISION_MODEL = 'preset-vision';
  const { invoke, state } = fixture(); await invoke({ useServerPreset: 'true' });
  assert.equal(state.budget, 1); assert.equal(state.calls[0].url, 'https://preset.example/v1/chat/completions');
  assert.equal(state.calls[0].options.headers.Authorization, 'Bearer preset-key');
  const denied = fixture({ consumeBudget: () => false });
  assert.equal((await denied.invoke({ useServerPreset: true })).status, 429); assert.equal(denied.state.calls.length, 0);
});

test('parser accepts fenced JSON or text parts and rejects incomplete, arbitrary and oversized output', () => {
  assert.deepEqual(parseImagePromptResult('```json\n' + JSON.stringify(result) + '\n```'), result);
  assert.deepEqual(parseImagePromptResult([{ type: 'text', text: JSON.stringify(result) }]), result);
  for (const content of ['not json', '{}', 'null', JSON.stringify({ ...result, promptZh: '' }), 'x'.repeat(60_001)]) assert.throws(() => parseImagePromptResult(content), UpstreamError);
});

test('upstream byte limit includes extra JSON fields and cancels streamed overflow before parsing', async () => {
  let cancelled = false;
  const oversized = new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }], padding: 'x'.repeat(600_000) }));
  const { invoke } = fixture({ request: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(oversized); }, cancel() { cancelled = true; },
  })) });
  const response = await invoke(); assert.equal(response.status, 502); assert.match(response.body.message, /内容过大/); assert.equal(cancelled, true);
  const advertised = fixture({ request: async () => new Response('{}', { headers: { 'content-length': '600000' } }) });
  assert.equal((await advertised.invoke()).status, 502);
});

test('multipart image route accepts a real file upload and does not require any generation call', async (t) => {
  const app = express(), { handler, state } = fixture();
  app.post('/api/image-to-prompt', multer({ storage: multer.memoryStorage() }).single('image'), handler);
  const server = app.listen(0, '127.0.0.1'); t.after(() => { server.close(); server.closeAllConnections(); });
  await new Promise((resolve) => server.once('listening', resolve));
  const form = new FormData(); form.append('image', new Blob([png], { type: 'image/png' }), 'reference.png');
  for (const [key, value] of Object.entries({ apiKey: 'test-user-key', baseUrl: 'https://vision.example/v1', model: 'vision-test', target: 'general' })) form.append(key, value);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/image-to-prompt`, { method: 'POST', body: form });
  assert.equal(response.status, 200); assert.equal((await response.json()).result.promptZh, result.promptZh); assert.equal(state.calls.length, 1);
});
