/**
 * Finite L0 gradient minimization (Xu et al., 2011), using the same joint-RGB
 * half-quadratic splitting as gpt-anime-denoise's l0_smooth. The screened
 * Poisson subproblem is solved with a radix-2 FFT. RGB pairs share one complex
 * transform because its denominator is real. No model or network is involved.
 *
 * Large images use reflected 256px tiles, a 32px halo and feathered overlaps.
 * This bounds working memory and avoids whole-image power-of-two padding. The
 * finite beta schedule and tiled boundary conditions differ from the reference.
 * Reference: https://github.com/CXP-2024/gpt-anime-denoise at
 * e21d4e0f974ff1179e8e2f0aec453df90b15effd, MIT license.
 * Attribution is included in docs/licenses/gpt-anime-denoise.txt.
 */
const CORE = 192;
const HALO = 32;
const OVERLAP = 32;
const STRIDE = CORE - OVERLAP;
const ALPHA_LEAF = 32;
type TileRegion = { x: number; y: number; width: number; height: number };

function powerOfTwo(value: number): number {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

function reflect(value: number, extent: number): number {
  if (extent === 1) return 0;
  const period = 2 * (extent - 1);
  const position = ((value % period) + period) % period;
  return position < extent ? position : period - position;
}

class FourierAxis {
  readonly reverse: Uint16Array;
  readonly cosine: Float64Array;
  readonly sine: Float64Array;

  constructor(readonly size: number) {
    this.reverse = new Uint16Array(size);
    this.cosine = new Float64Array(size / 2);
    this.sine = new Float64Array(size / 2);
    for (let i = 1; i < size; i++) this.reverse[i] = (this.reverse[i >> 1] >> 1) | ((i & 1) ? size >> 1 : 0);
    for (let i = 0; i < size / 2; i++) {
      this.cosine[i] = Math.cos(2 * Math.PI * i / size);
      this.sine[i] = Math.sin(2 * Math.PI * i / size);
    }
  }

  transform(data: Float64Array, offset: number, stride: number, inverse: boolean): void {
    const size = this.size;
    for (let i = 0; i < size; i++) {
      const reverse = this.reverse[i];
      if (reverse <= i) continue;
      const a = offset + i * stride, b = offset + reverse * stride;
      const real = data[a], imaginary = data[a + 1];
      data[a] = data[b]; data[a + 1] = data[b + 1];
      data[b] = real; data[b + 1] = imaginary;
    }
    for (let span = 2; span <= size; span *= 2) {
      const half = span / 2, frequencyStep = size / span;
      for (let start = 0; start < size; start += span) {
        for (let j = 0; j < half; j++) {
          const frequency = j * frequencyStep;
          const cosine = this.cosine[frequency];
          const sine = inverse ? this.sine[frequency] : -this.sine[frequency];
          const a = offset + (start + j) * stride, b = a + half * stride;
          const real = data[b] * cosine - data[b + 1] * sine;
          const imaginary = data[b] * sine + data[b + 1] * cosine;
          data[b] = data[a] - real; data[b + 1] = data[a + 1] - imaginary;
          data[a] += real; data[a + 1] += imaginary;
        }
      }
    }
  }
}

function transform2d(data: Float64Array, horizontal: FourierAxis, vertical: FourierAxis, inverse: boolean): void {
  const width = horizontal.size, height = vertical.size;
  for (let y = 0; y < height; y++) horizontal.transform(data, y * width * 2, 2, inverse);
  for (let x = 0; x < width; x++) vertical.transform(data, x * 2, width * 2, inverse);
  if (inverse) {
    const scale = 1 / (width * height);
    for (let i = 0; i < data.length; i++) data[i] *= scale;
  }
}

/** Also exported for numerical comparison with the periodic NumPy reference. */
export function l0SmoothPeriodic(
  rgb: Float64Array, width: number, height: number, lambda: number, betaMax = 64,
): Float64Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 256 || height > 256 || (width & (width - 1)) || (height & (height - 1)) ||
      rgb.length !== width * height * 3 || !Number.isFinite(lambda) || lambda <= 0 ||
      !Number.isFinite(betaMax) || betaMax <= 2 * lambda) throw new Error('Invalid L0 tile parameters.');
  const count = width * height;
  const horizontal = new FourierAxis(width), vertical = new FourierAxis(height);
  const sourceRG = new Float64Array(count * 2), sourceB = new Float64Array(count * 2);
  const spectrumRG = new Float64Array(count * 2), spectrumB = new Float64Array(count * 2);
  const h = new Float64Array(count * 3), v = new Float64Array(count * 3);
  const solution = new Float64Array(rgb);
  const laplacian = new Float64Array(count);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    sourceRG[i * 2] = rgb[i * 3]; sourceRG[i * 2 + 1] = rgb[i * 3 + 1];
    sourceB[i * 2] = rgb[i * 3 + 2];
    laplacian[i] = 4 - 2 * Math.cos(2 * Math.PI * x / width) - 2 * Math.cos(2 * Math.PI * y / height);
  }
  transform2d(sourceRG, horizontal, vertical, false);
  transform2d(sourceB, horizontal, vertical, false);
  for (let beta = 2 * lambda; beta < betaMax; beta *= 2) {
    const threshold = lambda / beta;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const right = (y * width + (x + 1) % width) * 3;
      const down = (((y + 1) % height) * width + x) * 3;
      let magnitude = 0;
      for (let c = 0; c < 3; c++) {
        h[i + c] = solution[right + c] - solution[i + c];
        v[i + c] = solution[down + c] - solution[i + c];
        magnitude += h[i + c] ** 2 + v[i + c] ** 2;
      }
      if (magnitude < threshold) for (let c = 0; c < 3; c++) { h[i + c] = 0; v[i + c] = 0; }
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const pixel = y * width + x, i = pixel * 3;
      const left = (y * width + (x + width - 1) % width) * 3;
      const up = (((y + height - 1) % height) * width + x) * 3;
      spectrumRG[pixel * 2] = h[left] - h[i] + v[up] - v[i];
      spectrumRG[pixel * 2 + 1] = h[left + 1] - h[i + 1] + v[up + 1] - v[i + 1];
      spectrumB[pixel * 2] = h[left + 2] - h[i + 2] + v[up + 2] - v[i + 2];
      spectrumB[pixel * 2 + 1] = 0;
    }
    transform2d(spectrumRG, horizontal, vertical, false);
    transform2d(spectrumB, horizontal, vertical, false);
    for (let i = 0; i < count; i++) {
      const denominator = 1 + beta * laplacian[i];
      for (let c = 0; c < 2; c++) {
        spectrumRG[i * 2 + c] = (sourceRG[i * 2 + c] + beta * spectrumRG[i * 2 + c]) / denominator;
        spectrumB[i * 2 + c] = (sourceB[i * 2 + c] + beta * spectrumB[i * 2 + c]) / denominator;
      }
    }
    transform2d(spectrumRG, horizontal, vertical, true);
    transform2d(spectrumB, horizontal, vertical, true);
    for (let i = 0; i < count; i++) {
      solution[i * 3] = spectrumRG[i * 2]; solution[i * 3 + 1] = spectrumRG[i * 2 + 1];
      solution[i * 3 + 2] = spectrumB[i * 2];
    }
  }
  return solution;
}

function feather(coordinate: number, start: number, size: number, extent: number): number {
  const leading = start === 0 ? 1 : Math.min(1, (coordinate + 0.5) / OVERLAP);
  const trailing = start + size === extent ? 1 : Math.min(1, (size - coordinate - 0.5) / OVERLAP);
  return leading * trailing;
}

export function l0Denoise(
  rgba: Uint8ClampedArray, width: number, height: number, lambda: number,
  onProgress?: (percent: number) => void,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(rgba);
  let firstVisible = -1, constantImage = true;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    if (firstVisible < 0) firstVisible = i;
    if (rgba[i] !== rgba[firstVisible] || rgba[i + 1] !== rgba[firstVisible + 1] || rgba[i + 2] !== rgba[firstVisible + 2]) {
      constantImage = false;
      break;
    }
  }
  if (constantImage) { onProgress?.(100); return output; }
  const weights = new Float32Array(width * height);
  const columns = Math.max(1, Math.ceil((width - OVERLAP) / STRIDE));
  const rows = Math.max(1, Math.ceil((height - OVERLAP) / STRIDE));
  function processTile(region: TileRegion, blendRegion: TileRegion): void {
    const { x: startX, y: startY, width: coreWidth, height: coreHeight } = region;
    const offsetX = width === 1 ? 0 : HALO, offsetY = height === 1 ? 0 : HALO;
    const tileWidth = powerOfTwo(coreWidth + offsetX * 2), tileHeight = powerOfTwo(coreHeight + offsetY * 2);
    const tile = new Float64Array(tileWidth * tileHeight * 3);
    // FFT solves require constant pixel weights. Subdivide mixed-alpha cores
    // until their complete halo has uniform alpha, or preserve a small leaf.
    // Thus transparent components and unequal opacity never enter one solve,
    // while opaque interiors of otherwise transparent images still denoise.
    let mixedAlpha = false;
    const firstAlpha = rgba[(reflect(startY - offsetY, height) * width + reflect(startX - offsetX, width)) * 4 + 3];
    for (let y = 0; y < tileHeight; y++) for (let x = 0; x < tileWidth; x++) {
      const source = (reflect(startY + y - offsetY, height) * width + reflect(startX + x - offsetX, width)) * 4;
      const pixel = y * tileWidth + x;
      if (rgba[source + 3] !== firstAlpha) mixedAlpha = true;
      for (let c = 0; c < 3; c++) tile[pixel * 3 + c] = rgba[source + c] / 255;
    }
    if (mixedAlpha && Math.max(coreWidth, coreHeight) > ALPHA_LEAF) {
      if (coreWidth >= coreHeight) {
        const firstWidth = Math.floor(coreWidth / 2);
        processTile({ x: startX, y: startY, width: firstWidth, height: coreHeight }, blendRegion);
        processTile({ x: startX + firstWidth, y: startY, width: coreWidth - firstWidth, height: coreHeight }, blendRegion);
      } else {
        const firstHeight = Math.floor(coreHeight / 2);
        processTile({ x: startX, y: startY, width: coreWidth, height: firstHeight }, blendRegion);
        processTile({ x: startX, y: startY + firstHeight, width: coreWidth, height: coreHeight - firstHeight }, blendRegion);
      }
      return;
    }
    let constant = true;
    for (let i = 3; i < tile.length && constant; i++) constant = tile[i] === tile[i % 3];
    const smoothed = mixedAlpha || firstAlpha === 0 || constant ? tile : l0SmoothPeriodic(tile, tileWidth, tileHeight, lambda);
    for (let y = 0; y < coreHeight; y++) for (let x = 0; x < coreWidth; x++) {
      const pixel = (startY + y) * width + startX + x, destination = pixel * 4;
      if (rgba[destination + 3] === 0) continue;
      const weight = feather(startX + x - blendRegion.x, blendRegion.x, blendRegion.width, width) *
        feather(startY + y - blendRegion.y, blendRegion.y, blendRegion.height, height);
      const total = weights[pixel] + weight;
      const source = ((y + offsetY) * tileWidth + x + offsetX) * 3;
      for (let c = 0; c < 3; c++) {
        const value = Math.max(0, Math.min(255, smoothed[source + c] * 255));
        output[destination + c] = (output[destination + c] * weights[pixel] + value * weight) / total;
      }
      weights[pixel] = total;
    }
  }
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const x = column * STRIDE, y = row * STRIDE;
    const region = { x, y, width: Math.min(CORE, width - x), height: Math.min(CORE, height - y) };
    processTile(region, region);
    onProgress?.(Math.round(((row * columns + column + 1) / (rows * columns)) * 100));
  }
  return output;
}
