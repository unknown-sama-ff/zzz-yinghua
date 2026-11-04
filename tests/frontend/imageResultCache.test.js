import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';
const { ImageResultCache, imageResultKey } = await loadFrontend("export * from './src/lib/imageResultCache';");

test('image result cache evicts least-recently-used entries under shared byte and entry budgets', async () => {
  const cache = new ImageResultCache(120, 2, 1000);
  const runs = new Map();
  const get = (key) => cache.run(key, async () => { runs.set(key, (runs.get(key) || 0) + 1); return 'x'.repeat(20); });
  await get('a'); await get('b'); await get('a'); await get('c');
  assert.equal(cache.size, 2); assert.equal(cache.retainedBytes, 84);
  await get('a'); assert.equal(runs.get('a'), 1);
  await get('b'); assert.equal(runs.get('b'), 2);
  assert.ok(cache.retainedBytes <= 120);
  const byBytes = new ImageResultCache(60, 20, 1000);
  await byBytes.run('a', async () => 'x'.repeat(20)); await byBytes.run('b', async () => 'x'.repeat(20));
  assert.equal(byBytes.size, 1); assert.equal(byBytes.retainedBytes, 42);
});

test('expired, oversized and failed image tasks release their entries and remain retryable', async () => {
  let time = 0, runs = 0;
  const cache = new ImageResultCache(100, 4, 1000, () => time);
  const get = () => cache.run('key', async () => { runs++; return 'image'; });
  await get(); time = 999; await get(); assert.equal(runs, 1);
  time = 1000; cache.purgeExpired(); assert.equal(cache.size, 0); assert.equal(cache.retainedBytes, 0);
  await get(); assert.equal(runs, 2);
  await cache.run('large', async () => 'x'.repeat(100)); assert.equal(cache.size, 1);
  await assert.rejects(cache.run('fail', () => { throw new Error('decode failed'); }), /decode failed/);
  assert.equal(await cache.run('fail', async () => 'recovered'), 'recovered');
});

test('concurrent identical work shares one promise; cache hits do not invoke image processing', async () => {
  const cache = new ImageResultCache(1000, 10, 1000);
  let release, runs = 0;
  const create = () => { runs++; return new Promise((resolve) => { release = resolve; }); };
  const first = cache.run('same', create), second = cache.run('same', create);
  assert.equal(first, second);
  await Promise.resolve(); assert.equal(runs, 1);
  release('png'); assert.equal(await first, 'png');
  assert.equal(await cache.run('same', create), 'png'); assert.equal(runs, 1);
});

test('image fingerprints remain compact for multi-megabyte inputs and preserve source/order/options identity', async () => {
  const source = 'data:image/png;base64,' + 'A'.repeat(2 * 1024 * 1024);
  const key = await imageResultKey('embed', [source, 'thumb'], [[.2, 'bottom-right']]);
  assert.ok(key.length < 250); assert.ok(!key.includes('data:image'));
  assert.equal(key, await imageResultKey('embed', [source, 'thumb'], [[.2, 'bottom-right']]));
  assert.notEqual(key, await imageResultKey('stitch', [source, 'thumb'], [[.2, 'bottom-right']]));
  assert.notEqual(key, await imageResultKey('embed', ['thumb', source], [[.2, 'bottom-right']]));
  assert.notEqual(key, await imageResultKey('embed', [source + 'B', 'thumb'], [[.2, 'bottom-right']]));
  assert.notEqual(key, await imageResultKey('embed', [source, 'thumb'], [[.3, 'bottom-right']]));
});

test('missing WebCrypto skips caching without blocking image preparation', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    assert.equal(await imageResultKey('stitch', ['data:image/png;base64,foo']), null);
  } finally { if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor); else delete globalThis.crypto; }
  const cache = new ImageResultCache(1000, 10, 1000); let runs = 0;
  await cache.run(null, async () => String(++runs)); await cache.run(null, async () => String(++runs));
  assert.equal(runs, 2); assert.equal(cache.size, 0); assert.equal(cache.retainedBytes, 0);
});
