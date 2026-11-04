import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';

const { denoisePixels, validateDenoiseDimensions } = await loadFrontend("export * from './src/lib/localDenoise';");
function image(width, height, color) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set([...color(x, y), 255], (y * width + x) * 4);
  return rgba;
}
function noisy(clean, amplitude = 20) {
  let seed = 42;
  return clean.map((value, i) => {
    if (i % 4 === 3) return value;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return value + (seed / 2 ** 32 * 2 - 1) * amplitude;
  });
}
function mse(result, clean) {
  let sum = 0;
  for (let i = 0; i < clean.length; i++) if (i % 4 !== 3) sum += (result[i] - clean[i]) ** 2;
  return sum / (clean.length / 4 * 3);
}
function boxBlur(input, width, height) {
  return image(width, height, (x, y) => {
    const sums = [0, 0, 0]; let count = 0;
    for (let yy = Math.max(0, y - 2); yy <= Math.min(height - 1, y + 2); yy++) for (let xx = Math.max(0, x - 2); xx <= Math.min(width - 1, x + 2); xx++) {
      for (let c = 0; c < 3; c++) sums[c] += input[(yy * width + xx) * 4 + c];
      count++;
    }
    return sums.map((sum) => sum / count);
  });
}

test('local bilateral reduces deterministic flat RGB noise at all strengths', () => {
  const clean = image(80, 64, () => [110, 135, 160]);
  const input = noisy(clean);
  const initial = new Uint8ClampedArray(input);
  const errors = ['light', 'medium', 'strong'].map((strength) => mse(denoisePixels(input, 80, 64, strength), clean));
  for (const error of errors) assert.ok(error < mse(input, clean) * 0.45, `${error} should remove most variance`);
  assert.ok(errors[2] < errors[1] && errors[1] < errors[0]);
  assert.deepEqual(input, initial, 'processing must not mutate the source');
});

test('step edges keep contrast and outperform box blur on whole-image error', () => {
  const width = 96, height = 64;
  const clean = image(width, height, (x) => x < width / 2 ? [35, 45, 55] : [205, 215, 225]);
  const input = noisy(clean);
  const output = denoisePixels(input, width, height, 'medium');
  const blurred = boxBlur(input, width, height);
  assert.ok(mse(output, clean) < mse(input, clean) * 0.3);
  assert.ok(mse(output, clean) < mse(blurred, clean) * 0.3);
  let edgeContrast = 0;
  for (let y = 0; y < height; y++) edgeContrast += output[(y * width + width / 2) * 4] - output[(y * width + width / 2 - 1) * 4];
  assert.ok(edgeContrast / height > 160, '170-level step should remain sharp');
});

test('equal-luma chromatic edges are protected as well as luminance edges', () => {
  const width = 64, height = 32;
  const clean = image(width, height, (x) => x < width / 2 ? [210, 55, 55] : [55, 55, 210]);
  const output = denoisePixels(noisy(clean, 12), width, height, 'strong');
  assert.ok(mse(output, clean) < 12);
  for (let y = 0; y < height; y++) {
    assert.ok(output[(y * width + 31) * 4] > 195);
    assert.ok(output[(y * width + 32) * 4 + 2] > 195);
  }
});

test('constant images, single pixels, alpha and hidden transparent RGB remain intact', () => {
  const constant = image(7, 11, () => [91, 112, 133]);
  assert.deepEqual(denoisePixels(constant, 7, 11, 'medium'), constant);
  const pixel = new Uint8ClampedArray([1, 2, 3, 17]);
  assert.deepEqual(denoisePixels(pixel, 1, 1, 'strong'), pixel);
  const input = image(16, 8, () => [100, 130, 160]);
  for (let i = 0; i < input.length; i += 4) input[i + 3] = i % 256;
  input.set([250, 0, 250, 0], 0);
  const output = denoisePixels(input, 16, 8, 'strong');
  for (let i = 3; i < input.length; i += 4) assert.equal(output[i], input[i]);
  assert.deepEqual(output.slice(0, 4), input.slice(0, 4));
  assert.deepEqual(output.slice(4, 7), input.slice(4, 7), 'hidden colors cannot contaminate visible neighbors');
});

test('resource limits and malformed buffers reject before processing; progress completes monotonically', () => {
  assert.throws(() => validateDenoiseDimensions(2001, 2000), /400 万像素/);
  assert.throws(() => validateDenoiseDimensions(8193, 1), /8192/);
  assert.throws(() => validateDenoiseDimensions(1.5, 20), /尺寸无效/);
  assert.throws(() => denoisePixels(new Uint8ClampedArray(8), 1, 1, 'medium'), /不完整/);
  assert.throws(() => denoisePixels(new Uint8ClampedArray(4), 1, 1, '__proto__'), /强度/);
  const progress = [];
  denoisePixels(image(3, 73, () => [70, 80, 90]), 3, 73, 'light', (value) => progress.push(value));
  assert.equal(progress[0], 0); assert.equal(progress.at(-1), 100);
  assert.deepEqual(progress, [...progress].sort((a, b) => a - b));
});
