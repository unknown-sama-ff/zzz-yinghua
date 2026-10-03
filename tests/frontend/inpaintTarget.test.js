import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';

const m = await loadFrontend(`
  export * from './src/lib/inpaintTarget';
  export { useYinghuaStore } from './src/store/useYinghuaStore';
  export { useInpaintStore } from './src/store/useInpaintStore';
  export { useViewerStore } from './src/store/useViewerStore';
  export * from './src/lib/yinghuaLayers';
  export * from './src/lib/yinghuaFace';
`);
const { useYinghuaStore, useInpaintStore, useViewerStore, replaceInpaintTarget, resolveInpaintTarget, resolveInpaintElementTarget, canReplaceInpaintTarget, buildYinghuaLayers } = m;
const image = (name) => 'data:image/png;base64,' + name;
function reset() {
  useYinghuaStore.setState({
    activeGeneration: null,
    yinghuaSlots: {
      1: {status: 'done', images: [image('zero')]},
      2: {status: 'done', images: [image('three')]},
      3: {status: 'done', images: [image('yang'), image('yin')]},
    },
  });
  useInpaintStore.getState().reset();
  useViewerStore.getState().setAllParts(false);
}

for (const [slotId, index] of [[1, 0], [2, 0], [3, 0], [3, 1]]) {
  test(`replace exact 04 slot ${slotId}/${index}, preserve every other image and viewer selection`, async () => {
    reset();
    useViewerStore.getState().togglePart('04');
    useViewerStore.getState().togglePart('02');
    const parts = useViewerStore.getState().parts;
    const before = useYinghuaStore.getState().yinghuaSlots;
    const target = { type: 'yinghua', slotId, index, url: before[slotId].images[index] };
    useInpaintStore.getState().openWorkspace(target);
    const edit = useInpaintStore.getState().appendVersion(image('edited'), '只修正腿部');
    assert.ok(edit);
    const fetchBefore = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('replacement must not generate, charge or use the network'); };
    try {
      assert.equal(await replaceInpaintTarget(target, edit.url), true);
    } finally { globalThis.fetch = fetchBefore; }
    for (const id of [1, 2, 3]) {
      before[id].images.forEach((src, i) => {
        assert.equal(useYinghuaStore.getState().yinghuaSlots[id].images[i], id === slotId && i === index ? edit.url : src);
      });
    }
    assert.equal(useViewerStore.getState().parts, parts);
    const view = buildYinghuaLayers(useYinghuaStore.getState().yinghuaSlots, parts, null, index === 1 ? 'back' : 'front');
    if (slotId === 1 || slotId === 3) assert.ok(view.some((layer) => layer.src === edit.url));
    assert.equal(useInpaintStore.getState().versions.length, 2);
  });
}

test('reject a stale source and preserve a newer module result', async () => {
  reset();
  const target = { type: 'yinghua', slotId: 3, index: 0, url: image('yang') };
  useYinghuaStore.getState().setYinghuaSlot(3, {images: [image('newer'), image('yin')]});
  assert.equal(await replaceInpaintTarget(target, image('old-edit')), false);
  assert.equal(useYinghuaStore.getState().yinghuaSlots[3].images[0], image('newer'));
});

test('reject replacement while its generation is in flight', async () => {
  reset();
  const target = { type: 'yinghua', slotId: 3, index: 0, url: image('yang') };
  const generation = useYinghuaStore.getState().beginYinghuaGeneration(3);
  assert.equal(await replaceInpaintTarget(target, image('edit')), false);
  assert.equal(useYinghuaStore.getState().yinghuaSlots[3].images[0], image('yang'));
  useYinghuaStore.getState().endYinghuaGeneration(generation.idempotencyKey);
});

test('explicit face metadata disambiguates equal URLs and stale metadata never redirects ownership', async () => {
  reset();
  useYinghuaStore.getState().setYinghuaSlot(3, {images: [image('same'), image('same')]});
  const target = resolveInpaintTarget(image('same'), 'yinghua', {type: 'yinghua', slotId: 3, index: 1});
  assert.equal(target.index, 1);
  assert.equal(await replaceInpaintTarget(target, image('edit-yin')), true);
  assert.deepEqual(useYinghuaStore.getState().yinghuaSlots[3].images, [image('same'), image('edit-yin')]);
  assert.equal(resolveInpaintTarget(image('same'), 'yinghua', {type: 'yinghua', slotId: 3, index: 1}).type, 'preview');
});

test('a missing Yin face falls back to Yang and the displayed index is the editable owner', () => {
  reset();
  useYinghuaStore.getState().setYinghuaSlot(3, {images: [image('yang')]});
  const shown = m.resolveYinghuaFaceImage([image('yang')], 'back');
  const fakeImage = {
    src: shown.src,
    closest: () => ({getAttribute: () => 'yinghua'}),
    getAttribute: (name) => ({'data-inpaint-type': 'yinghua', 'data-inpaint-slot-id': '3', 'data-inpaint-index': String(shown.index)}[name] ?? null),
  };
  assert.equal(resolveInpaintElementTarget(fakeImage).index, 0);
});

test('invalid target metadata and preview-only images cannot write module images', async () => {
  reset();
  for (const target of [
    {type: 'preview', url: image('yang')},
    {type: 'yinghua', slotId: 3, index: 2, url: image('yang')},
    {type: 'yinghua', slotId: 7, index: 0, url: image('yang')},
    {type: 'yinghua', slotId: 3, index: -1, url: image('yang')},
    {type: 'yinghua', slotId: 3, url: image('yang')},
  ]) {
    assert.equal(canReplaceInpaintTarget(target), false);
    assert.equal(await replaceInpaintTarget(target, image('edit')), false);
  }
});

test('successive edits and reverting to the original preserve all editing versions', async () => {
  reset();
  const target = {type: 'yinghua', slotId: 3, index: 1, url: image('yin')};
  useInpaintStore.getState().openWorkspace(target);
  const root = useInpaintStore.getState().currentVersionId;
  const first = useInpaintStore.getState().appendVersion(image('v1'), '修正');
  assert.equal(await replaceInpaintTarget(target, first.url), true);
  const updatedTarget = {...target, url: first.url};
  useInpaintStore.getState().setTargetImage(updatedTarget);
  const second = useInpaintStore.getState().appendVersion(image('v2'), '优化');
  assert.equal(await replaceInpaintTarget(updatedTarget, second.url), true);
  useInpaintStore.getState().selectVersion(root);
  assert.equal(await replaceInpaintTarget({...target, url: second.url}, image('yin')), true);
  assert.equal(useInpaintStore.getState().versions.length, 3);
  assert.deepEqual(useYinghuaStore.getState().yinghuaSlots[3].images, [image('yang'), image('yin')]);
});

test('an unmarked 04 addon preview cannot claim ownership of a generated image with the same URL', () => {
  reset();
  const fakeImage = {src: image('yang'), closest: () => ({getAttribute: () => 'yinghua'}), getAttribute: () => null};
  assert.equal(resolveInpaintElementTarget(fakeImage).type, 'preview');
});
