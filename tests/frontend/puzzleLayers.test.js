import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';

const { getPuzzleLayers } = await loadFrontend(`export * from './src/lib/puzzleLayers';`);

test('only an identified foreground is preloaded and repeated requests share the result', async (t) => {
  const originals = { window: globalThis.window, Image: globalThis.Image, fetch: globalThis.fetch };
  t.after(() => Object.assign(globalThis, originals));
  const loaded = [];
  let foreground;
  let requests = 0;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.Image = class {
    set src(value) {
      if (!value) return;
      loaded.push(value);
      queueMicrotask(() => {
        if (value.endsWith('/foreground.webp') && foreground !== true) this.onerror?.();
        else this.onload?.();
      });
    }
  };
  globalThis.fetch = async () => {
    requests++;
    return { ok: true, json: async () => ({ ok: true, key: 'a'.repeat(64), width: 512, height: 768, hasForeground: foreground }) };
  };
  for (const [id, identified] of [[1, false], [2, true], [3, undefined]]) {
    foreground = identified;
    loaded.length = 0;
    const pending = getPuzzleLayers(id);
    assert.equal(getPuzzleLayers(id), pending);
    const result = await pending;
    assert.equal(result.hasForeground, identified === true);
    assert.deepEqual(loaded.map((url) => url.split('/').at(-1)).sort(), identified === true
      ? ['background.webp', 'foreground.webp', 'subject.webp']
      : ['background.webp', 'subject.webp']);
    assert.equal(await getPuzzleLayers(id), result);
  }
  assert.equal(requests, 3);
});
