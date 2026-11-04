import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { compositeEmbed, compositeStitch } from './composite.js';

const image = async (width, height) => (await sharp({ create: { width, height, channels: 3, background: '#caa' } }).png().toBuffer()).toString('base64');

test('ordinary stitching and embedded thumbnails preserve the expected output dimensions', async () => {
  const square = await image(100, 100);
  const tall = await image(100, 200);
  const stitched = await sharp(Buffer.from(await compositeStitch([square, tall]), 'base64')).metadata();
  assert.equal(stitched.width, 300); assert.equal(stitched.height, 200);
  const embedded = await sharp(Buffer.from(await compositeEmbed(square, [{ url: tall, size: 0.2, position: 'bottom-right' }]), 'base64')).metadata();
  assert.equal(embedded.width, 100); assert.equal(embedded.height, 100);
});

test('extreme aspect ratios and large lists reject before allocating the output canvas', async () => {
  const wide = await image(32000, 1);
  const tall = await image(1, 1536);
  await assert.rejects(() => compositeStitch([wide, tall]), /pixel limit/);
  await assert.rejects(() => compositeStitch(Array(18).fill(wide)), /too many/);
  await assert.rejects(() => compositeStitch({}), /too many/);
});

test('thumbnail size and expanded output are bounded before rendering', async () => {
  const square = await image(100, 100);
  for (const size of [NaN, Infinity, -1, 0, 100000, '0.2']) {
    await assert.rejects(() => compositeEmbed(square, [{ url: square, size }]), /thumbnail size/);
  }
  const wide = await image(32000, 1);
  await assert.rejects(() => compositeEmbed(square, [{ url: wide, size: 1 }]), /pixel limit/);
  await assert.rejects(() => compositeEmbed(square, Array(18).fill({ url: square })), /too many/);
});
