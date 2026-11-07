import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { once } from 'node:events';
import { deleteGalleryItem, galleryThumbnails, saveGalleryItem } from './gallery.js';

const bytes = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#9275b0' } }).png().toBuffer();
const input = { imageBase64: bytes.toString('base64'), style: '海报版', deleteToken: 'gallery-test-delete-token' };
// Genuine two-frame GIF with red/blue frames and distinct 40/90ms delays.
const animatedGif = Buffer.from('R0lGODlhAgABAIAAAExpcf8AACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFBAAAACwAAAAAAgABAAACAkwKACH5BAUJAAAALAAAAAACAAEAgExpcQAA/wICTAoAOw==', 'base64');
function storage({ uploadFailure, insertFailure } = {}) {
  const uploaded = [], removed = []; let saved;
  const bucket = { async upload(path, bytes, options) { uploaded.push({ path, bytes, options }); if (uploaded.length === 2 && uploadFailure) { if (uploadFailure === 'reject') throw new Error('network'); return { error: { message: 'storage unavailable' } }; } return { error: null }; },
    getPublicUrl: (path) => ({ data: { publicUrl: 'https://storage.example/storage/v1/object/public/gallery-images/' + path } }),
    async remove(paths) { removed.push(paths); return { error: null }; } };
  const client = { storage: { from: () => bucket }, from: () => ({
    insert(row) { saved = { ...row, id: 712, created_at: '' }; return { select: () => ({ single: async () => ({ data: saved, error: insertFailure ? { message: 'DB unavailable' } : null }) }) }; },
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: saved, error: null }) }) }),
    delete: () => ({ eq: async () => ({ error: null }) }),
  }) };
  return { client, uploaded, removed };
}

test('saving a gallery image uploads original plus thumbnail; deleting owns and removes both', async () => {
  const fake = storage(); const row = await saveGalleryItem(input, fake.client);
  assert.equal(fake.uploaded.length, 2); assert.match(fake.uploaded[0].path, /-full\.webp$/); assert.match(fake.uploaded[1].path, /-thumb\.webp$/);
  assert.equal(fake.uploaded[0].options.cacheControl, '31536000');
  assert.equal((await sharp(fake.uploaded[0].bytes).metadata()).width, 1200);
  assert.equal((await sharp(fake.uploaded[1].bytes).metadata()).width, 640);
  assert.equal(await galleryThumbnails.get(row.id), fake.uploaded[1].bytes, 'fresh save primes the thumbnail cache');
  assert.equal((await deleteGalleryItem({ id: row.id, deleteToken: 'wrong-delete-token' }, fake.client)).reason, 'forbidden'); assert.equal(fake.removed.length, 0);
  assert.deepEqual(await deleteGalleryItem({ id: row.id, deleteToken: input.deleteToken }, fake.client), { ok: true });
  assert.deepEqual(fake.removed[0], fake.uploaded.map((item) => item.path));
});

test('both derivative objects are rolled back on storage errors, network rejection or DB failure', async () => {
  for (const options of [{ uploadFailure: true }, { uploadFailure: 'reject' }, { insertFailure: true }]) {
    const fake = storage(options);
    await assert.rejects(saveGalleryItem(input, fake.client));
    assert.deepEqual(fake.removed[0], fake.uploaded.map((item) => item.path));
  }
});

test('saving detected GIF preserves every frame and timing while storing a static first-frame thumbnail', async () => {
  const fake = storage();
  const row = await saveGalleryItem({ ...input, imageBase64: animatedGif.toString('base64'), mime: 'image/png' }, fake.client);
  const [full, thumb] = fake.uploaded;
  assert.match(row.image_url, /-full\.gif$/);
  assert.match(full.path, /-full\.gif$/);
  assert.equal(full.options.contentType, 'image/gif');
  assert.deepEqual(full.bytes, animatedGif);
  const meta = await sharp(full.bytes, { animated: true }).metadata();
  assert.equal(meta.pages, 2); assert.deepEqual(meta.delay, [40, 90]); assert.equal(meta.loop, 0);
  assert.equal(thumb.options.contentType, 'image/webp'); assert.match(thumb.path, /-thumb\.webp$/);
  const preview = await sharp(thumb.bytes).metadata();
  assert.equal(preview.format, 'webp'); assert.equal(preview.pages || 1, 1);
  assert.equal(preview.width, 2); assert.equal(preview.height, 1);
  const { data } = await sharp(thumb.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 240 && data[2] < 20, 'thumbnail shows the red first frame');
  assert.equal(await galleryThumbnails.get(row.id), thumb.bytes);
  await deleteGalleryItem({ id: row.id, deleteToken: input.deleteToken }, fake.client);
  assert.deepEqual(fake.removed[0], [full.path, thumb.path]);
});

test('large GIF uploads use a smaller animated WebP with proportional dimensions and original timing', async () => {
  const width = 1600, height = 900;
  const frameBytes = width * height * 3;
  const frames = Buffer.alloc(frameBytes * 2);
  frames.fill(Buffer.from([240, 40, 30]), 0, frameBytes);
  frames.fill(Buffer.from([30, 80, 180]), frameBytes);
  const gif = await sharp(frames, { raw: { width, height: height * 2, channels: 3, pageHeight: height } })
    .gif({ delay: [40, 90], loop: 2, keepDuplicateFrames: true }).toBuffer();
  const fake = storage();
  const row = await saveGalleryItem({ ...input, imageBase64: gif.toString('base64') }, fake.client);
  const [full, thumb] = fake.uploaded;
  assert.match(row.image_url, /-animated-full\.webp$/);
  assert.equal(full.options.contentType, 'image/webp');
  assert.ok(full.bytes.length < gif.length, 'gallery animation must be smaller than the uploaded GIF');
  const meta = await sharp(full.bytes, { animated: true }).metadata();
  assert.equal(meta.format, 'webp'); assert.equal(meta.width, 1024); assert.equal(meta.pageHeight, 576);
  assert.equal(meta.pages, 2); assert.deepEqual(meta.delay, [40, 90]); assert.equal(meta.loop, 2);
  assert.match(thumb.path, /-animated-thumb\.webp$/);
  const thumbnail = await sharp(thumb.bytes).metadata();
  assert.equal(thumbnail.pages || 1, 1); assert.equal(thumbnail.width, 640); assert.equal(thumbnail.height, 360);
});

test('animated WebP encoding preserves visible pixels and alpha when resizing is unnecessary, including resaves', async () => {
  const width = 256, height = 128, pages = 3;
  const frames = Buffer.alloc(width * height * pages * 4);
  for (let frame = 0; frame < pages; frame++) for (let y = 20; y < 90; y++) for (let x = 10 + frame * 35; x < 100 + frame * 35; x++) {
    frames.set([240, 40 + frame * 30, 70, 255], ((frame * height + y) * width + x) * 4);
  }
  const gif = await sharp(frames, { raw: { width, height: height * pages, channels: 4, pageHeight: height } })
    .gif({ delay: [40, 90, 150], loop: 0, keepDuplicateFrames: true }).toBuffer();
  const fake = storage();
  await saveGalleryItem({ ...input, imageBase64: gif.toString('base64') }, fake.client);
  const full = fake.uploaded[0];
  assert.equal((await sharp(full.bytes).metadata()).format, 'webp');
  const before = await sharp(gif, { animated: true }).ensureAlpha().raw().toBuffer();
  const after = await sharp(full.bytes, { animated: true }).ensureAlpha().raw().toBuffer();
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i += 4) {
    assert.equal(after[i + 3], before[i + 3]);
    if (before[i + 3]) assert.deepEqual(after.subarray(i, i + 4), before.subarray(i, i + 4));
  }
  const resaved = storage();
  await saveGalleryItem({ ...input, imageBase64: full.bytes.toString('base64') }, resaved.client);
  const meta = await sharp(resaved.uploaded[0].bytes, { animated: true }).metadata();
  assert.equal(meta.pages, 3); assert.deepEqual(meta.delay, [40, 90, 150]); assert.equal(meta.loop, 0);
});

test('claimed MIME types cannot bypass raster validation and GIFs reject trailing data or excessive decode work', async () => {
  const largeCanvas = Buffer.from(animatedGif);
  largeCanvas.writeUInt16LE(6000, 6); largeCanvas.writeUInt16LE(6000, 8);
  const corruptSecondFrame = Buffer.from(animatedGif);
  corruptSecondFrame[corruptSecondFrame.length - 6] = 12; // Invalid LZW size after a valid first frame.
  const framePixels = Buffer.alloc(65 * 3);
  for (let frame = 0; frame < 65; frame++) framePixels[frame * 3 + frame % 2] = 255;
  const tooManyFrames = await sharp(framePixels, { raw: { width: 1, height: 65, channels: 3, pageHeight: 1 } }).gif({ delay: 40 }).toBuffer();
  assert.equal((await sharp(tooManyFrames).metadata()).pages, 65);
  for (const invalid of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
    Buffer.from('GIF89a<script>invalid</script>'), Buffer.concat([animatedGif, Buffer.from('<script>trailing</script>')]),
    animatedGif.subarray(0, -1), corruptSecondFrame, largeCanvas, tooManyFrames]) {
    const fake = storage();
    await assert.rejects(saveGalleryItem({ ...input, imageBase64: invalid.toString('base64'), mime: 'image/gif' }, fake.client), /图片数据无效/);
    assert.equal(fake.uploaded.length, 0);
  }
  const fake = storage();
  await saveGalleryItem({ ...input, mime: 'image/gif' }, fake.client);
  assert.match(fake.uploaded[0].path, /-full\.webp$/);
  assert.equal(fake.uploaded[0].options.contentType, 'image/webp');
  const maxFrames = await sharp(framePixels.subarray(0, 64 * 3), { raw: { width: 1, height: 64, channels: 3, pageHeight: 1 } }).gif({ delay: 40 }).toBuffer();
  const maxFake = storage();
  await saveGalleryItem({ ...input, imageBase64: maxFrames.toString('base64') }, maxFake.client);
  assert.equal((await sharp(maxFake.uploaded[0].bytes, { animated: true }).metadata()).pages, 64);
});

test('animated WebP rejects trailing content, truncation, excessive frames and oversized logical canvases', async () => {
  const webp = await sharp(animatedGif, { animated: true }).webp({ lossless: true }).toBuffer();
  const canvas = Buffer.from(webp);
  assert.equal(canvas.toString('ascii', 12, 16), 'VP8X');
  canvas.writeUIntLE(5999, 24, 3); canvas.writeUIntLE(5999, 27, 3);
  const pixels = Buffer.alloc(65 * 3);
  for (let i = 0; i < 65; i++) pixels[i * 3 + i % 2] = 255;
  const frames = await sharp(pixels, { raw: { width: 1, height: 65, channels: 3, pageHeight: 1 } })
    .webp({ lossless: true, delay: 40 }).toBuffer();
  assert.equal((await sharp(frames).metadata()).pages, 65);
  for (const invalid of [Buffer.concat([webp, Buffer.from('<script>trailing</script>')]), webp.subarray(0, -8), canvas, frames]) {
    const fake = storage();
    await assert.rejects(saveGalleryItem({ ...input, imageBase64: invalid.toString('base64') }, fake.client), /图片数据无效/);
    assert.equal(fake.uploaded.length, 0);
  }
});

test('thumbnail HTTP route serves bounded raster content and rejects invalid IDs before storage lookup', async (t) => {
  process.env.VERCEL = '1';
  const { default: app } = await import('./index.js');
  const thumb = await sharp(bytes).resize(640, 640, { fit: 'inside' }).webp().toBuffer();
  galleryThumbnails.prime({ id: 99123, image_url: 'https://storage.example/route-test-full.webp' }, thumb);
  t.after(() => galleryThumbnails.invalidate(99123));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/api/gallery/99123/thumbnail');
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.match(response.headers.get('cache-control'), /max-age=3600/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), thumb);
  const invalid = await fetch(base + '/api/gallery/bad!/thumbnail');
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).code, 'INVALID_INPUT');
});
