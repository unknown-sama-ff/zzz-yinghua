import sharp from 'sharp';

/** Reconstruct hidden pixels from nearby background; keep all known pixels unchanged. */
export function fillBackground(rgb, alpha, width, height) {
  const count = width * height;
  const holes = new Uint8Array(count);
  const horizontal = new Uint8Array(count);
  const radius = 3;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    for (let dx = -radius; dx <= radius; dx++) if (x + dx >= 0 && x + dx < width && alpha[i + dx] > 12) { horizontal[i] = 1; break; }
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    for (let dy = -radius; dy <= radius; dy++) if (y + dy >= 0 && y + dy < height && horizontal[i + dy * width]) { holes[i] = 1; break; }
  }
  const output = Buffer.from(rgb);
  const seen = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0; let tail = 0;
  const neighbors = (i, visit) => {
    if (i % width) visit(i - 1);
    if (i % width < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < count - width) visit(i + width);
  };
  for (let i = 0; i < count; i++) if (!holes[i]) {
    let boundary = false;
    neighbors(i, (j) => { if (holes[j]) boundary = true; });
    if (boundary) { queue[tail++] = i; seen[i] = 1; }
  }
  if (!tail) throw new Error('没有足够的背景可用于分层');
  while (head < tail) {
    const i = queue[head++];
    neighbors(i, (j) => {
      if (!holes[j] || seen[j]) return;
      for (let c = 0; c < 3; c++) output[j * 3 + c] = output[i * 3 + c];
      seen[j] = 1; queue[tail++] = j;
    });
  }
  // A few diffusion steps soften the seams of the nearest-background propagation.
  for (let pass = 0; pass < 4; pass++) {
    const previous = Buffer.from(output);
    for (let i = 0; i < count; i++) if (holes[i]) {
      let weight = 4;
      const sums = [previous[i * 3] * 4, previous[i * 3 + 1] * 4, previous[i * 3 + 2] * 4];
      neighbors(i, (j) => { weight++; for (let c = 0; c < 3; c++) sums[c] += previous[j * 3 + c]; });
      for (let c = 0; c < 3; c++) output[i * 3 + c] = Math.round(sums[c] / weight);
    }
  }
  return output;
}

export async function createLayerImages(image, mask, maskWidth, maskHeight) {
  const { data: rgb, info } = await sharp(image, { limitInputPixels: 24_000_000 }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const resized = await sharp(mask, { raw: { width: maskWidth, height: maskHeight, channels: 1 } }).resize(width, height, { kernel: 'lanczos3' }).greyscale().raw().toBuffer();
  const alpha = Buffer.alloc(width * height);
  let opaque = 0;
  for (let i = 0; i < alpha.length; i++) {
    const value = Math.max(0, Math.min(1, (resized[i] / 255 - 0.12) / 0.76));
    alpha[i] = Math.round(value * value * (3 - 2 * value) * 255);
    if (alpha[i] > 128) opaque++;
  }
  const coverage = opaque / alpha.length;
  if (coverage < 0.02 || coverage > 0.9) throw new Error('这张图片暂时无法可靠地分离主体');
  const backgroundPixels = fillBackground(rgb, alpha, width, height);
  const [foreground, background] = await Promise.all([
    sharp(rgb, { raw: { width, height, channels: 3 } }).joinChannel(alpha, { raw: { width, height, channels: 1 } }).webp({ lossless: true }).toBuffer(),
    sharp(backgroundPixels, { raw: { width, height, channels: 3 } }).webp({ quality: 92 }).toBuffer(),
  ]);
  return { foreground, background, width, height, coverage };
}
