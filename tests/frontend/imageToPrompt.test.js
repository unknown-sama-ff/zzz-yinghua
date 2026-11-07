import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';
const { formatImagePrompt, reverseImagePrompt } = await loadFrontend("export * from './src/lib/imageToPrompt';");
const result = { summary: 'test', promptZh: '中文构图', promptEn: 'English composition', negativePrompt: '', editablePrompt: '【可替换主体】', tips: '2:1' };

test('copy-all includes complete prompt versions and omits empty negative prompts', () => {
  const copied = formatImagePrompt(result);
  for (const text of [result.promptZh, result.promptEn, result.editablePrompt, result.tips]) assert.ok(copied.includes(text));
  assert.match(copied, /可复用模板/);
  assert.ok(!copied.includes('Negative Prompt'));
});

test('reverse client sends multipart settings, preserves service errors and respects caller cancellation', async (t) => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const file = new Blob(['pixels'], { type: 'image/png' });
  globalThis.fetch = async (url, init) => {
    assert.match(url, /\/image-to-prompt$/); assert.ok(init.body instanceof FormData);
    assert.equal(init.body.get('useServerPreset'), 'false'); assert.equal(init.body.get('apiKey'), 'user-key');
    return Response.json({ ok: true, result, image: { width: 20, height: 10, aspectRatio: '2:1' } });
  };
  assert.deepEqual((await reverseImagePrompt(file, { target: 'general', focus: '', useServerPreset: false, apiKey: 'user-key' })).result, result);
  globalThis.fetch = async () => Response.json({ ok: false, message: '请配置视觉模型' }, { status: 401 });
  await assert.rejects(reverseImagePrompt(file, { target: 'general', focus: '', useServerPreset: false }), /请配置视觉模型/);
  globalThis.fetch = async (_url, init) => { assert.equal(init.signal.aborted, true); throw new DOMException('aborted', 'AbortError'); };
  const controller = new AbortController(); controller.abort();
  await assert.rejects(reverseImagePrompt(file, { target: 'general', focus: '', useServerPreset: false }, controller.signal), { name: 'AbortError' });
});
