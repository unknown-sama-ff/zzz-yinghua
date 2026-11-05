import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { createLayerImages, fillBackground } from './pixels.js';
import { createParallaxService, fetchGalleryImage } from './service.js';
import { createPuzzleLayersRouter } from './router.js';
import { prepareModelInput, cropPrediction, MODEL_SIZE } from './input.js';
import { prepareDepthInput, normalizeDepthPrediction } from './depth.js';

const width = 48; const height = 48;
const pixels = Buffer.alloc(width * height * 3);
const mask = Buffer.alloc(width * height);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const i = y * width + x; const subject = x >= 16 && x < 32 && y >= 12 && y < 36;
  pixels.set(subject ? [240, 40, 30] : [30, 80, 180], i * 3); mask[i] = subject ? 255 : 0;
}
const image = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
const fixture = await createLayerImages(image, mask, width, height);

test('model preprocessing preserves portrait geometry and dark RGB values, then crops padding', async () => {
  const portrait = await sharp({ create: { width: 12, height: 24, channels: 3, background: { r: 50, g: 25, b: 10 } } }).png().toBuffer();
  const layout = await prepareModelInput(portrait);
  assert.equal(layout.width, 512); assert.equal(layout.height, 1024);
  assert.equal(layout.left, 256); assert.equal(layout.top, 0);
  assert.equal(layout.values[0], 0);
  assert.ok(Math.abs(layout.values[layout.left] - 50 / 255) < 0.000001);
  const prediction = new Float32Array(MODEL_SIZE * MODEL_SIZE);
  prediction[256] = 0.75;
  const cropped = cropPrediction(prediction, layout);
  assert.equal(cropped.length, 512 * 1024); assert.equal(cropped[0], 191);
  assert.throws(() => cropPrediction(new Float32Array(MODEL_SIZE * MODEL_SIZE), layout), /未识别/);
  prediction[256] = NaN;
  assert.throws(() => cropPrediction(prediction, layout), /无效/);
});

test('depth inputs stay bounded for extreme ratios and output increases towards nearer surfaces', async () => {
  for (const [w, h] of [[1024, 350], [350, 1024], [1024, 1], [1, 1024], [1, 1]]) {
    const source = await sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const input = await prepareDepthInput(source);
    assert.ok(input.width <= 1022 && input.height <= 1022);
    assert.equal(input.width % 14, 0); assert.equal(input.height % 14, 0);
    assert.equal(input.values.length, input.width * input.height * 3);
    assert.ok(Math.abs(input.values[0] - (1 - 0.485) / 0.229) < 0.00001);
  }
  assert.deepEqual([...normalizeDepthPrediction(new Float32Array([2, 4, 6, 8]), [1, 2, 2]).data], [0, 85, 170, 255]);
  assert.deepEqual([...normalizeDepthPrediction(new Float32Array(4).fill(2), [1, 2, 2]).data], [0, 0, 0, 0]);
  assert.throws(() => normalizeDepthPrediction(new Float32Array([NaN]), [1, 1]), /无效/);
  assert.throws(() => normalizeDepthPrediction(new Float32Array(4), [1, 3, 3]), /尺寸无效/);
});

async function options(t, override = {}) {
  const root = path.resolve('node_modules/.cache/parallax-tests'); await fs.mkdir(root, { recursive: true });
  const cacheDir = await fs.mkdtemp(path.join(root, 'case-'));
  t.after(async () => { assert.ok(cacheDir.startsWith(root + path.sep)); await fs.rm(cacheDir, { recursive: true, force: true }); });
  return {
    cacheDir, lookupImage: async (id) => ({ image_url: `https://example.com/${id}.webp`, style: '海报版' }),
    loadImage: async () => image, getModel: async () => 'fixture-model', getDepthModel: async () => 'fixture-depth-model', availableMemory: () => Infinity,
    runWorker: async ({ output }) => {
      await fs.writeFile(path.join(output, 'foreground.webp'), fixture.foreground);
      await fs.writeFile(path.join(output, 'subject.webp'), fixture.subject);
      await fs.writeFile(path.join(output, 'background.webp'), fixture.background);
      await fs.writeFile(path.join(output, 'meta.json'), JSON.stringify({ width, height, hasForeground: fixture.hasForeground }));
    }, ...override,
  };
}

test('separation creates real alpha, removes subject colors from the background, and preserves known pixels', async () => {
  const foreground = await sharp(fixture.subject).raw().toBuffer();
  assert.equal(foreground[3], 0);
  assert.equal(foreground[(24 * width + 24) * 4 + 3], 255);
  assert.equal(foreground[(24 * width + 24) * 4], 240, 'subject identity pixels are preserved');
  const filled = fillBackground(pixels, mask, width, height);
  assert.deepEqual([...filled.subarray((24 * width + 24) * 3, (24 * width + 24) * 3 + 3)], [30, 80, 180]);
  assert.deepEqual([...filled.subarray(0, 3)], [...pixels.subarray(0, 3)]);
  await assert.rejects(() => createLayerImages(image, Buffer.alloc(width * height), width, height), /无法可靠/);
  await assert.rejects(() => createLayerImages(image, Buffer.alloc(width * height, 255), width, height), /无法可靠/);
});

test('three layers isolate disconnected near-edge scenery and preserve aligned source pixels', async () => {
  const w = 96; const h = 96;
  const rgb = Buffer.alloc(w * h * 3);
  const matte = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const main = x >= 35 && x < 65 && y >= 12 && y < 76;
    const near = x < 18 && y > 78;
    const fringe = x === 34 && y >= 12 && y < 76;
    matte[i] = main || near ? 255 : fringe ? 115 : 0;
    rgb.set(main ? [240, 40, 30] : near ? [30, 190, 40] : fringe ? [130, 60, 100] : [30, 80, 180], i * 3);
  }
  // A tiny disconnected high-confidence mark must not turn into floating scenery.
  matte[4 * w + 90] = 255;
  const source = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  const layers = await createLayerImages(source, matte, w, h);
  assert.equal(layers.hasForeground, true);
  const subject = await sharp(layers.subject).ensureAlpha().raw().toBuffer();
  const foreground = await sharp(layers.foreground).ensureAlpha().raw().toBuffer();
  assert.equal(subject[(40 * w + 45) * 4 + 3], 255);
  assert.equal(foreground[(40 * w + 45) * 4 + 3], 0);
  assert.equal(foreground[(88 * w + 8) * 4 + 3], 255);
  assert.equal(subject[(88 * w + 8) * 4 + 3], 0);
  assert.equal(subject[(4 * w + 90) * 4 + 3], 0);
  const composite = await sharp(layers.background).composite([{ input: layers.subject }, { input: layers.foreground }]).removeAlpha().raw().toBuffer();
  let maxError = 0;
  for (let i = 0; i < rgb.length; i++) maxError = Math.max(maxError, Math.abs(rgb[i] - composite[i]));
  assert.ok(maxError <= 2, `aligned composite changed source by ${maxError}`);
  const empty = await sharp(fixture.foreground).ensureAlpha().raw().toBuffer();
  assert.equal(fixture.hasForeground, false);
  assert.equal(empty.some((value, i) => i % 4 === 3 && value > 0), false);
});

test('depth separates a connected camera hand and prop while repairing the subject underneath', async () => {
  const w = 96; const h = 96;
  const rgb = Buffer.alloc(w * h * 3);
  const matte = Buffer.alloc(w * h);
  const depth = Buffer.alloc(w * h, 25);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const main = x >= 28 && x < 68 && y >= 10 && y < 84;
    const near = x >= 36 && x < 60 && y >= 65;
    matte[i] = main || near ? 255 : 0;
    depth[i] = near ? 235 : main ? 120 : 25;
    rgb.set(near ? [30, 190, 40] : main ? [240, 40, 30] : [30, 80, 180], i * 3);
  }
  const source = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  const layers = await createLayerImages(source, matte, w, h, { depth: { data: depth, width: w, height: h } });
  assert.equal(layers.hasForeground, true, 'a near prop connected to the person still needs its own layer');
  const subject = await sharp(layers.subject).ensureAlpha().raw().toBuffer();
  const foreground = await sharp(layers.foreground).ensureAlpha().raw().toBuffer();
  const face = (28 * w + 48) * 4;
  const prop = (74 * w + 48) * 4;
  assert.equal(subject[face + 3], 255);
  assert.equal(foreground[face + 3], 0, 'the face stays in the subject layer');
  assert.equal(foreground[prop + 3], 255);
  assert.ok(subject[prop] > 200 && subject[prop + 1] < 80, 'the moving foreground must not leave a copy of the green prop behind');
  const composite = await sharp(layers.background).composite([{ input: layers.subject }, { input: layers.foreground }]).removeAlpha().raw().toBuffer();
  let maxError = 0;
  for (let i = 0; i < rgb.length; i++) maxError = Math.max(maxError, Math.abs(rgb[i] - composite[i]));
  assert.ok(maxError <= 2, `aligned depth layers changed source by ${maxError}`);
  const flat = await createLayerImages(source, matte, w, h, { depth: { data: Buffer.alloc(w * h, 120), width: w, height: h } });
  assert.equal(flat.hasForeground, false, 'an uninformative depth map cannot invent an extra near object');
});

test('color boundaries keep a near prop whole when its top shares the face depth', async () => {
  const w = 96; const h = 96;
  const rgb = Buffer.alloc(w * h * 3);
  const matte = Buffer.alloc(w * h);
  const depth = Buffer.alloc(w * h, 25);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const main = x >= 24 && x < 72 && y >= 8 && y < 88;
    const prop = x >= 36 && x < 60 && y >= 56 && y < 80;
    const hand = x >= 32 && x < 64 && y >= 80;
    matte[i] = main || hand ? 255 : 0;
    depth[i] = hand || prop && y >= 70 ? 235 : main ? 120 : 25;
    rgb.set(prop ? [28, 25, 34] : main || hand ? [220, 210, 205] : [30, 80, 180], i * 3);
  }
  const source = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  const layers = await createLayerImages(source, matte, w, h, { depth: { data: depth, width: w, height: h } });
  const foreground = await sharp(layers.foreground).ensureAlpha().raw().toBuffer();
  assert.equal(foreground[(60 * w + 48) * 4 + 3], 255, 'the top half of the near prop must move with its lower half');
  assert.equal(foreground[(24 * w + 48) * 4 + 3], 0, 'the face remains separate');
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
  assert.ok(await service.asset(one.key, 'subject.webp'));
  assert.equal(await service.asset(one.key, 'input.png'), null);
  assert.equal(await service.asset('../private', 'foreground.webp'), null);
  await fs.unlink(path.join(settings.cacheDir, 'layers', one.key, 'subject.webp'));
  assert.deepEqual(await service.prepare(1), one, 'incomplete legacy cache is rebuilt');
  assert.equal(calls, 3);
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

test('depth model preparation failures are retryable and both validated paths reach the worker', async (t) => {
  let attempts = 0;
  const settings = await options(t, { getDepthModel: async () => {
    if (++attempts === 1) throw new Error('depth download interrupted');
    return 'fixture-depth-model';
  } });
  const original = settings.runWorker;
  settings.runWorker = async (args) => {
    assert.equal(args.model, 'fixture-model'); assert.equal(args.depthModel, 'fixture-depth-model');
    await original(args);
  };
  const service = createParallaxService(settings);
  await assert.rejects(() => service.prepare(1), /depth download interrupted/);
  assert.equal(await fs.access(path.join(settings.cacheDir, 'work')).then(() => true, () => false), false);
  assert.ok((await service.prepare(1)).key);
  assert.equal(attempts, 2);
});

test('a worker returning only two assets cannot publish an incomplete three-layer cache', async (t) => {
  const settings = await options(t, { runWorker: async ({ output }) => {
    await fs.writeFile(path.join(output, 'foreground.webp'), fixture.foreground);
    await fs.writeFile(path.join(output, 'background.webp'), fixture.background);
    await fs.writeFile(path.join(output, 'meta.json'), JSON.stringify({ width, height }));
  } });
  await assert.rejects(() => createParallaxService(settings).prepare(1), /不完整/);
  assert.equal((await fs.readdir(path.join(settings.cacheDir, 'layers'))).length, 0);
  assert.equal((await fs.readdir(path.join(settings.cacheDir, 'work'))).length, 0);
});

test('remote image loading refuses loopback and private network URLs', async () => {
  await assert.rejects(() => fetchGalleryImage('http://127.0.0.1/private'));
  await assert.rejects(() => fetchGalleryImage('http://192.168.1.1/private'));
});

test('HTTP endpoint serves only the three derived assets and limits expensive work', async (t) => {
  const app = express(); app.use(express.json()); app.use('/api/puzzle-layers', createPuzzleLayersRouter(await options(t)));
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}/api/puzzle-layers`;
  const post = (body) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await (await post({ galleryId: 1 })).json(); assert.equal(result.ok, true);
  const asset = await fetch(`${base}/${result.key}/foreground.webp`); assert.equal(asset.status, 200); assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.equal((await sharp(Buffer.from(await asset.arrayBuffer())).metadata()).hasAlpha, true);
  assert.equal((await fetch(`${base}/${result.key}/subject.webp`)).status, 200);
  assert.equal((await fetch(`${base}/${result.key}/meta.json`)).status, 404);
  assert.equal((await post({ imageUrl: 'http://127.0.0.1/private' })).status, 400);
  assert.equal((await post({ galleryId: -1 })).status, 400);
  assert.equal((await post({ galleryId: 2 })).status, 200);
  assert.equal((await post({ galleryId: 3 })).status, 429);
});
