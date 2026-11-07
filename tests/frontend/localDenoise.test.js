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

test('adaptive processing reduces stronger independent RGB grain at all strengths', () => {
  const clean = image(80, 64, () => [110, 135, 160]);
  const input = noisy(clean, 20);
  const initial = new Uint8ClampedArray(input);
  const errors = ['light', 'medium', 'strong'].map((strength) => mse(denoisePixels(input, 80, 64, strength), clean));
  for (const error of errors) assert.ok(error < mse(input, clean) * 0.45, `${error} should remove most variance`);
  assert.ok(errors[2] <= errors[1] && errors[1] < errors[0]);
  assert.deepEqual(input, initial, 'processing must not mutate the source');
});

test('step edges keep contrast and outperform box blur on whole-image error', () => {
  const width = 96, height = 64;
  const clean = image(width, height, (x) => x < width / 2 ? [35, 45, 55] : [205, 215, 225]);
  const input = noisy(clean, 20);
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

const { l0SmoothPeriodic, l0Denoise } = await loadFrontend("export * from './src/lib/l0Denoise';");

test('periodic FFT solver matches the pinned NumPy L0 oracle', () => {
  // Generated directly with upstream l0_smooth(img, .001, beta_max=64),
  // CXP-2024/gpt-anime-denoise e21d4e0f974ff1179e8e2f0aec453df90b15effd.
  const input = Float64Array.from({ length: 48 }, (_, i) => {
    const c = i % 3, pixel = Math.floor(i / 3), x = pixel % 4, y = Math.floor(pixel / 4);
    return .25 + .4 * Number(x >= 2) + .015 * Math.sin(x * 3 + y * 2 + c);
  });
  const expected = [
    .25025167308322877,.24955330681830556,.24926562820313058,.2510650566536383,.2481194537952375,.24690281644155415,
    .6505216019092649,.6498546189451927,.6493212986551741,.6516190443531491,.6487369780034291,.6470161282675149,
    .24963184071024652,.2500006430185914,.2503688541398898,.24497916540904532,.2488395689451797,.253766867446832,
    .6496478355261933,.6498933670929551,.6502369364599947,.6447082910233677,.6475999043524664,.6526981545303787,
    .25063576012463357,.2510812753770246,.2505326710336315,.253430843409747,.25583248421496146,.25287176592976646,
    .6503550858751074,.6510656980694257,.6507965123779235,.6521619133333025,.6556326429050621,.6539247465876046,
    .25051443619864283,.24957722562980514,.24902871186805436,.25135692817255945,.24834262908969854,.24685210917901276,
    .6508039998855925,.6499558580219386,.6491483000841356,.6518612062205662,.6489318114736323,.6469845043154636,
  ];
  const output = l0SmoothPeriodic(input, 4, 4, .001);
  for (let i = 0; i < expected.length; i++) assert.ok(Math.abs(output[i] - expected[i]) < 1e-10, `oracle mismatch at ${i}`);
});

test('correlated fish-scale texture is flattened across tile overlaps', () => {
  const width = 384, height = 224;
  const clean = image(width, height, (x, y) => x > y + 100 ? [190, 150, 130] : [100, 130, 170]);
  const input = image(width, height, (x, y) => {
    const i = (y * width + x) * 4;
    const ripple = 6 * Math.sin(x * .3 + y * .35) * Math.cos(y * .22);
    return [clean[i] + ripple, clean[i + 1] + ripple * .8, clean[i + 2] - ripple * .6];
  });
  const progress = [];
  const output = denoisePixels(input, width, height, 'medium', (value) => progress.push(value));
  assert.deepEqual(output, l0Denoise(input, width, height, .001), 'fine correlated texture bypasses grain preconditioning');
  assert.ok(mse(output, clean) < mse(input, clean) * .2);
  let seam = 0, interior = 0, seamCount = 0, interiorCount = 0;
  for (let y = 4; y < height - 4; y++) for (let x = 4; x < width - 4; x++) {
    if (Math.abs(x - y - 100) < 4) continue;
    const i = (y * width + x) * 4;
    const error = (output[i] - clean[i]) ** 2;
    if (x >= 156 && x <= 196) { seam += error; seamCount++; }
    else { interior += error; interiorCount++; }
  }
  assert.ok(seam / seamCount < interior / interiorCount + 1, 'overlap must not introduce a visible band');
  assert.equal(progress.at(-1), 100);
  assert.deepEqual(progress, [...progress].sort((a, b) => a - b));
});

test('thin diagonal lines and soft color gradients retain their shape', () => {
  const width = 224, height = 128;
  const gradient = image(width, height, (x, y) => [120 + x * .12, 135 + y * .08, 155 + x * .06]);
  const smoothed = denoisePixels(gradient, width, height, 'medium');
  assert.ok(mse(smoothed, gradient) < 1, 'gentle ramps must not become broad color bands');
  const lines = image(width, height, (x, y) => Math.abs(x - y) <= 0 || x === 110 ? [30, 25, 35] : [210, 200, 190]);
  const output = denoisePixels(lines, width, height, 'strong');
  assert.ok(mse(output, lines) < 2);
  for (let y = 2; y < height - 2; y++) assert.ok(output[(y * width + y) * 4] < 45);
});

test('transparent components and unequal opacity never exchange color', () => {
  const width = 64, height = 24;
  const input = image(width, height, (x) => x < 30 ? [220, 20, 30] : [20, 40, 220]);
  for (let y = 0; y < height; y++) {
    input.set([0, 255, 0, 0], (y * width + 30) * 4);
    input[(y * width + 31) * 4 + 3] = 128;
  }
  assert.deepEqual(denoisePixels(input, width, height, 'strong'), input);
  const changedHidden = new Uint8ClampedArray(input);
  for (let y = 0; y < height; y++) changedHidden.set([255, 0, 255, 0], (y * width + 30) * 4);
  const changedOutput = denoisePixels(changedHidden, width, height, 'strong');
  for (let i = 0; i < input.length; i += 4) {
    if (input[i + 3] > 0) assert.deepEqual(changedOutput.slice(i, i + 4), input.slice(i, i + 4));
  }
});

test('long narrow images keep bounded tiles and image dimensions', () => {
  const input = image(8192, 1, (x) => [80 + Math.round(3 * Math.sin(x)), 100, 120]);
  const output = denoisePixels(input, 8192, 1, 'light');
  assert.equal(output.length, input.length);
  assert.ok(output.every((value) => Number.isFinite(value)));
});

test('grain preconditioning preserves alpha barriers, hidden RGB and progress', () => {
  const width = 96, height = 48;
  const input = noisy(image(width, height, (x) => x < 45 ? [185, 65, 75] : [45, 70, 185]), 20);
  for (let y = 0; y < height; y++) {
    input.set([0, 255, 0, 0], (y * width + 45) * 4);
    input[(y * width + 46) * 4 + 3] = 128;
  }
  const initial = new Uint8ClampedArray(input);
  const progress = [];
  const output = denoisePixels(input, width, height, 'medium', (percent) => progress.push(percent));
  const changedHidden = new Uint8ClampedArray(input);
  for (let y = 0; y < height; y++) changedHidden.set([255, 0, 255, 0], (y * width + 45) * 4);
  const changedOutput = denoisePixels(changedHidden, width, height, 'medium');
  for (let i = 0; i < input.length; i += 4) {
    assert.equal(output[i + 3], input[i + 3]);
    if (input[i + 3]) assert.deepEqual(output.slice(i, i + 4), changedOutput.slice(i, i + 4));
    else assert.deepEqual(output.slice(i, i + 4), input.slice(i, i + 4));
  }
  assert.deepEqual(input, initial);
  assert.ok(progress.includes(20), 'strong grain runs the preliminary pass');
  assert.equal(progress.at(-1), 100);
  assert.deepEqual(progress, [...progress].sort((a, b) => a - b));
});

test('mixed-alpha images still denoise their opaque interiors', () => {
  const width = 256, height = 128;
  const clean = image(width, height, () => [100, 130, 160]);
  const input = noisy(clean, 6);
  for (let y = 0; y < height; y++) for (let x = 0; x < 16; x++) {
    const i = (y * width + x) * 4;
    input[i + 3] = clean[i + 3] = x < 8 ? 0 : 128;
  }
  const original = new Uint8ClampedArray(input);
  const output = denoisePixels(input, width, height, 'medium');
  assert.ok(mse(output, clean) < mse(input, clean) * .4, 'a narrow alpha strip cannot bypass the whole image');
  for (let i = 0; i < input.length; i += 4) {
    assert.equal(output[i + 3], input[i + 3]);
    if (i / 4 % width < 17) assert.deepEqual(output.slice(i, i + 4), input.slice(i, i + 4));
  }
  assert.deepEqual(input, original);
});
