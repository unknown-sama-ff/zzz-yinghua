import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { createLayerImages, fillBackground } from './pixels.js';
import { createParallaxService, fetchGalleryImage } from './service.js';
import { createPuzzleLayersRouter } from './router.js';

const width = 48; const height = 48;
const pixels = Buffer.alloc(width * height * 3);
const mask = Buffer.alloc(width * height);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const i = y * width + x; const subject = x >= 16 && x < 32 && y >= 12 && y < 36;
  pixels.set(subject ? [240, 40, 30] : [30, 80, 180], i * 3); mask[i] = subject ? 255 : 0;
}
const image = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
const fixture = await createLayerImages(image, mask, width, height);

async function options(t, override = {}) {
  const root = path.resolve('node_modules/.cache/parallax-tests'); await fs.mkdir(root, { recursive: true });
  const cacheDir = await fs.mkdtemp(path.join(root, 'case-'));
  t.after(async () => { assert.ok(cacheDir.startsWith(root + path.sep)); await fs.rm(cacheDir, { recursive: true, force: true }); });
  return {
    cacheDir, lookupImage: async (id) => ({ image_url: `https://example.com/${id}.webp`, style: '海报版' }),
    loadImage: async () => image, getModel: async () => 'fixture-model', availableMemory: () => Infinity,
    runWorker: async ({ output }) => {
      await fs.writeFile(path.join(output, 'foreground.webp'), fixture.foreground);
      await fs.writeFile(path.join(output, 'background.webp'), fixture.background);
      await fs.writeFile(path.join(output, 'meta.json'), JSON.stringify({ width, height }));
    }, ...override,
  };
}

test('separation creates real alpha, removes subject colors from the background, and preserves known pixels', async () => {
  const foreground = await sharp(fixture.foreground).raw().toBuffer();
  assert.equal(foreground[3], 0);
  assert.equal(foreground[(24 * width + 24) * 4 + 3], 255);
  assert.equal(foreground[(24 * width + 24) * 4], 240, 'subject identity pixels are preserved');
  const filled = fillBackground(pixels, mask, width, height);
  assert.deepEqual([...filled.subarray((24 * width + 24) * 3, (24 * width + 24) * 3 + 3)], [30, 80, 180]);
  assert.deepEqual([...filled.subarray(0, 3)], [...pixels.subarray(0, 3)]);
  await assert.rejects(() => createLayerImages(image, Buffer.alloc(width * height), width, height), /无法可靠/);
  await assert.rejects(() => createLayerImages(image, Buffer.alloc(width * height, 255), width, height), /无法可靠/);
});

test('duplicate work is coalesced, different images serialize, and disk cache survives a service restart', async (t) => {
  let calls = 0; let active = 0; let peak = 0;
  const settings = await options(t);
  const original = settings.runWorker;
  settings.runWorker = async (args) => { calls++; active++; peak = Math.max(peak, active); await new Promise(setImmediate); await original(args); active--; };
  const service = createParallaxService(settings);
  const [one, duplicate, two] = await Promise.all([service.prepare(1), service.prepare(1), service.prepare(2)]);
  assert.deepEqual(one, duplicate); assert.notEqual(one.key, two.key);
  assert.equal(calls, 2); assert.equal(peak, 1);
  assert.deepEqual(await createParallaxService(settings).prepare(1), one); assert.equal(calls, 2);
  assert.ok(await service.asset(one.key, 'foreground.webp'));
  assert.equal(await service.asset(one.key, 'input.png'), null);
  assert.equal(await service.asset('../private', 'foreground.webp'), null);
});

test('ids and public source styles are checked before loading any image', async (t) => {
  let loaded = false;
  const service = createParallaxService(await options(t, { lookupImage: async () => ({ image_url: 'https://example.com/x', style: '三视图' }), loadImage: async () => { loaded = true; return image; } }));
  for (const id of [-1, {}, 'http://127.0.0.1', '../private', '']) await assert.rejects(() => service.prepare(id), { status: 400 });
  await assert.rejects(() => service.prepare(3), { status: 404 }); assert.equal(loaded, false);
});

test('insufficient memory fails safely without downloading a model or reading images', async (t) => {
  let touched = false;
  const service = createParallaxService(await options(t, { availableMemory: () => 512 * 1024 * 1024, getModel: async () => { touched = true; return ''; }, loadImage: async () => { touched = true; return image; } }));
  await assert.rejects(() => service.prepare(1), { status: 503 }); assert.equal(touched, false);
});

test('invalid images and failed inference leave no partial cache and can be retried', async (t) => {
  let calls = 0;
  const settings = await options(t);
  const original = settings.runWorker;
  settings.runWorker = async (args) => { if (++calls === 1) throw new Error('model interrupted'); await original(args); };
  const service = createParallaxService(settings);
  await assert.rejects(() => service.prepare(1), /model interrupted/);
  assert.equal((await fs.readdir(path.join(settings.cacheDir, 'work'))).length, 0);
  assert.ok((await service.prepare(1)).key);
  await assert.rejects(() => createParallaxService({ ...settings, loadImage: async () => Buffer.from('not an image') }).prepare(2), { status: 422 });
});

test('remote image loading refuses loopback and private network URLs', async () => {
  await assert.rejects(() => fetchGalleryImage('http://127.0.0.1/private'));
  await assert.rejects(() => fetchGalleryImage('http://192.168.1.1/private'));
});

test('HTTP endpoint serves only the two derived assets and limits expensive work', async (t) => {
  const app = express(); app.use(express.json()); app.use('/api/puzzle-layers', createPuzzleLayersRouter(await options(t)));
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}/api/puzzle-layers`;
  const post = (body) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await (await post({ galleryId: 1 })).json(); assert.equal(result.ok, true);
  const asset = await fetch(`${base}/${result.key}/foreground.webp`); assert.equal(asset.status, 200); assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.equal((await sharp(Buffer.from(await asset.arrayBuffer())).metadata()).hasAlpha, true);
  assert.equal((await fetch(`${base}/${result.key}/meta.json`)).status, 404);
  assert.equal((await post({ imageUrl: 'http://127.0.0.1/private' })).status, 400);
  assert.equal((await post({ galleryId: -1 })).status, 400);
  assert.equal((await post({ galleryId: 2 })).status, 200);
  assert.equal((await post({ galleryId: 3 })).status, 429);
});
