import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { unzipSync, zlibSync } from 'fflate';
import { loadFrontend } from './loadFrontend.js';

const images = await loadFrontend('export * from "./src/lib/memeImages.ts";');

function png(width, height, pixels) {
  const chunk = (name, data) => {
    const type = Buffer.from(name);
    const content = Buffer.concat([type, data]);
    let crc = 0xffffffff;
    for (const byte of content) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, content, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) Buffer.from(pixels.slice(y * width * 4, (y + 1) * width * 4)).copy(scanlines, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', Buffer.from(zlibSync(scanlines))), chunk('IEND', Buffer.alloc(0))]);
}

const dataUrl = (width, height, pixels) => `data:image/png;base64,${png(width, height, pixels).toString('base64')}`;
const decode = async (url) => sharp(Buffer.from(url.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

/** A pixel canvas exercises crop/contain geometry; sharp verifies actual exported PNGs. */
function installCanvas(t, remoteSources = {}) {
  const previousImage = globalThis.Image;
  const previousDocument = globalThis.document;
  const requested = [];
  class MockImage {
    naturalWidth = 0;
    naturalHeight = 0;
    crossOrigin = '';
    set src(value) {
      if (!value) return;
      requested.push({ src: value, crossOrigin: this.crossOrigin });
      const source = remoteSources[value] ?? value;
      Promise.resolve().then(async () => {
        if (!source.startsWith('data:image/png;base64,')) throw new Error('load failed');
        const { data, info } = await decode(source);
        this.naturalWidth = info.width; this.naturalHeight = info.height;
        this.pixels = data;
        this.onload?.();
      }).catch(() => this.onerror?.());
    }
  }
  globalThis.Image = MockImage;
  globalThis.document = {
    createElement(name) {
      assert.equal(name, 'canvas');
      const canvas = { width: 0, height: 0 };
      let pixels;
      const ensure = () => pixels ??= new Uint8ClampedArray(canvas.width * canvas.height * 4);
      canvas.getContext = () => ({
        drawImage(image, ...args) {
          ensure();
          let sx = 0, sy = 0, sw = image.naturalWidth, sh = image.naturalHeight;
          let dx, dy, dw, dh;
          if (args.length === 2) [dx, dy, dw, dh] = [...args, sw, sh];
          else if (args.length === 4) [dx, dy, dw, dh] = args;
          else [sx, sy, sw, sh, dx, dy, dw, dh] = args;
          for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
            if (x + 0.5 < dx || y + 0.5 < dy || x + 0.5 >= dx + dw || y + 0.5 >= dy + dh) continue;
            const sourceX = Math.min(image.naturalWidth - 1, Math.floor(sx + (x + 0.5 - dx) * sw / dw));
            const sourceY = Math.min(image.naturalHeight - 1, Math.floor(sy + (y + 0.5 - dy) * sh / dh));
            pixels.set(image.pixels.subarray((sourceY * image.naturalWidth + sourceX) * 4, (sourceY * image.naturalWidth + sourceX + 1) * 4), (y * canvas.width + x) * 4);
          }
        },
        getImageData: () => ({ data: ensure() }),
      });
      canvas.toDataURL = (mime) => {
        assert.equal(mime, 'image/png');
        return dataUrl(canvas.width, canvas.height, ensure());
      };
      return canvas;
    },
  };
  t.after(() => { globalThis.Image = previousImage; globalThis.document = previousDocument; });
  return requested;
}

test('alpha uses real channel values, including independent white outlines and semitransparency', () => {
  assert.deepEqual(images.inspectMemeAlpha(new Uint8ClampedArray([255, 255, 255, 255, 128, 128, 128, 255])), { hasTransparency: false, hasContent: true });
  assert.deepEqual(images.inspectMemeAlpha(new Uint8ClampedArray([255, 255, 255, 255, 90, 20, 4, 128, 0, 0, 0, 0])), { hasTransparency: true, hasContent: true });
  assert.deepEqual(images.inspectMemeAlpha(new Uint8ClampedArray([255, 255, 255, 0])), { hasTransparency: true, hasContent: false });
});

test('effective transparency requires near-clear pixels covering at least 0.1% of the image', () => {
  const pixels = new Uint8ClampedArray(2000 * 4).fill(255);
  pixels[3] = 254;
  assert.deepEqual(images.inspectMemeAlpha(pixels), { hasTransparency: false, hasContent: true });
  pixels[3] = 0;
  assert.deepEqual(images.inspectMemeAlpha(pixels), { hasTransparency: false, hasContent: true });
  pixels[7] = 17;
  assert.equal(images.inspectMemeAlpha(pixels).hasTransparency, false);
  pixels[7] = 16;
  assert.deepEqual(images.inspectMemeAlpha(pixels), { hasTransparency: true, hasContent: true });
  assert.equal(pixels[7], 16);
});

test('cuts keep remainder pixels and reject invalid or zero-width cells', () => {
  assert.deepEqual(images.defaultMemeCuts(11, 7, 3, 2), { x: [0, 3, 7, 11], y: [0, 3, 7] });
  images.validateMemeCuts({ x: [0, 1, 11], y: [0, 7] }, 11, 7);
  for (const x of [[1, 11], [0, 10], [0, 3, 3, 11], [0, 5, 4, 11], [0, 2.5, 11], [0, NaN, 11], [0, Infinity, 11]]) {
    assert.throws(() => images.validateMemeCuts({ x, y: [0, 7] }, 11, 7));
  }
  for (const args of [[11, 7, 0, 2], [11, 7, 12, 2], [11, 7, 2, 1.5], [5000, 5000, 2, 2], [8193, 1, 1, 1], [1, 8193, 1, 1]]) assert.throws(() => images.defaultMemeCuts(...args));
  assert.deepEqual(images.defaultMemeCuts(8192, 1, 1, 1), { x: [0, 8192], y: [0, 1] });
});

test('read verifies alpha and rejects a fully transparent source', async (t) => {
  installCanvas(t);
  const checker = await images.readMemeImage(dataUrl(2, 1, [255, 255, 255, 255, 180, 180, 180, 255]));
  assert.equal(checker.hasTransparency, false);
  const translucent = await images.readMemeImage(dataUrl(2, 1, [255, 255, 255, 255, 255, 80, 5, 128]));
  assert.equal(translucent.hasTransparency, false);
  assert.deepEqual([...((await decode(translucent.dataUrl)).data)], [255, 255, 255, 255, 255, 80, 5, 128]);
  await assert.rejects(images.readMemeImage(dataUrl(1, 1, [255, 255, 255, 0])), /完全透明/);
});

test('HTTP CORS loading falls back to gallery proxy; data images do not use proxy', async (t) => {
  const src = 'https://example.com/meme.png';
  const proxy = `/api/proxy-image?url=${encodeURIComponent(src)}`;
  const requested = installCanvas(t, { [proxy]: dataUrl(1, 1, [255, 255, 255, 255]) });
  const result = await images.readMemeImage(src);
  assert.equal(result.width, 1);
  assert.deepEqual(requested.map((request) => request.src), [src, proxy]);
  assert.equal(requested[0].crossOrigin, 'anonymous');
  await assert.rejects(images.readMemeImage('data:image/png;base64,broken'));
  assert.equal(requested.length, 3);
});

test('split and compose cover odd dimensions, preserve pixels, and ZIP preserves PNG bytes with safe unique names', async (t) => {
  installCanvas(t);
  const pixels = new Uint8ClampedArray(5 * 3 * 4);
  for (let i = 0; i < 15; i++) pixels.set([i * 10, 255, 255, i === 0 ? 128 : 255], i * 4);
  const source = await images.readMemeImage(dataUrl(5, 3, pixels));
  const cuts = images.defaultMemeCuts(5, 3, 2, 2);
  const tiles = await images.splitMemeSheet(source, cuts);
  assert.deepEqual(tiles.map(({ width, height }) => [width, height]), [[2, 1], [3, 1], [2, 2], [3, 2]]);
  const combined = await images.composeMemeSheet(tiles, cuts);
  assert.equal(combined.width, 5); assert.equal(combined.height, 3);
  assert.deepEqual([...((await decode(combined.dataUrl)).data)], [...pixels]);
  const zip = await images.zipMemeTiles(tiles, ['../../white outline.png', 'same', 'same', '名字.png']);
  assert.equal(zip.type, 'application/zip');
  const zipped = new Uint8Array(await zip.arrayBuffer());
  assert.deepEqual([...zipped.subarray(0, 4)], [80, 75, 3, 4]);
  const files = unzipSync(zipped);
  const names = Object.keys(files);
  assert.deepEqual(names, ['01_white_outline.png', '02_same.png', '03_same.png', '04_名字.png']);
  for (let i = 0; i < tiles.length; i++) {
    assert.deepEqual(Buffer.from(files[names[i]]), Buffer.from(tiles[i].dataUrl.split(',')[1], 'base64'));
    const metadata = await sharp(files[names[i]]).metadata();
    assert.equal(metadata.format, 'png'); assert.equal(metadata.width, tiles[i].width); assert.equal(metadata.height, tiles[i].height);
  }
  await assert.rejects(images.zipMemeTiles([]), /没有/);
  await assert.rejects(images.zipMemeTiles([{ ...tiles[0], dataUrl: 'data:image/jpeg;base64,aGVsbG8=' }]), /PNG/);
});

test('compose contains and centers an unequal aspect ratio without filling transparent margins', async (t) => {
  installCanvas(t);
  const tile = await images.readMemeImage(dataUrl(2, 1, [255, 255, 255, 255, 0, 80, 255, 128]));
  const combined = await images.composeMemeSheet([tile], { x: [0, 4], y: [0, 4] });
  assert.equal(combined.hasTransparency, true);
  const { data } = await decode(combined.dataUrl);
  assert.equal(data[3], 0); // top margin
  assert.equal(data[(4 * 1) * 4 + 3], 255); // white outline
  assert.equal(data[(4 * 1 + 3) * 4 + 3], 128); // translucent content
  assert.equal(data[(4 * 3) * 4 + 3], 0); // bottom margin
  await assert.rejects(images.composeMemeSheet([], { x: [0, 4], y: [0, 4] }), /数量/);
});
