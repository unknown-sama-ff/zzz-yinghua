import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { randomFillSync } from 'node:crypto';
import { createGalleryThumbnailService, encodeGalleryThumbnail, galleryThumbnailPath } from './galleryThumbnails.js';

const source = await sharp(randomFillSync(Buffer.alloc(1600 * 1000 * 3)), { raw: { width: 1600, height: 1000, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
const thumbnail = await encodeGalleryThumbnail(source);

test('640px WebP thumbnails preserve aspect ratio and substantially reduce encoded bytes', async () => {
  const meta = await sharp(thumbnail).metadata();
  assert.equal(meta.format, 'webp'); assert.equal(meta.width, 640); assert.equal(meta.height, 400);
  assert.ok(thumbnail.length < source.length * .2);
  const small = await sharp({ create: { width: 30, height: 80, channels: 4, background: '#a050f080' } }).png().toBuffer();
  const tiny = await sharp(await encodeGalleryThumbnail(small)).metadata();
  assert.equal(tiny.width, 30); assert.equal(tiny.height, 80); assert.equal(tiny.hasAlpha, true);
});

test('legacy thumbnails dedupe concurrent work, reuse list metadata and expire predictably', async () => {
  let lookups = 0, downloads = 0, time = 0;
  const service = createGalleryThumbnailService({ lookupImage: async () => { lookups++; return { image_url: 'https://images.example/old.webp' }; }, loadImage: async () => { downloads++; return source; }, now: () => time, ttlMs: 100 });
  service.remember([{ id: 1, image_url: 'https://images.example/old.webp' }]);
  const results = await Promise.all([service.get(1), service.get('1')]);
  assert.deepEqual(results[0], results[1]); assert.equal(downloads, 1); assert.equal(lookups, 0);
  await service.get(1); assert.equal(downloads, 1);
  time = 100; await service.get(1); assert.equal(downloads, 2);
  await assert.rejects(service.get('../etc'), (error) => error.status === 400);
});

test('new images prefer the persisted thumbnail and missing derivatives fall back to legacy conversion', async () => {
  const urls = [];
  const service = createGalleryThumbnailService({ lookupImage: async () => ({ image_url: 'https://images.example/gallery/123-full.webp' }), loadImage: async (url) => { urls.push(url); return thumbnail; } });
  assert.equal(await service.get(2), thumbnail); assert.deepEqual(urls, ['https://images.example/gallery/123-thumb.webp']);
  const fallback = createGalleryThumbnailService({ lookupImage: async () => ({ image_url: 'https://images.example/gallery/123-full.webp' }), loadImage: async (url) => { if (url.endsWith('-thumb.webp')) throw new Error('404'); return source; } });
  assert.equal((await sharp(await fallback.get(2)).metadata()).width, 640);
  assert.equal(galleryThumbnailPath('gallery/legacy.webp'), null);
});

test('thumbnail cache eviction and failed builds remain retryable; deletion invalidates pending cache writes', async () => {
  let downloads = 0;
  const service = createGalleryThumbnailService({ maxBytes: thumbnail.length + 1, lookupImage: async (id) => ({ image_url: 'https://images.example/' + id + '-full.webp' }), loadImage: async () => { downloads++; return thumbnail; } });
  await service.get(1); await service.get(2); await service.get(1); assert.equal(downloads, 3);
  let fail = true;
  const retry = createGalleryThumbnailService({ lookupImage: async () => ({ image_url: 'https://images.example/old.webp' }), loadImage: async () => { if (fail) throw new Error('network'); return source; } });
  await assert.rejects(retry.get(1), /network/); fail = false; await retry.get(1);
  let release, calls = 0;
  const race = createGalleryThumbnailService({ lookupImage: async () => ({ image_url: 'https://images.example/old.webp' }), loadImage: async () => { calls++; if (calls === 1) await new Promise((resolve) => { release = resolve; }); return source; } });
  const pending = race.get(3); while (!release) await new Promise((resolve) => setImmediate(resolve));
  race.invalidate(3); release(); await pending; await race.get(3); assert.equal(calls, 2, 'deleted content must not repopulate the cache');
});

test('at most two image reads/transforms run together and invalid/missing images are rejected', async () => {
  let active = 0, maximum = 0;
  const service = createGalleryThumbnailService({ lookupImage: async () => ({ image_url: 'https://images.example/old.webp' }), loadImage: async () => { active++; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 5)); active--; return source; } });
  await Promise.all([1, 2, 3, 4].map((id) => service.get(id))); assert.equal(maximum, 2);
  const missing = createGalleryThumbnailService({ lookupImage: async () => null }); await assert.rejects(missing.get(1), (error) => error.status === 404);
  const privateUrl = createGalleryThumbnailService({ lookupImage: async () => ({ image_url: 'http://127.0.0.1/private.png' }) });
  await assert.rejects(privateUrl.get(1), (error) => error.code === 'SSRF_BLOCKED');
  await assert.rejects(encodeGalleryThumbnail(Buffer.from('<svg>not a raster</svg>')), (error) => error.status === 422);
});
