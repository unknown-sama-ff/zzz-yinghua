import sharp from 'sharp';

function dilateMatte(alpha, width, height, radius, threshold = 0) {
  const count = width * height;
  const expanded = Buffer.alloc(count);
  const horizontal = new Uint8Array(count);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    for (let dx = -radius; dx <= radius; dx++) if (x + dx >= 0 && x + dx < width && alpha[i + dx] > threshold) { horizontal[i] = 1; break; }
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    for (let dy = -radius; dy <= radius; dy++) if (y + dy >= 0 && y + dy < height && horizontal[i + dy * width]) { expanded[i] = 255; break; }
  }
  return expanded;
}

/** Reconstruct hidden pixels from nearby background; keep all known pixels unchanged. */
export function fillBackground(rgb, alpha, width, height) {
  const count = width * height;
  const holes = dilateMatte(alpha, width, height, 3, 12);
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
  // Dilation excludes contaminated fill seeds, while known pixels remain exact.
  for (let i = 0; i < count; i++) {
    if (alpha[i]) continue;
    for (let c = 0; c < 3; c++) output[i * 3 + c] = rgb[i * 3 + c];
  }
  return output;
}

function matteComponents(mask, width, height) {
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
  return { labels, components };
}

function splitMatte(mask, width, height) {
  const count = width * height;
  const { labels, components } = matteComponents(mask, width, height);
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
  let opaque = 0;
  for (let i = 0; i < count; i++) {
    const owner = ownership[labels[i]];
    if (!owner) continue;
    const value = Math.max(0, Math.min(1, (mask[i] - 8) / 237));
    const alpha = Math.round(value * value * (3 - 2 * value) * 255);
    combined[i] = alpha;
    if (owner === 2) foreground[i] = alpha;
    else subject[i] = alpha;
    if (alpha > 128) opaque++;
  }
  return { subject, foreground, combined, coverage: opaque / count };
}

function histogramPercentile(histogram, count, fraction) {
  let total = 0;
  for (let value = 0; value < histogram.length; value++) {
    total += histogram[value];
    if (total >= count * fraction) return value;
  }
  return 255;
}

async function preserveNearObjects(matte, values, rgb, reference, referenceLuminance, width, height) {
  const contrast = Buffer.alloc(matte.length);
  for (let y = Math.floor(height * 0.45); y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    const luminance = rgb[i * 3] * 0.2126 + rgb[i * 3 + 1] * 0.7152 + rgb[i * 3 + 2] * 0.0722;
    if (values[i] >= reference - 18 && Math.abs(luminance - referenceLuminance) >= 64) contrast[i] = 255;
  }
  const { labels, components } = matteComponents(contrast, width, height);
  const overlaps = new Uint32Array(components.length + 1);
  for (let i = 0; i < matte.length; i++) if (matte[i] > 32) overlaps[labels[i]]++;
  const retained = new Set(components.filter((component) => {
    const boundsArea = (component.maxX - component.minX + 1) * (component.maxY - component.minY + 1);
    return component.area >= Math.max(6, matte.length * 0.0005)
      && component.area <= matte.length * 0.08
      && component.area / boundsArea >= 0.35
      && overlaps[component.id] >= Math.max(4, component.area * 0.02);
  }).map((component) => component.id));
  if (!retained.size) return matte;
  for (let i = 0; i < contrast.length; i++) contrast[i] = retained.has(labels[i]) ? 255 : 0;
  // Include highlights enclosed by an opaque prop, such as a ring inside its dark box.
  const inverse = contrast.map((value) => 255 - value);
  const holes = matteComponents(inverse, width, height);
  const enclosed = new Set(holes.components.filter((component) =>
    component.minX > 0 && component.maxX < width - 1
    && component.minY > 0 && component.maxY < height - 1
    && component.area < matte.length * 0.08,
  ).map((component) => component.id));
  for (let i = 0; i < contrast.length; i++) if (enclosed.has(holes.labels[i])) contrast[i] = 255;
  const expanded = dilateMatte(contrast, width, height, Math.max(2, Math.round(Math.min(width, height) * 0.008)));
  const softened = await sharp(expanded, { raw: { width, height, channels: 1 } }).blur(0.6).greyscale().raw().toBuffer();
  for (let i = 0; i < matte.length; i++) matte[i] = Math.max(matte[i], softened[i]);
  return matte;
}

async function depthForeground(depth, subject, rgb, width, height) {
  if (!Number.isInteger(depth.width) || !Number.isInteger(depth.height)
    || depth.width < 1 || depth.height < 1 || depth.width * depth.height > 1024 * 1024
    || !Buffer.isBuffer(depth.data) || depth.data.length !== depth.width * depth.height) {
    throw new Error('前景深度图尺寸无效');
  }
  const values = await sharp(depth.data, { raw: { width: depth.width, height: depth.height, channels: 1 } }).resize(width, height, { kernel: 'cubic' }).greyscale().raw().toBuffer();
  const mainHistogram = new Uint32Array(256);
  const luminanceHistogram = new Uint32Array(256);
  const nearHistogram = new Uint32Array(256);
  let mainCount = 0; let nearCount = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (subject[i] >= 160 && x >= width * 0.2 && x <= width * 0.8 && y >= height * 0.12 && y <= height * 0.62) {
      mainHistogram[values[i]]++;
      luminanceHistogram[Math.round(rgb[i * 3] * 0.2126 + rgb[i * 3 + 1] * 0.7152 + rgb[i * 3 + 2] * 0.0722)]++;
      mainCount++;
    }
    if (y >= height * 0.45) { nearHistogram[values[i]]++; nearCount++; }
  }
  const matte = Buffer.alloc(width * height);
  if (!mainCount) return matte;
  const reference = histogramPercentile(mainHistogram, mainCount, 0.65);
  const nearest = histogramPercentile(nearHistogram, nearCount, 0.995);
  const separation = nearest - reference;
  if (separation < 28) return matte;
  const start = reference + separation * 0.4;
  const solid = reference + separation * 0.75;
  for (let i = 0; i < matte.length; i++) {
    const value = Math.max(0, Math.min(1, (values[i] - start) / (solid - start)));
    matte[i] = Math.round(value * value * (3 - 2 * value) * 255);
  }
  const { labels, components } = matteComponents(matte, width, height);
  const accepted = new Set(components.filter((component) =>
    component.strong >= matte.length * 0.001
    && component.area >= matte.length * 0.003 && component.area <= matte.length * 0.4
    && component.minY >= height * 0.4 && component.maxY >= height * 0.75,
  ).map((component) => component.id));
  for (let i = 0; i < matte.length; i++) if (!accepted.has(labels[i])) matte[i] = 0;
  return preserveNearObjects(matte, values, rgb, reference, histogramPercentile(luminanceHistogram, mainCount, 0.5), width, height);
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

export async function createLayerImages(image, mask, maskWidth, maskHeight, { depth } = {}) {
  const { data: rgb, info } = await sharp(image, { limitInputPixels: 24_000_000 }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const resized = await sharp(mask, { raw: { width: maskWidth, height: maskHeight, channels: 1 } }).resize(width, height, { kernel: 'lanczos3' }).greyscale().raw().toBuffer();
  const { subject: subjectAlpha, foreground: isolatedAlpha, combined, coverage } = splitMatte(resized, width, height);
  if (coverage < 0.02 || coverage > 0.9) throw new Error('这张图片暂时无法可靠地分离主体');
  const foregroundAlpha = depth ? await depthForeground(depth, subjectAlpha, rgb, width, height) : isolatedAlpha;
  for (let i = 0; i < combined.length; i++) combined[i] = Math.max(subjectAlpha[i], foregroundAlpha[i]);
  const hasForeground = foregroundAlpha.some((value) => value > 128);
  const backgroundPixels = fillBackground(rgb, combined, width, height);
  const subjectPixels = depth && hasForeground ? fillBackground(rgb, foregroundAlpha, width, height) : rgb;
  const subjectRgba = layerPixels(subjectPixels, backgroundPixels, subjectAlpha);
  const underForeground = Buffer.from(backgroundPixels);
  for (let i = 0; i < combined.length; i++) {
    const opacity = subjectRgba[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) underForeground[i * 3 + c] = Math.round(subjectRgba[i * 4 + c] * opacity + backgroundPixels[i * 3 + c] * (1 - opacity));
  }
  const [subject, foreground, background] = await Promise.all([
    sharp(subjectRgba, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toBuffer(),
    sharp(layerPixels(rgb, underForeground, foregroundAlpha), { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toBuffer(),
    sharp(backgroundPixels, { raw: { width, height, channels: 3 } }).webp({ lossless: true }).toBuffer(),
  ]);
  return { subject, foreground, background, width, height, coverage, hasForeground };
}
