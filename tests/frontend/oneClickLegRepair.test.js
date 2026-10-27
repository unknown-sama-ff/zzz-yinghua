import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';

const { startOneClickLegRepair, ONE_CLICK_LEG_REPAIR_INSTRUCTION, submitImageEdit,
  useInpaintStore, useYinghuaStore, useProviderStore, replaceInpaintTarget } = await loadFrontend(`
  export * from './src/lib/oneClickLegRepair';
  export * from './src/lib/submitImageEdit';
  export { useInpaintStore } from './src/store/useInpaintStore';
  export { useYinghuaStore } from './src/store/useYinghuaStore';
  export { useProviderStore } from './src/store/useProviderStore';
  export { replaceInpaintTarget } from './src/lib/inpaintTarget';
`);
const image = (name) => 'data:image/png;base64,' + Buffer.from(name).toString('base64');
const source = image('original');
const edited = image('repaired');
const draftTarget = { type: 'yinghua-draft', index: 0, url: source };
function reset() {
  useInpaintStore.getState().reset();
  useYinghuaStore.setState({ activeGeneration: null, zeroFateDraft: { status: 'done', images: [source], context: null },
    yinghuaSlots: { 1: { status: 'done', images: [source] }, 2: { status: 'done', images: [image('three')] }, 3: { status: 'idle', images: [] } } });
  useProviderStore.setState({ freeloadEnabled: false, gptImageQuality: 'high' });
  useProviderStore.getState().setCred('gpt-image', { apiKey: 'local-test-key', baseUrl: 'https://example.invalid/v1', model: 'gpt-image-2.5-sunburst' });
}
function success(url) { return new Response(JSON.stringify({ ok: true, images: [url] }), { status: 200 }); }

test('one click submits once, prioritizes complete upper chains and requires explicit replacement', async () => {
  reset();
  const originalFetch = globalThis.fetch;
  const requests = [];
  let complete;
  globalThis.fetch = async (_url, init) => { requests.push(init.body); return new Promise((resolve) => { complete = resolve; }); };
  try {
    const pending = startOneClickLegRepair(draftTarget);
    assert.equal(requests.length, 1);
    assert.equal(useInpaintStore.getState().isWorkspaceOpen, true);
    assert.equal(useInpaintStore.getState().isGenerating, true);
    const originalRoot = useInpaintStore.getState().versions[0].id;
    assert.deepEqual(await startOneClickLegRepair(draftTarget), { status: 'busy' });
    assert.equal(requests.length, 1);
    assert.equal(useInpaintStore.getState().versions[0].id, originalRoot);
    assert.match(requests[0].get('prompt'), /优先保留结构完整的两条连接/);
    assert.match(requests[0].get('prompt'), /完整程度相近时，优先保留处于画面上方/);
    assert.equal(requests[0].get('quality'), 'high');
    assert.equal(requests[0].get('model'), 'gpt-image-2.5-sunburst');
    assert.equal(requests[0].get('editMode'), 'smart');
    complete(success(edited));
    assert.deepEqual(await pending, { status: 'complete', imageUrl: edited });
    const state = useInpaintStore.getState();
    assert.equal(state.versions.length, 2);
    assert.equal(state.versions[1].parentId, originalRoot);
    assert.equal(state.currentVersionUrl, edited);
    assert.equal(state.isGenerating, false);
    assert.equal(useYinghuaStore.getState().zeroFateDraft.images[0], source, 'preview must not replace the original automatically');
    assert.equal(await replaceInpaintTarget(draftTarget, edited), true);
    assert.equal(useYinghuaStore.getState().zeroFateDraft.images[0], edited);
    assert.equal(requests.length, 1, 'applying the preview is a local action');
  } finally { globalThis.fetch = originalFetch; }
});

test('an old repair cannot append into or unlock a newer editing session', async () => {
  reset();
  const originalFetch = globalThis.fetch;
  const complete = [];
  globalThis.fetch = async () => new Promise((resolve) => complete.push(resolve));
  try {
    const first = startOneClickLegRepair(draftTarget);
    useInpaintStore.getState().closeWorkspace();
    useInpaintStore.getState().openWorkspace({ type: 'yinghua', slotId: 2, index: 0, url: image('three') });
    const secondRoot = useInpaintStore.getState().versions[0].id;
    const second = submitImageEdit({ instruction: '只调整发夹颜色', editMode: 'smart' });
    complete[0](success(image('stale-repair')));
    assert.deepEqual(await first, { status: 'stale' });
    assert.equal(useInpaintStore.getState().isGenerating, true);
    assert.equal(useInpaintStore.getState().versions.length, 1);
    assert.equal(useInpaintStore.getState().versions[0].id, secondRoot);
    complete[1](success(image('newer-edit')));
    assert.equal((await second).status, 'complete');
    assert.equal(useInpaintStore.getState().versions[1].parentId, secondRoot);
    assert.equal(useInpaintStore.getState().currentVersionUrl, image('newer-edit'));
    assert.equal(useInpaintStore.getState().isGenerating, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('a rejected repair preserves the original, preset and provider evidence without retrying', async () => {
  reset();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const upstreamError = { source: 'upstream', message: 'request rejected', httpStatus: 400, category: 'sexual', requestId: 'req-repair-fixture', redacted: false, truncated: false };
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ ok: false, code: 'CONTENT_REJECTED', message: '上游返回内容审核拒绝', upstreamError }), { status: 400 }); };
  try {
    await assert.rejects(startOneClickLegRepair(draftTarget), { code: 'CONTENT_REJECTED' });
    const state = useInpaintStore.getState();
    assert.equal(calls, 1);
    assert.equal(state.currentVersionUrl, source);
    assert.equal(state.versions.length, 1);
    assert.equal(state.prompt, ONE_CLICK_LEG_REPAIR_INSTRUCTION);
    assert.deepEqual(state.generationError.upstreamError, upstreamError);
    assert.equal(state.isGenerating, false);
    assert.equal(useYinghuaStore.getState().zeroFateDraft.images[0], source);
  } finally { globalThis.fetch = originalFetch; }
});

test('a stale source is rejected before opening another session or sending an edit', async () => {
  reset();
  useYinghuaStore.getState().setZeroFateDraft({ images: [image('new-original')] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('a stale source must not reach the network'); };
  try {
    await assert.rejects(startOneClickLegRepair(draftTarget), /原图已更新/);
    assert.equal(useInpaintStore.getState().isWorkspaceOpen, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('the shared submit path still requires the current precise-edit mask', async () => {
  reset();
  useInpaintStore.getState().openWorkspace(draftTarget);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('a missing mask must not reach the network'); };
  try {
    await assert.rejects(submitImageEdit({ instruction: '只修复选区', editMode: 'precise' }), /涂抹/);
    assert.equal(useInpaintStore.getState().isGenerating, false);
    assert.equal(useInpaintStore.getState().currentVersionUrl, source);
  } finally { globalThis.fetch = originalFetch; }
});
