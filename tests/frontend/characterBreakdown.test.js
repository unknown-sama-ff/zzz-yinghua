import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';

const { buildNamedCharacterPrompt, buildCharacterBreakdownPrompt, CHARACTER_BREAKDOWN_PROMPT, withCharacterBreakdownReference, buildYinghuaReferencePrompt, isCurrentCharacterResult,
  originalImagesForSource, canReuseMaterialThreeView, useCharacterSheetStore, useUploadStore, useIdentityStore } = await loadFrontend(`
  export * from './src/lib/characterBreakdown';
  export * from './src/lib/characterOriginals';
  export { canReuseMaterialThreeView } from './src/lib/characterMaterials';
  export { useCharacterSheetStore } from './src/store/useCharacterSheetStore';
  export { useUploadStore } from './src/store/useUploadStore';
  export { useIdentityStore } from './src/store/useIdentityStore';
`);
const image = (url, characterName = '可琳') => ({ url, characterName, prompt: '概念分解', provider: 'gpt-image' });
function reset() {
  useCharacterSheetStore.setState({ sheets: {}, namesBySource: {}, originalsBySource: {} });
  useUploadStore.getState().clearUpload();
  useIdentityStore.getState().setCharacterName('');
}

test('character generation requires an actual name and includes it without treating it as replacement syntax', () => {
  for (const name of ['', '  ', '\n']) assert.throws(() => buildNamedCharacterPrompt('设定', name), /请先填写角色名字/);
  assert.match(buildNamedCharacterPrompt('三视图要求', ' 可琳 / CORIN '), /^【角色身份】角色名字：可琳 \/ CORIN。/);
  assert.ok(buildNamedCharacterPrompt('设定', '$&').includes('角色名字：$&。'));
});

test('the breakdown includes the requested design elements, Chinese annotations and an unambiguous white background', () => {
  const prompt = buildNamedCharacterPrompt(CHARACTER_BREAKDOWN_PROMPT, 'CORIN');
  for (const detail of ['中心', '完整全身立绘', '服装分层', '内着', '表情', '材质特写', '通勤包', '美妆护理', '日记本', '引导线', '中文', '白色背景']) assert.ok(prompt.includes(detail), detail);
  assert.doesNotMatch(prompt, /米黄色|羊皮纸|浅灰色纹理背景|\{CHARACTER_NAME\}/);
});

test('the same character name does not make different three-views share a breakdown', () => {
  reset();
  const store = useCharacterSheetStore.getState();
  store.registerSources(['view-a', 'view-b'], ' 可琳 ');
  store.addImages('view-a', [image('sheet-a')]);
  store.addImages('view-b', [image('sheet-b')]);
  useUploadStore.getState().setUpload('view-a', 'a.png');
  assert.equal(useIdentityStore.getState().characterName, '可琳');
  assert.equal(useCharacterSheetStore.getState().sheets['view-a'].selectedImage, 'sheet-a');
  useUploadStore.getState().setUpload('view-b', 'b.png');
  assert.equal(useCharacterSheetStore.getState().sheets['view-b'].selectedImage, 'sheet-b');
  store.selectImage('view-b', null);
  store.selectImage('view-a', 'sheet-b');
  assert.equal(useCharacterSheetStore.getState().sheets['view-a'].selectedImage, 'sheet-a', 'cannot select another source’s breakdown');
  assert.equal(useCharacterSheetStore.getState().sheets['view-b'].selectedImage, null);
});

test('a late result belongs to its captured source and switching sources restores the correct name', () => {
  reset();
  const store = useCharacterSheetStore.getState();
  store.registerSources(['view-a'], 'ALPHA');
  store.registerSources(['view-b'], 'BETA');
  store.setSlot('view-a', { status: 'loading' });
  useUploadStore.getState().setUpload('view-b', 'b.png');
  store.addImages('view-a', [image('sheet-a', 'ALPHA')]);
  store.setSlot('view-a', { status: 'done', images: ['sheet-a'] });
  assert.equal(useUploadStore.getState().uploadedImage, 'view-b');
  assert.equal(useIdentityStore.getState().characterName, 'BETA');
  assert.equal(useCharacterSheetStore.getState().sheets['view-b'], undefined);
  useUploadStore.getState().setUpload('view-a', 'a.png');
  assert.equal(useIdentityStore.getState().characterName, 'ALPHA');
  assert.equal(useCharacterSheetStore.getState().sheets['view-a'].selectedImage, 'sheet-a');
});

test('manual and generated alternatives retain their metadata and survive a failed retry', () => {
  reset();
  const store = useCharacterSheetStore.getState();
  store.addImages('view', [image('old')]);
  store.addImages('view', [image('new'), image('new')]);
  store.selectImage('view', 'old');
  store.setSlot('view', { status: 'error', error: '上游拒绝' });
  const sheet = useCharacterSheetStore.getState().sheets.view;
  assert.equal(sheet.images.length, 2);
  assert.equal(sheet.selectedImage, 'old');
  assert.equal(sheet.images[0].prompt, '概念分解');
  assert.equal(sheet.slot.error, '上游拒绝');
});

for (const lang of ['zh', 'en']) {
  test(`breakdown reference/${lang} preserves identity and action authority without copying annotations or innerwear`, () => {
    const prompt = withCharacterBreakdownReference('ORIGINAL STAGE PROMPT', lang);
    assert.ok(prompt.endsWith('ORIGINAL STAGE PROMPT'));
    assert.match(prompt, lang === 'zh' ? /底稿\/底图决定动作、镜头与构图/ : /base\/draft own pose, camera and composition/);
    assert.match(prompt, lang === 'zh' ? /不得照搬.*文字注释/ : /Never copy.*annotations/);
    assert.match(prompt, lang === 'zh' ? /拆解图.*服饰款式.*最高依据/ : /selected breakdown sheet is the highest authority for outfit design/);
    assert.match(prompt, lang === 'zh' ? /原始角色参考仍决定身份、五官/ : /Original character references still own identity, face/);
  });
  test(`stage references/${lang} retain names and distinguish grayscale, color restoration and clothing subtraction`, () => {
    for (const stage of ['draft', 'zero-direct', 'zero-render', 'three', 'six-front', 'six-back']) {
      const prompt = buildYinghuaReferencePrompt('BASE', { stage, name: '可琳', lang, hasBreakdown: true });
      assert.match(prompt, /可琳/);
      assert.ok(prompt.endsWith('BASE'));
      assert.match(prompt, lang === 'zh' ? /单图接口/ : /Single-image endpoints/);
      if (stage === 'three') assert.match(prompt, lang === 'zh' ? /只转换灰阶、指定点缀和背景/ : /Change only grayscale, designated accents and background/);
      if (stage === 'six-front') assert.match(prompt, lang === 'zh' ? /仅还原全彩/ : /Restore full color only/);
      if (stage === 'six-back') assert.match(prompt, lang === 'zh' ? /仅在拆解图确定的衣装基础上执行本阶段指定精简/ : /Apply only this stage’s specified subtraction to the sheet’s outfit/);
      if (stage === 'zero-render') assert.match(prompt, lang === 'zh' ? /之后依次为原始角色参考、辅助三视图、拆解图/ : /followed by original references, auxiliary three-view, breakdown/);
    }
    const noSheet = buildYinghuaReferencePrompt('NO TEXT IN IMAGE', { stage: 'draft', name: 'CORIN', lang, hasBreakdown: false });
    assert.match(noSheet, /CORIN/);
    assert.doesNotMatch(noSheet, /角色拆解图参考|CHARACTER BREAKDOWN REFERENCE/);
  });
}

test('later stages reject a different source, breakdown or name while retaining legacy manually supplied results', () => {
  const context = { sourceImage: 'view-a', breakdownImage: 'sheet-a', characterName: 'ALPHA' };
  const slot = { status: 'done', images: ['result'], characterContext: context };
  assert.equal(isCurrentCharacterResult(slot, { ...context }), true);
  for (const change of [{ sourceImage: 'view-b' }, { breakdownImage: 'sheet-b' }, { breakdownImage: null }, { characterName: 'BETA' }]) {
    assert.equal(isCurrentCharacterResult(slot, { ...context, ...change }), false);
  }
  assert.equal(isCurrentCharacterResult({ status: 'done', images: ['manual'] }, context), true);
});

test('derived three-views retain immutable original references and different variants remain independent', () => {
  reset();
  const store = useCharacterSheetStore.getState();
  const originals = ['front-a', 'back-a'];
  store.setOriginals(['view-a1', 'view-a2'], originals);
  store.setOriginals(['view-b'], ['front-b']);
  originals[0] = 'mutated';
  assert.deepEqual(originalImagesForSource('view-a1', useCharacterSheetStore.getState().originalsBySource), ['front-a', 'back-a']);
  assert.deepEqual(originalImagesForSource('view-a2', useCharacterSheetStore.getState().originalsBySource), ['front-a', 'back-a']);
  assert.deepEqual(originalImagesForSource('view-b', useCharacterSheetStore.getState().originalsBySource), ['front-b']);
  assert.deepEqual(originalImagesForSource('manual-view', {}), ['manual-view']);
  const prompt = buildCharacterBreakdownPrompt(CHARACTER_BREAKDOWN_PROMPT, 'ALPHA');
  assert.match(prompt, /原始参考是身份、可见衣装款式、配色与饰品的最高依据/);
  assert.match(prompt, /辅助三视图.*不能覆盖原图/);
});

test('changing original references invalidates completed downstream artwork even with the same three-view and breakdown', () => {
  const context = { sourceImage: 'view-a', originalImages: ['front-a', 'back-a'], breakdownImage: 'sheet-a', characterName: 'ALPHA' };
  const slot = { status: 'done', images: ['result'], characterContext: context };
  assert.equal(isCurrentCharacterResult(slot, { ...context, originalImages: ['front-a', 'back-a'] }), true);
  assert.equal(isCurrentCharacterResult(slot, { ...context, originalImages: ['front-b', 'back-a'] }), false);
});

test('one-click retry reuses a successful three-view only when its original inputs still match', () => {
  const input = { name: 'ALPHA', originals: ['front'], threeViewPrompt: 'views', breakdownTemplate: 'sheet', provider: 'gpt-image', model: 'gpt-image-2' };
  const job = { input, phase: 'breakdown', status: 'error', threeViewImage: 'generated-view' };
  assert.equal(canReuseMaterialThreeView(job, { ...input }), true);
  assert.equal(canReuseMaterialThreeView(job, { ...input, breakdownTemplate: 'better sheet instructions' }), true);
  for (const change of [{ name: 'BETA' }, { originals: ['other'] }, { threeViewPrompt: 'different views' }, { model: 'other-model' }]) {
    assert.equal(canReuseMaterialThreeView(job, { ...input, ...change }), false);
  }
  assert.equal(canReuseMaterialThreeView({ ...job, phase: 'three-view' }, input), false);
  assert.equal(canReuseMaterialThreeView({ ...job, status: 'done' }, input), false);
});
