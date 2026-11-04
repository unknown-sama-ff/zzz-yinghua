/**
 * Independently implemented separable bilateral approximation, not a neural model
 * or a port of OpenCV. Two bounded 1-D passes use joint luma/chroma range weights.
 * The approximation is direction-dependent and can soften fine texture.
 */
export type DenoiseStrength = 'light' | 'medium' | 'strong';
export const LOCAL_DENOISE_MAX_PIXELS = 4_000_000;
export const LOCAL_DENOISE_MAX_SIDE = 8192;
export const DENOISE_STRENGTHS: { value: DenoiseStrength; label: string; hint: string }[] = [
  { value: 'light', label: '轻度', hint: '少量颗粒，优先保留纹理' },
  { value: 'medium', label: '标准', hint: '日常噪点与彩色杂点' },
  { value: 'strong', label: '较强', hint: '更强平滑，细小纹理可能损失' },
];
const PRESETS = {
  light: { radius: 2, spatial: 1.3, luma: 16, chroma: 24, lumaMix: 0.65, chromaMix: 0.85 },
  medium: { radius: 3, spatial: 1.8, luma: 25, chroma: 36, lumaMix: 0.8, chromaMix: 1 },
  strong: { radius: 4, spatial: 2.4, luma: 38, chroma: 52, lumaMix: 1, chromaMix: 1 },
} as const;

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
  const preset = PRESETS[strength];
  const lumaWeights = new Float32Array(256);
  const chromaWeights = new Float32Array(256);
  const alphaWeights = new Float32Array(256);
  const spatialWeights = new Float32Array(preset.radius + 1);
  for (let i = 0; i < 256; i++) {
    lumaWeights[i] = Math.exp(-i * i / (2 * preset.luma * preset.luma));
    chromaWeights[i] = Math.exp(-i * i / (2 * preset.chroma * preset.chroma));
    alphaWeights[i] = Math.exp(-i * i / (2 * 16 * 16));
  }
  for (let i = 0; i <= preset.radius; i++) spatialWeights[i] = Math.exp(-i * i / (2 * preset.spatial * preset.spatial));
  let source = rgba;
  onProgress?.(0);
  // Fixed radii (2..4): O(width * height * radius), two RGBA working buffers.
  for (let pass = 0; pass < 2; pass++) {
    const output = new Uint8ClampedArray(rgba.length);
    const step = pass === 0 ? 4 : width * 4;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = source[i], g = source[i + 1], b = source[i + 2], a = source[i + 3];
        output[i + 3] = a;
        if (a === 0) { output[i] = r; output[i + 1] = g; output[i + 2] = b; continue; }
        const coordinate = pass === 0 ? x : y;
        const extent = pass === 0 ? width : height;
        let total = 1, rr = r, gg = g, bb = b;
        for (let offset = -preset.radius; offset <= preset.radius; offset++) {
          if (offset === 0 || coordinate + offset < 0 || coordinate + offset >= extent) continue;
          const j = i + offset * step;
          if (source[j + 3] === 0) continue;
          const dr = source[j] - r, dg = source[j + 1] - g, db = source[j + 2] - b;
          // Y, Co and Cg differences. Joint chroma guards equal-luma color edges.
          const dy = Math.round(Math.abs((dr + 2 * dg + db) / 4));
          const dco = Math.round(Math.abs((dr - db) / 2));
          const dcg = Math.round(Math.abs((2 * dg - dr - db) / 4));
          const weight = spatialWeights[Math.abs(offset)] * lumaWeights[dy] * chromaWeights[dco] * chromaWeights[dcg] * alphaWeights[Math.abs(source[j + 3] - a)];
          total += weight; rr += source[j] * weight; gg += source[j + 1] * weight; bb += source[j + 2] * weight;
        }
        const dr = rr / total - r, dg = gg / total - g, db = bb / total - b;
        const dy = (dr + 2 * dg + db) / 4;
        const retainedLuma = dy * (preset.lumaMix - preset.chromaMix);
        output[i] = r + dr * preset.chromaMix + retainedLuma;
        output[i + 1] = g + dg * preset.chromaMix + retainedLuma;
        output[i + 2] = b + db * preset.chromaMix + retainedLuma;
      }
      if (y % 32 === 0 || y === height - 1) onProgress?.(Math.round((pass * height + y + 1) / (height * 2) * 100));
    }
    source = output;
  }
  return source;
}

export type DenoiseWorkerRequest = { type: 'prepare'; file: File } | { type: 'run'; strength: DenoiseStrength };
export type DenoiseWorkerResponse =
  | { type: 'ready'; width: number; height: number }
  | { type: 'progress'; percent: number }
  | { type: 'result'; blob: Blob; elapsedMs: number; strength: DenoiseStrength }
  | { type: 'error'; message: string };
