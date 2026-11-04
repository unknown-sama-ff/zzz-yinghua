import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { prepareEditImage, prepareEditImages } from './prepareEditImages.js';

test('primary and reference preprocessing share dimensions/format rules and preserve input order', async () => {
  const png = await sharp({ create: { width: 1800, height: 900, channels: 4, background: '#c0a0e080' } }).png().toBuffer();
  const jpeg = await sharp({ create: { width: 60, height: 30, channels: 3, background: '#202020' } }).jpeg().toBuffer();
  const images = await prepareEditImages([{ buffer: png, mime: 'image/png' }, { base64: png.toString('base64'), mime: 'image/png' }, { buffer: jpeg, mime: 'image/jpeg' }], { maxDimension: 1024, preserveInputQuality: false });
  assert.deepEqual(images.map(({ mime, ext }) => [mime, ext]), Array(3).fill(['image/jpeg', 'jpg']));
  const metas = await Promise.all(images.map(({ buffer }) => sharp(buffer).metadata()));
  assert.deepEqual(metas.map(({ width, height }) => [width, height]), [[1024, 512], [1024, 512], [60, 30]]);
  assert.equal(images[2].buffer, jpeg, 'an already suitable JPEG must not be re-encoded');
  assert.deepEqual(images[0].buffer, images[1].buffer);
});

test('fidelity processing preserves suitable images and encodes resized JPEG as PNG', async () => {
  const jpeg = await sharp({ create: { width: 1800, height: 900, channels: 3, background: '#807090' } }).jpeg().toBuffer();
  const resized = await prepareEditImage({ buffer: jpeg, mime: 'image/jpeg', ext: 'jpg' }, { maxDimension: 1536, preserveInputQuality: true });
  assert.equal(resized.mime, 'image/png'); assert.equal(resized.ext, 'png');
  const meta = await sharp(resized.buffer).metadata(); assert.equal(meta.width, 1536); assert.equal(meta.height, 768);
  const suitable = await prepareEditImage(resized, { maxDimension: 1536, preserveInputQuality: true });
  assert.equal(suitable, resized);
});

test('failed preprocessing retains original bytes/MIME and does not stop other inputs', async () => {
  const bad = Buffer.from('corrupt image');
  const png = await sharp({ create: { width: 8, height: 4, channels: 3, background: '#d06040' } }).png().toBuffer();
  const images = await prepareEditImages([{ buffer: bad, mime: 'image/webp' }, { buffer: png, mime: 'image/png' }], { maxDimension: 1024, preserveInputQuality: false });
  assert.equal(images[0].buffer, bad); assert.equal(images[0].mime, 'image/webp'); assert.equal(images[0].ext, 'png');
  assert.equal((await sharp(images[1].buffer).metadata()).format, 'jpeg');
});
