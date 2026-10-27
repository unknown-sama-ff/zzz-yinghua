import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';

const { buildZeroFateDraftPrompt, buildZeroFateRenderPrompt, isCurrentZeroFateDraft, useYinghuaStore,
  replaceInpaintTarget, resolveInpaintTarget } = await loadFrontend(`
  export { buildZeroFateDraftPrompt, buildZeroFateRenderPrompt } from './src/lib/prompts';
  export * from './src/lib/zeroFate';
  export { useYinghuaStore } from './src/store/useYinghuaStore';
  export { replaceInpaintTarget, resolveInpaintTarget } from './src/lib/inpaintTarget';
`);
const options = { name: 'QA HERO', showText: true, characterDynamic: '侧躺', microDynamic: '半睁眼', characterTraits: '沉着', lang: 'zh' };
const image = (name) => 'data:image/png;base64,' + name;
const context = { sourceImage: image('character'), addonImage: null, prompt: '动作要求' };
function reset() {
  useYinghuaStore.setState({ activeGeneration: null, zeroFateMode: 'two-stage',
    zeroFateDraft: { status: 'done', images: [image('draft')], context },
    yinghuaSlots: { 1: { status: 'idle', images: [] }, 2: { status: 'idle', images: [] }, 3: { status: 'idle', images: [] } },
  });
}

for (const lang of ['zh', 'en']) {
  test(`action draft/${lang} retains camera and action while separating text and silhouette rendering`, () => {
    const prompt = buildZeroFateDraftPrompt({ ...options, lang });
    assert.match(prompt, /侧躺/);
    assert.match(prompt, /半睁眼/);
    assert.match(prompt, lang === 'zh' ? /大仰视、大俯视、极端斜侧/ : /dramatic low-angle, high-angle, and extreme diagonal/);
    assert.match(prompt, lang === 'zh' ? /正常中间调和清晰轮廓/ : /natural midtones and clear contours/);
    assert.match(prompt, lang === 'zh' ? /【文字关闭】/ : /\[TYPOGRAPHY OFF\]/);
    assert.doesNotMatch(prompt, /QA|HERO|\{[A-Z_]+\}|【角色明暗与配色】|\[CHARACTER VALUES\/COLORS\]|【文字】|\[TYPOGRAPHY\]/);
    assert.doesNotMatch(prompt, /卸防感|毫无戒备|慵懒|defenseless|unguarded|languid/i);
    assert.match(prompt, lang === 'zh' ? /衣装完整/ : /complete original costume/);
    assert.match(prompt, lang === 'zh' ? /只有两条腿/ : /exactly two legs/);
    assert.match(prompt, lang === 'zh' ? /每个膝盖只接一条小腿/ : /Each knee connects to only one calf/);
  });
  test(`zero conversion/${lang} freezes the draft instead of choosing the pose again`, () => {
    const prompt = buildZeroFateRenderPrompt({ ...options, lang });
    assert.match(prompt, lang === 'zh' ? /动作底稿.*关节连接与前后遮挡/ : /action draft.*joint connections and front\/back occlusion/);
    assert.match(prompt, lang === 'zh' ? /只改变明暗配色、背景及指定文字/ : /Only change value\/color treatment, background and requested typography/);
    assert.match(prompt, /QA/);
    assert.match(prompt, /HERO/);
    assert.match(prompt, lang === 'zh' ? /不在大腿或膝盖处分叉出额外小腿/ : /Never branch an additional calf/);
    assert.doesNotMatch(prompt, /大仰视、大俯视|prioritize dramatic low-angle|侧躺|第1张主图.*原衣装唯一权威|\{[A-Z_]+\}/);
    const noText = buildZeroFateRenderPrompt({ ...options, lang, showText: false });
    assert.doesNotMatch(noText, /QA|HERO|【文字】|\[TYPOGRAPHY\]/);
  });
}

test('an old draft cannot continue after changing character, prop, or action instructions', () => {
  const draft = { status: 'done', images: [image('draft')], context };
  assert.equal(isCurrentZeroFateDraft(draft, context), true);
  for (const changed of [{ sourceImage: image('other') }, { addonImage: image('prop') }, { prompt: '另一个动作' }]) {
    assert.equal(isCurrentZeroFateDraft(draft, { ...context, ...changed }), false);
  }
  assert.equal(isCurrentZeroFateDraft({ ...draft, images: [] }, context), false);
  assert.equal(isCurrentZeroFateDraft({ ...draft, status: 'error' }, context), true, 'a failed retry still permits using the last matching draft');
});

test('draft generation never populates zero-fate, and the shared lock prevents simultaneous stages', () => {
  reset();
  const store = useYinghuaStore.getState();
  const first = store.beginYinghuaGeneration(1, 'draft');
  assert.ok(first);
  assert.equal(useYinghuaStore.getState().zeroFateDraft.status, 'loading');
  assert.deepEqual(useYinghuaStore.getState().yinghuaSlots[1], { status: 'idle', images: [] });
  assert.equal(store.beginYinghuaGeneration(1, 'render'), null);
  assert.equal(store.beginYinghuaGeneration(2), null);
  store.endYinghuaGeneration('unrelated-attempt');
  assert.equal(useYinghuaStore.getState().activeGeneration.idempotencyKey, first.idempotencyKey);
  store.endYinghuaGeneration(first.idempotencyKey);
  const second = store.beginYinghuaGeneration(1, 'render');
  assert.ok(second);
  assert.notEqual(second.idempotencyKey, first.idempotencyKey);
  assert.equal(useYinghuaStore.getState().yinghuaSlots[1].status, 'loading');
  assert.deepEqual(useYinghuaStore.getState().zeroFateDraft.images, [image('draft')]);
});

test('editing the action draft preserves finished tiers and rejects stale or in-flight replacements', async () => {
  reset();
  useYinghuaStore.getState().setYinghuaSlot(1, { status: 'done', images: [image('zero')] });
  const target = { type: 'yinghua-draft', index: 0, url: image('draft') };
  const resolved = resolveInpaintTarget(target.url, 'yinghua', { type: 'yinghua-draft', index: 0 });
  assert.equal(resolved.type, 'yinghua-draft');
  assert.equal(await replaceInpaintTarget(target, image('edited')), true);
  assert.deepEqual(useYinghuaStore.getState().zeroFateDraft.images, [image('edited')]);
  assert.deepEqual(useYinghuaStore.getState().yinghuaSlots[1].images, [image('zero')]);
  assert.equal(await replaceInpaintTarget(target, image('stale')), false);
  useYinghuaStore.getState().beginYinghuaGeneration(1, 'render');
  assert.equal(await replaceInpaintTarget({ ...target, url: image('edited') }, image('in-flight')), false);
});

test('a completed new zero-fate clears dependent tiers but preserves its reusable draft', () => {
  reset();
  const store = useYinghuaStore.getState();
  store.setYinghuaSlot(2, { status: 'done', images: [image('old-three')] });
  store.setYinghuaSlot(3, { status: 'done', images: [image('old-six')] });
  store.completeZeroFate([image('new-zero')]);
  const state = useYinghuaStore.getState();
  assert.deepEqual(state.yinghuaSlots[1], { status: 'done', images: [image('new-zero')] });
  assert.deepEqual(state.yinghuaSlots[2], { status: 'idle', images: [] });
  assert.deepEqual(state.yinghuaSlots[3], { status: 'idle', images: [] });
  assert.deepEqual(state.zeroFateDraft.images, [image('draft')]);
});
