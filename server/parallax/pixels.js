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

function splitMatte(mask, width, height) {
  const count = width * height;
  const labels = new Int32Array(count);
  const queue = new Int32Array(count);
  const components = [];
  for (let start = 0; start < count; start++) {
    if (mask[start] < 10 || labels[start]) continue;
    const id = components.length + 1;
    let head = 0; let tail = 1; let strong = 0;
    let minX = width; let maxX = 0; let minY = height; let maxY = 0;
    queue[0] = start; labels[start] = id;
    while (head < tail) {
      const i = queue[head++]; const x = i % width; const y = Math.floor(i / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (mask[i] >= 160) strong++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx; const yy = y + dy; const next = yy * width + xx;
        if (xx < 0 || xx >= width || yy < 0 || yy >= height || labels[next] || mask[next] < 10) continue;
        labels[next] = id; queue[tail++] = next;
      }
    }
    components.push({ id, area: tail, strong, minX, maxX, minY, maxY });
  }
  const main = components.reduce((best, component) => component.strong > (best?.strong ?? 0) ? component : best, null);
  if (!main) throw new Error('这张图片暂时无法可靠地分离主体');
  const ownership = new Uint8Array(components.length + 1);
  const gap = Math.max(2, Math.round(Math.min(width, height) * 0.015));
  for (const component of components) {
    if (!component.strong || component.area < Math.max(3, count * 0.000015)) continue;
    const detached = component.maxX < main.minX - gap || component.minX > main.maxX + gap || component.maxY < main.minY - gap || component.minY > main.maxY + gap;
    const nearEdge = component.minX <= width * 0.01 || component.maxX >= width * 0.99 - 1 || component.maxY >= height * 0.99 - 1;
    // A binary saliency model cannot infer depth. Only detached, substantial edge scenery qualifies.
    ownership[component.id] = component !== main && detached && nearEdge && component.maxY >= height * 0.65 && component.area >= Math.max(16, count * 0.00025) && component.area < main.area * 0.4 ? 2 : 1;
  }
  const subject = Buffer.alloc(count); const foreground = Buffer.alloc(count); const combined = Buffer.alloc(count);
  let opaque = 0; let hasForeground = false;
  for (let i = 0; i < count; i++) {
    const owner = ownership[labels[i]];
    if (!owner) continue;
    const value = Math.max(0, Math.min(1, (mask[i] - 8) / 237));
    const alpha = Math.round(value * value * (3 - 2 * value) * 255);
    combined[i] = alpha;
    if (owner === 2) { foreground[i] = alpha; hasForeground ||= alpha > 128; }
    else subject[i] = alpha;
    if (alpha > 128) opaque++;
  }
  return { subject, foreground, combined, coverage: opaque / count, hasForeground };
}

function layerPixels(rgb, background, alpha) {
  const output = Buffer.alloc(alpha.length * 4);
  for (let i = 0; i < alpha.length; i++) {
    if (!alpha[i]) continue;
    // Solve source = alpha * layer + (1 - alpha) * background, raising alpha only
    // when necessary to keep the recovered edge colour within the RGB gamut.
    let opacity = alpha[i] / 255;
    for (let c = 0; c < 3; c++) {
      const source = rgb[i * 3 + c]; const back = background[i * 3 + c];
      if (source > back) opacity = Math.max(opacity, (source - back) / (255 - back));
      if (source < back) opacity = Math.max(opacity, (back - source) / back);
    }
    const quantized = Math.ceil(opacity * 255);
    for (let c = 0; c < 3; c++) output[i * 4 + c] = Math.round((rgb[i * 3 + c] - background[i * 3 + c] * (1 - quantized / 255)) / (quantized / 255));
    output[i * 4 + 3] = quantized;
  }
  return output;
}

export async function createLayerImages(image, mask, maskWidth, maskHeight) {
  const { data: rgb, info } = await sharp(image, { limitInputPixels: 24_000_000 }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const resized = await sharp(mask, { raw: { width: maskWidth, height: maskHeight, channels: 1 } }).resize(width, height, { kernel: 'lanczos3' }).greyscale().raw().toBuffer();
  const { subject: subjectAlpha, foreground: foregroundAlpha, combined, coverage, hasForeground } = splitMatte(resized, width, height);
  if (coverage < 0.02 || coverage > 0.9) throw new Error('这张图片暂时无法可靠地分离主体');
  const backgroundPixels = fillBackground(rgb, combined, width, height);
  // Keep pixels outside the retained matte exact. Dilation still excludes contaminated fill seeds.
  for (let i = 0; i < combined.length; i++) if (!combined[i]) for (let c = 0; c < 3; c++) backgroundPixels[i * 3 + c] = rgb[i * 3 + c];
  const [subject, foreground, background] = await Promise.all([
    sharp(layerPixels(rgb, backgroundPixels, subjectAlpha), { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toBuffer(),
    sharp(layerPixels(rgb, backgroundPixels, foregroundAlpha), { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toBuffer(),
    sharp(backgroundPixels, { raw: { width, height, channels: 3 } }).webp({ lossless: true }).toBuffer(),
  ]);
  return { subject, foreground, background, width, height, coverage, hasForeground };
}
