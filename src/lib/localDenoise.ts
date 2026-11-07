import { l0Denoise } from './l0Denoise';

export type DenoiseStrength = 'light' | 'medium' | 'strong';
export const LOCAL_DENOISE_MAX_PIXELS = 4_000_000;
export const LOCAL_DENOISE_MAX_SIDE = 8192;
export const DENOISE_STRENGTHS: { value: DenoiseStrength; label: string; hint: string }[] = [
  { value: 'light', label: '轻度', hint: '轻微纹理，优先保留细节' },
  { value: 'medium', label: '标准', hint: '压低平涂区域的鱼鳞纹与杂点' },
  { value: 'strong', label: '较强', hint: '更强平涂，细纹与柔和渐变可能损失' },
];
const PRESETS = {
  light: { lambda: 0.0005, radius: 2, spatial: 1.3, luma: 16, chroma: 24, lumaMix: 0.65, chromaMix: 0.85 },
  medium: { lambda: 0.001, radius: 3, spatial: 1.8, luma: 25, chroma: 36, lumaMix: 0.8, chromaMix: 1 },
  strong: { lambda: 0.002, radius: 4, spatial: 2.4, luma: 38, chroma: 52, lumaMix: 1, chromaMix: 1 },
} as const;

/** Robust high-frequency estimate distinguishes independent grain from slowly varying fine texture. */
function estimateGrain(rgba: Uint8ClampedArray, width: number, height: number): number {
  const offsets: number[] = [];
  if (width >= 3) offsets.push(-4, 4);
  if (height >= 3) offsets.push(-width * 4, width * 4);
  if (!offsets.length) return 0;
  const histogram = new Uint32Array(1021);
  const stride = Math.max(1, Math.floor(Math.sqrt(width * height / 65536)));
  const firstX = width >= 3 ? 1 : 0, lastX = width >= 3 ? width - 1 : width;
  const firstY = height >= 3 ? 1 : 0, lastY = height >= 3 ? height - 1 : height;
  let samples = 0;
  for (let y = firstY; y < lastY; y += stride) for (let x = firstX; x < lastX; x += stride) {
    const i = (y * width + x) * 4;
    if (!rgba[i + 3] || offsets.some((offset) => rgba[i + offset + 3] !== rgba[i + 3])) continue;
    for (let c = 0; c < 3; c++) {
      let difference = rgba[i + c] * offsets.length;
      for (const offset of offsets) difference -= rgba[i + offset + c];
      histogram[Math.abs(difference)]++; samples++;
    }
  }
  if (samples < 16) return 0;
  let cumulative = 0;
  for (let difference = 0; difference < histogram.length; difference++) {
    cumulative += histogram[difference];
    if (cumulative >= samples / 2) return difference / (0.67448975 * Math.sqrt(offsets.length ** 2 + offsets.length));
  }
  return 0;
}

/** Reuse the existing joint luma/chroma filter only for substantial independent grain. */
function reduceGrain(
  rgba: Uint8ClampedArray, width: number, height: number, preset: typeof PRESETS[DenoiseStrength],
  onProgress?: (percent: number) => void,
): Uint8ClampedArray {
  const lumaWeights = new Float32Array(256), chromaWeights = new Float32Array(256);
  const spatialWeights = new Float32Array(preset.radius + 1);
  for (let i = 0; i < 256; i++) {
    lumaWeights[i] = Math.exp(-i * i / (2 * preset.luma * preset.luma));
    chromaWeights[i] = Math.exp(-i * i / (2 * preset.chroma * preset.chroma));
  }
  for (let i = 0; i <= preset.radius; i++) spatialWeights[i] = Math.exp(-i * i / (2 * preset.spatial * preset.spatial));
  const directions = [-1, 1];
  let source = rgba;
  for (let pass = 0; pass < 2; pass++) {
    const output = new Uint8ClampedArray(rgba.length);
    const step = pass === 0 ? 4 : width * 4;
    const extent = pass === 0 ? width : height;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = source[i], g = source[i + 1], b = source[i + 2], alpha = source[i + 3];
        output[i + 3] = alpha;
        if (!alpha) { output[i] = r; output[i + 1] = g; output[i + 2] = b; continue; }
        const coordinate = pass === 0 ? x : y;
        let total = 1, red = r, green = g, blue = b;
        for (const direction of directions) for (let distance = 1; distance <= preset.radius; distance++) {
          const neighbor = coordinate + direction * distance;
          if (neighbor < 0 || neighbor >= extent) break;
          const j = i + direction * distance * step;
          // Stop at alpha boundaries so the filter cannot jump across a transparent gap.
          if (source[j + 3] !== alpha) break;
          const dr = source[j] - r, dg = source[j + 1] - g, db = source[j + 2] - b;
          const luma = Math.round(Math.abs((dr + 2 * dg + db) / 4));
          const co = Math.round(Math.abs((dr - db) / 2));
          const cg = Math.round(Math.abs((2 * dg - dr - db) / 4));
          const weight = spatialWeights[distance] * lumaWeights[luma] * chromaWeights[co] * chromaWeights[cg];
          total += weight; red += source[j] * weight; green += source[j + 1] * weight; blue += source[j + 2] * weight;
        }
        const dr = red / total - r, dg = green / total - g, db = blue / total - b;
        const luma = (dr + 2 * dg + db) / 4;
        const retainedLuma = luma * (preset.lumaMix - preset.chromaMix);
        output[i] = r + dr * preset.chromaMix + retainedLuma;
        output[i + 1] = g + dg * preset.chromaMix + retainedLuma;
        output[i + 2] = b + db * preset.chromaMix + retainedLuma;
      }
      if (y % 32 === 0 || y === height - 1) onProgress?.(Math.round((pass * height + y + 1) / (height * 2) * 20));
    }
    source = output;
  }
  return source;
}

export function validateDenoiseDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('图片尺寸无效。');
  if (width > LOCAL_DENOISE_MAX_SIDE || height > LOCAL_DENOISE_MAX_SIDE || width * height > LOCAL_DENOISE_MAX_PIXELS) {
    throw new Error('为保证浏览器稳定，最多支持 400 万像素，且单边不超过 8192 像素。请先缩小图片。');
  }
}

export function denoisePixels(
  rgba: Uint8ClampedArray, width: number, height: number, strength: DenoiseStrength,
  onProgress?: (percent: number) => void,
): Uint8ClampedArray {
  validateDenoiseDimensions(width, height);
  if (rgba.length !== width * height * 4) throw new Error('图片像素数据不完整。');
  if (!Object.prototype.hasOwnProperty.call(PRESETS, strength)) throw new Error('不支持的降噪强度。');
  onProgress?.(0);
  const preset = PRESETS[strength];
  if (estimateGrain(rgba, width, height) < 8) return l0Denoise(rgba, width, height, preset.lambda, onProgress);
  const prepared = reduceGrain(rgba, width, height, preset, onProgress);
  return l0Denoise(prepared, width, height, preset.lambda, (percent) => onProgress?.(20 + Math.round(percent * 0.8)));
}

export type DenoiseWorkerRequest = { type: 'prepare'; file: File } | { type: 'run'; strength: DenoiseStrength };
export type DenoiseWorkerResponse =
  | { type: 'ready'; width: number; height: number }
  | { type: 'progress'; percent: number }
  | { type: 'result'; blob: Blob; elapsedMs: number; strength: DenoiseStrength }
  | { type: 'error'; message: string };
