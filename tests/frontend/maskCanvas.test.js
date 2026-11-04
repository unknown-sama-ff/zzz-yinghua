import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';
const { MaskHistory } = await loadFrontend("export * from './src/lib/maskCanvas';");

function canvas(width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4); let reads = 0;
  const context = {
    getImageData(x, y, w, h) {
      assert.ok(x >= 0 && y >= 0 && x + w <= width && y + h <= height);
      reads++; const data = new Uint8ClampedArray(w * h * 4);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) data.set(pixels.subarray(((y + yy) * width + x + xx) * 4, ((y + yy) * width + x + xx) * 4 + 4), (yy * w + xx) * 4);
      return { width: w, height: h, data };
    },
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData(image, x, y) { for (let yy = 0; yy < image.height; yy++) for (let xx = 0; xx < image.width; xx++) pixels.set(image.data.subarray((yy * image.width + xx) * 4, (yy * image.width + xx) * 4 + 4), ((y + yy) * width + x + xx) * 4); },
    clearRect(x, y, w, h) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) pixels.fill(0, (yy * width + xx) * 4, (yy * width + xx) * 4 + 4); },
  };
  return { width, height, getContext: () => context, readCount: () => reads,
    paint(x, y, w, h, alpha) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) pixels.set([255, 255, 255, alpha], (yy * width + xx) * 4); },
    alpha: () => pixels.filter((_value, i) => i % 4 === 3),
  };
}

test('sparse mask history restores exact alpha across partial edge tiles and detects undo to empty', () => {
  const image = canvas(270, 150), history = new MaskHistory(image);
  history.begin(); history.capture(120, 115, 270, 150);
  assert.equal(image.readCount(), 0, 'known-empty tiles require no snapshot read');
  image.paint(120, 115, 150, 35, 127); history.update(120, 115, 270, 150); history.commit();
  assert.equal(history.hasContent, true); const original = image.alpha();
  history.begin(); history.capture(128, 120, 270, 150); image.paint(128, 120, 142, 30, 0); history.update(128, 120, 270, 150); history.commit();
  assert.equal(history.undo(), true); assert.deepEqual(image.alpha(), original, 'alpha-only snapshots must preserve antialiasing');
  assert.equal(history.undo(), true); assert.equal(history.hasContent, false); assert.equal(image.alpha().some(Boolean), false);
  assert.equal(history.undo(), false);
});

test('mask history retains the latest twenty strokes and reset drops old session patches', () => {
  const image = canvas(64, 32), history = new MaskHistory(image);
  for (let i = 0; i < 24; i++) { history.begin(); history.capture(i, 1, i, 1); image.paint(i, 1, 1, 1, 255); history.update(i, 1, i, 1); history.commit(); }
  let undos = 0; while (history.undo()) undos++;
  assert.equal(undos, 20); assert.equal(image.alpha().filter(Boolean).length, 4);
  history.reset(); assert.equal(history.hasContent, false); assert.equal(history.undo(), false);
});
