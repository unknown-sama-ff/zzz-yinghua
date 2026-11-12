import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';
import { maxInputImagesForGptModel, supportsGptImageTransparency as serverTransparency } from '../../server/lib/gptImageCapabilities.js';

const m = await loadFrontend(`export * from './src/lib/meme'; export * from './src/lib/gptImageCapabilities';`);
const reference = (name) => ({ id: name, name, dataUrl: `data:image/png;base64,${btoa(name)}` });
const options = { provider: 'gpt-image', useServerPreset: false, apiKey: 'test', baseUrl: 'https://example.invalid/v1', model: 'gpt-image-2', denoiseEnabled: false, maxInputImages: 16, transparencySupported: true };
const draft = () => ({ ...m.createMemeDraft(), character: reference('character') });

test('9/15-grid generation is one transparent PNG request, not one request per tile', () => {
  for (const count of [9, 15]) {
    const request = m.buildMemeRequest({ ...draft(), count }, options);
    assert.equal(request.n, 1); assert.equal(request.background, 'transparent'); assert.equal(request.output_format, 'png');
    assert.equal(request.size, count === 9 ? '1024x1024' : '1536x1024');
    assert.match(request.prompt, new RegExp(`共${count}格`));
    assert.equal((request.prompt.match(/第\d+格（第/g) ?? []).length, count);
    assert.equal('aspectRatio' in request, false); assert.equal('freeCreate' in request, false);
    assert.equal(request.preserveInputQuality, true);
  }
});

test('reference order, scoped expression reference and literal user captions agree', () => {
  const source = draft(); source.styles = [reference('style1'), reference('style2')]; source.expressions = [reference('meme')];
  source.tiles[4].reference = reference('cell5'); source.tiles[4].caption = '收到 "好的"'; source.tiles[2].caption = '';
  const request = m.buildMemeRequest(source, options);
  assert.equal(atob(request.imageBase64), 'character');
  assert.deepEqual(request.refImages.map((image) => atob(image.base64)), ['style1', 'style2', 'meme', 'cell5']);
  assert.match(request.prompt, /图片5：仅用于第5格/);
  assert.match(request.prompt, /第5格（第2行第2列）[^\n]+参考图片5/);
  assert.ok(request.prompt.includes(JSON.stringify('收到 "好的"')));
  assert.match(request.prompt, /第3格（第1行第3列）[^\n]+不绘制文字/);
});

test('snapshot keeps submitted reference roles, active tiles and captions immutable', () => {
  const source = draft(); source.styles = [reference('original-style')]; source.tiles[0].reference = reference('original-cell');
  const snapshot = m.snapshotMemeDraft(source); source.styles[0].name = 'changed'; source.character.name = 'changed'; source.tiles[0].caption = 'changed'; source.tiles[0].reference.name = 'changed';
  assert.equal(snapshot.tiles.length, 9); assert.equal(snapshot.styles[0].name, 'original-style');
  assert.equal(snapshot.character.name, 'character'); assert.equal(snapshot.tiles[0].caption, '嗨～'); assert.equal(snapshot.tiles[0].reference.name, 'original-cell');
});

test('redo sends only this cell references plus its previous result, never the other cells', () => {
  const source = draft(); source.styles = [reference('style')]; source.expressions = [reference('shared')];
  source.tiles[0].reference = reference('wanted'); source.tiles[1].reference = reference('unrelated');
  const request = m.buildMemeRequest(source, options, { index: 0, previousDataUrl: reference('previous').dataUrl });
  assert.deepEqual(request.refImages.map((image) => atob(image.base64)), ['style', 'shared', 'wanted', 'previous']);
  assert.match(request.prompt, /只生成一张独立表情/); assert.doesNotMatch(request.prompt, /第2格（/); assert.equal(request.n, 1);
});

test('preflight rejects invalid source, limits and unsupported interfaces without switching models', () => {
  assert.throws(() => m.buildMemeRequest(m.createMemeDraft(), options), /角色图/);
  assert.throws(() => m.buildMemeRequest(draft(), { ...options, provider: 'seedream' }), /GPT/);
  assert.throws(() => m.buildMemeRequest(draft(), { ...options, transparencySupported: false }), /不会自动更换模型/);
  assert.throws(() => m.buildMemeRequest(draft(), { ...options, apiKey: '' }), /填写/);
  const source = draft(); source.styles = [reference('style')];
  assert.throws(() => m.buildMemeRequest(source, { ...options, maxInputImages: 1 }), /最多支持1张/);
  source.tiles[0].expression = ''; assert.throws(() => m.buildMemeRequest(source, options), /神态描述/);
  const excess = { ...draft(), count: 15, styles: [reference('s')], tiles: Array.from({ length: 15 }, (_, i) => ({ id: String(i), expression: '笑', caption: '嗨', reference: reference(String(i)) })) };
  assert.throws(() => m.buildMemeRequest(excess, options), /最多16张/);
  const oversized = draft(); oversized.character.dataUrl = 'data:image/png;base64,' + 'A'.repeat(50 * 1024 * 1024);
  assert.throws(() => m.buildMemeRequest(oversized, options), /请求上限/);
});

test('preset credentials stay server-owned and new generations get distinct request identifiers', () => {
  const request = m.buildMemeRequest(draft(), { ...options, useServerPreset: true, quality: 'high', denoiseEnabled: true });
  assert.equal(request.useServerPreset, true); assert.equal('apiKey' in request, false); assert.equal('model' in request, false);
  assert.equal(request.quality, 'high'); assert.equal(request.denoiseEnabled, true); assert.match(request.prompt, /降噪与细节保真/);
  assert.notEqual(request.idempotencyKey, m.buildMemeRequest(draft(), options).idempotencyKey);
});

test('client and server agree on model capabilities, including unknown and unsupported aliases', () => {
  for (const model of ['gpt-image-1', 'gpt-image-1.5', 'gpt-image-1-mini', 'gpt-image-2', 'gpt-image-2-2026-04-21', ' GPT-IMAGE-2.5-SUNBURST ', 'gpt-image-2.5-flare-2026-09-08', 'gpt-image-2.6', 'gpt-image-2.6-flare', 'gpt-image-2.6-sunburst', 'unknown', 'gpt-image-2.60', 'gpt-image-2-custom', '']) {
    assert.equal(m.maxInputImagesForModel('gpt-image', model), maxInputImagesForGptModel(model), model);
    assert.equal(m.supportsGptImageTransparency(model), serverTransparency(model), model);
  }
  assert.equal(m.supportsGptImageTransparency('gpt-image-2.6-flare'), true);
  assert.equal(m.supportsGptImageTransparency('gpt-image-2.6-sunburst'), true);
});
