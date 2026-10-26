import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';

const { ROUTE_HASHES, routeFromHash, themeTextOn, themeHighlight, refreshUploadPalette, useUploadStore, DEFAULT_PALETTE } = await loadFrontend(`
  export * from './src/lib/navigation';
  export * from './src/lib/theme';
  export * from './src/lib/uploadTheme';
  export { useUploadStore } from './src/store/useUploadStore';
  export { DEFAULT_PALETTE } from './src/lib/colorExtract';
`);

test('hash navigation resolves every workspace, old prompt anchors and unknown links', () => {
  for (const [route, hash] of Object.entries(ROUTE_HASHES)) assert.equal(routeFromHash(hash), route);
  for (const hash of ['#prompt-gallery', '#prompt-gallery-search']) assert.equal(routeFromHash(hash), 'prompts');
  for (const hash of ['', '#/', '#unknown', '#/workshop/invalid']) assert.equal(routeFromHash(hash), 'home');
});

function luminance(hex) {
  const [r, g, b] = hex.match(/[a-f\d]{2}/gi).map((p) => parseInt(p, 16) / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(left, right) {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('UI theme keeps text readable for red, teal, pale, dark and default palettes', () => {
  for (const color of ['#b026ff', '#cc2244', '#00c4ba', '#ffeecc', '#111a22', '#777777', '#ffffff', '#000000']) {
    assert.ok(contrast(color, themeTextOn(color)) >= 4.5, `button text on ${color}`);
    assert.ok(contrast('#191d25', themeHighlight(color)) >= 4.5, `highlight on ${color}`);
  }
});

test('palette extraction cannot overwrite a newer upload or a cleared character', async () => {
  const store = useUploadStore.getState();
  store.clearUpload();
  store.setUpload('old', 'old.png');
  let release;
  const stale = refreshUploadPalette('old', () => new Promise((resolve) => { release = resolve; }));
  store.setUpload('new', 'new.png');
  const palette = { ...DEFAULT_PALETTE, dominant: '#00c4ba' };
  assert.equal(await refreshUploadPalette('new', async () => palette), true);
  release({ ...DEFAULT_PALETTE, dominant: '#cc2244' });
  assert.equal(await stale, false);
  assert.equal(useUploadStore.getState().palette, palette);

  const pending = refreshUploadPalette('new', () => new Promise((resolve) => { release = resolve; }));
  store.clearUpload();
  release(palette);
  assert.equal(await pending, false);
  assert.equal(useUploadStore.getState().palette, null);
});

test('upload revision rejects old extraction even after choosing the same image again', async () => {
  const store = useUploadStore.getState();
  store.setUpload('same', 'first.png');
  let release;
  const pending = refreshUploadPalette('same', () => new Promise((resolve) => { release = resolve; }));
  store.setUpload('other', 'other.png');
  store.setUpload('same', 'second.png');
  release(DEFAULT_PALETTE);
  assert.equal(await pending, false);
  assert.equal(await refreshUploadPalette('unselected', async () => { throw new Error('must not extract an unselected image'); }), false);
  store.clearUpload();
});
