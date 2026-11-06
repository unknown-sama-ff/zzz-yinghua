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
  for (const component of components) {
    if (!component.strong || component.area < Math.max(3, count * 0.000015)) continue;
    // Detached hands, fins and worn accessories still belong to the same character.
    ownership[component.id] = 1;
  }
  const subject = Buffer.alloc(count); const combined = Buffer.alloc(count);
  let opaque = 0;
  for (let i = 0; i < count; i++) {
    const owner = ownership[labels[i]];
    if (!owner) continue;
    const value = Math.max(0, Math.min(1, (mask[i] - 8) / 237));
    const alpha = Math.round(value * value * (3 - 2 * value) * 255);
    combined[i] = alpha;
    subject[i] = alpha;
    if (alpha > 128) opaque++;
  }
  return { subject, combined, coverage: opaque / count };
}

function histogramPercentile(histogram, count, fraction) {
  let total = 0;
  for (let value = 0; value < histogram.length; value++) {
    total += histogram[value];
    if (total >= count * fraction) return value;
  }
  return 255;
}

export function needsSubjectChecks(mask, width, height) {
  const border = Math.max(2, Math.ceil(Math.min(width, height) * 0.02));
  let edgePixels = 0; let uncertain = 0; let confident = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = mask[y * width + x];
    if (value >= 245) confident++;
    if (x >= border && x < width - border && y >= border && y < height - border) continue;
    edgePixels++;
    if (value >= 64 && value < 224) uncertain++;
  }
  return confident >= mask.length * 0.01 && uncertain >= edgePixels * 0.05;
}

function refineSubjectBackground(mask, checks, width, height) {
  if (!checks.length || !needsSubjectChecks(mask, width, height)) return;
  const border = Math.max(2, Math.ceil(Math.min(width, height) * 0.02));
  for (const check of checks) {
    const disputed = Buffer.alloc(mask.length);
    for (let i = 0; i < mask.length; i++) if (mask[i] >= 10 && check[i] < 8) disputed[i] = 255;
    const { labels, components } = matteComponents(disputed, width, height);
    const anchors = new Uint32Array(components.length + 1);
    const supported = new Uint32Array(components.length + 1);
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] >= 245) anchors[labels[i]]++;
      if (mask[i] >= 128) supported[labels[i]]++;
    }
    const rejected = new Set(components.filter((component) =>
      (component.minX < border || component.minY < border || component.maxX >= width - border || component.maxY >= height - border)
      && component.area >= mask.length * 0.002 && !anchors[component.id]
      && Math.min(component.maxX - component.minX + 1, component.maxY - component.minY + 1) >= Math.min(width, height) * 0.02
      && supported[component.id] >= component.area * 0.1,
    ).map((component) => component.id));
    if (!rejected.size) continue;
    const protectedEdges = dilateMatte(check, width, height, Math.ceil(Math.min(width, height) * 0.03), 9);
    // Preserve delicate translucent branches, including those adjoining rejected scenery.
    for (let i = 0; i < mask.length; i++) if (rejected.has(labels[i]) && mask[i] >= 96 && !protectedEdges[i]) mask[i] = 0;
  }
}

function reflectionMatch(rgb, mask, width, axis, start, end, range, shift, scale, step) {
  let count = 0; let aboveSum = 0; let belowSum = 0; let directSum = 0;
  let aboveSquares = 0; let belowSquares = 0; let directSquares = 0;
  let mirroredProducts = 0; let directProducts = 0;
  for (let y = step; y < range; y += step) for (let x = start; x < end; x += step) {
    const shifted = x + shift;
    if (shifted < 0 || shifted >= width) continue;
    const below = (axis + y) * width + x;
    const above = (axis - Math.round(y * scale)) * width + shifted;
    const direct = (axis - range + Math.round(y * scale)) * width + shifted;
    if (mask[below] < 10 || mask[above] < 160) continue;
    for (let c = 0; c < 3; c++) {
      const a = rgb[above * 3 + c]; const b = rgb[below * 3 + c]; const d = rgb[direct * 3 + c];
      count++; aboveSum += a; belowSum += b; directSum += d;
      aboveSquares += a * a; belowSquares += b * b; directSquares += d * d;
      mirroredProducts += a * b; directProducts += d * b;
    }
  }
  const expected = Math.ceil((end - start) / step) * (Math.ceil(range / step) - 1) * 3;
  if (count < expected * 0.75) return 0;
  const aboveVariance = aboveSquares - aboveSum * aboveSum / count;
  const belowVariance = belowSquares - belowSum * belowSum / count;
  const directVariance = directSquares - directSum * directSum / count;
  if (aboveVariance < count * 144 || belowVariance < count * 144 || directVariance <= 0) return 0;
  const mirrored = (mirroredProducts - aboveSum * belowSum / count) / Math.sqrt(aboveVariance * belowVariance);
  const direct = (directProducts - directSum * belowSum / count) / Math.sqrt(directVariance * belowVariance);
  return mirrored >= 0.75 && direct < 0.4 && mirrored - direct >= 0.45 ? mirrored : 0;
}

/** Remove a lower mirrored duplicate only when its texture matches an actual subject above it. */
function removeSubjectReflection(mask, rgb, width, height) {
  const step = Math.max(1, Math.round(Math.min(width, height) / 300));
  const rowStep = Math.max(1, Math.round(height / 512));
  const window = Math.max(8, Math.round(height * 0.04));
  const shift = Math.max(1, Math.round(width * 0.005));
  let best = null; let bestScore = 0;
  for (let axis = Math.ceil(height * 0.85); axis <= height * 0.97; axis += rowStep) {
    const range = Math.min(window, height - axis - 1);
    if (range < 8) continue;
    for (let x = 0; x < width;) {
      if (mask[axis * width + x] < 100) { x++; continue; }
      const start = x;
      while (x < width && mask[axis * width + x] >= 100) x++;
      const end = x;
      if (end - start < width * 0.02 || end - start > width * 0.32) continue;
      for (const offset of [-shift, 0, shift]) for (const scale of [0.75, 1, 1.25]) {
        const score = reflectionMatch(rgb, mask, width, axis, start, end, range, offset, scale, step);
        if (score > bestScore) { bestScore = score; best = { axis, start, end }; }
      }
    }
  }
  if (!best) return;
  // Leave a margin above the reflected texture so the actual shoe or body edge stays intact.
  const cut = best.axis + Math.max(1, Math.ceil(height * 0.004));
  const queue = new Int32Array(mask.length);
  const seen = new Uint8Array(mask.length);
  let head = 0; let tail = 0; let reachesBottom = false;
  for (let y = cut; y < Math.min(height, cut + step); y++) for (let x = best.start; x < best.end; x++) {
    const i = y * width + x;
    if (mask[i] >= 10) { queue[tail++] = i; seen[i] = 1; }
  }
  while (head < tail) {
    const i = queue[head++]; const x = i % width; const y = Math.floor(i / width);
    if (y >= height - 2) reachesBottom = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx; const yy = y + dy; const next = yy * width + xx;
      if (xx < 0 || xx >= width || yy < cut || yy >= height || seen[next] || mask[next] < 10) continue;
      seen[next] = 1; queue[tail++] = next;
    }
  }
  if (reachesBottom) for (let i = 0; i < tail; i++) mask[queue[i]] = 0;
}

async function preserveForegroundObjects(matte, values, rgb, reference, referenceLuminance, width, height, protectedSubject, minimumDepth) {
  const contrast = Buffer.alloc(matte.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    const luminance = rgb[i * 3] * 0.2126 + rgb[i * 3 + 1] * 0.7152 + rgb[i * 3 + 2] * 0.0722;
    if (!protectedSubject[i] && Math.abs(luminance - referenceLuminance) >= 48) contrast[i] = 255;
  }
  const { labels, components } = matteComponents(contrast, width, height);
  const overlaps = new Uint32Array(components.length + 1);
  const farther = new Uint32Array(components.length + 1);
  for (let i = 0; i < matte.length; i++) {
    if (matte[i] >= 160 && values[i] >= reference + 24) overlaps[labels[i]]++;
    if (values[i] < minimumDepth) farther[labels[i]]++;
  }
  // Follow the visible colour contour before checking depth, so a far half cannot
  // disappear from the test and leave only the near half of the same prop floating.
  const rejected = new Set(components.filter((component) => overlaps[component.id] && farther[component.id] > component.area * 0.05).map((component) => component.id));
  const rejectedMatte = Buffer.alloc(matte.length);
  for (let i = 0; i < matte.length; i++) if (rejected.has(labels[i])) rejectedMatte[i] = 255;
  const blocked = dilateMatte(rejectedMatte, width, height, 2);
  for (let i = 0; i < matte.length; i++) if (blocked[i]) matte[i] = 0;
  const retained = new Set(components.filter((component) => {
    const boundsArea = (component.maxX - component.minX + 1) * (component.maxY - component.minY + 1);
    return !rejected.has(component.id) && component.area >= Math.max(6, matte.length * 0.0005)
      && component.area <= matte.length * 0.08
      && component.area / boundsArea >= 0.35
      && overlaps[component.id] >= Math.max(4, component.area * 0.02);
  }).map((component) => component.id));
  if (!retained.size) return matte;
  for (let i = 0; i < contrast.length; i++) contrast[i] = retained.has(labels[i]) ? 255 : 0;
  // Keep enclosed highlights with the selected background detail.
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
  for (let i = 0; i < matte.length; i++) matte[i] = protectedSubject[i] ? 0 : Math.max(matte[i], values[i] >= minimumDepth ? softened[i] : 0);
  return matte;
}

function smallEdgeObject(component, width, height) {
  const border = Math.max(2, Math.ceil(Math.min(width, height) * 0.02));
  const touchesEdge = component.minX <= border || component.minY <= border
    || component.maxX >= width - 1 - border || component.maxY >= height - 1 - border;
  return touchesEdge && component.area < width * height * 0.003;
}

function limitForegroundObjects(matte, values, characterNear, budget, width, height) {
  const { labels, components } = matteComponents(matte, width, height);
  const scores = new Float64Array(components.length + 1);
  const closer = new Uint32Array(components.length + 1);
  for (let i = 0; i < matte.length; i++) {
    scores[labels[i]] += values[i];
    if (matte[i] >= 160 && values[i] >= characterNear + 12) closer[labels[i]]++;
  }
  // Colour completion cannot promote a farther object just because a few pixels look near.
  const ranked = components.filter((component) => {
    // Shallow bottom-edge bands are commonly ground planes, reflections or clipped fragments.
    const uncertainBottomBand = component.maxY >= height * 0.98 && component.maxY - component.minY + 1 < height * 0.1;
    return !uncertainBottomBand && !smallEdgeObject(component, width, height)
      && component.strong >= 4 && component.area <= budget && closer[component.id] >= component.strong * 0.8;
  })
    .sort((a, b) => scores[b.id] / b.area - scores[a.id] / a.area || b.strong - a.strong);
  const selected = new Set();
  let area = 0;
  for (const component of ranked) {
    if (selected.size === 3 || area + component.area > budget) continue;
    selected.add(component.id); area += component.area;
  }
  for (let i = 0; i < matte.length; i++) if (!selected.has(labels[i])) matte[i] = 0;
  return matte;
}

async function depthForeground(depth, subject, rgb, width, height) {
  if (!Number.isInteger(depth.width) || !Number.isInteger(depth.height)
    || depth.width < 1 || depth.height < 1 || depth.width * depth.height > 1024 * 1024
    || !Buffer.isBuffer(depth.data) || depth.data.length !== depth.width * depth.height) {
    throw new Error('前景深度图尺寸无效');
  }
  const values = await sharp(depth.data, { raw: { width: depth.width, height: depth.height, channels: 1 } }).resize(width, height, { kernel: 'cubic' }).greyscale().raw().toBuffer();
  // Keep the entire character and a soft-edge guard band out of every foreground pass.
  const protectedSubject = dilateMatte(subject, width, height, Math.max(2, Math.ceil(Math.min(width, height) * 0.008)));
  const backgroundHistogram = new Uint32Array(256);
  const characterHistogram = new Uint32Array(256);
  const luminanceHistogram = new Uint32Array(256);
  let backgroundCount = 0;
  let characterCount = 0;
  for (let i = 0; i < values.length; i++) {
    if (subject[i] >= 224) { characterHistogram[values[i]]++; characterCount++; }
    if (protectedSubject[i]) continue;
    backgroundHistogram[values[i]]++;
    luminanceHistogram[Math.round(rgb[i * 3] * 0.2126 + rgb[i * 3 + 1] * 0.7152 + rgb[i * 3 + 2] * 0.0722)]++;
    backgroundCount++;
  }
  const matte = Buffer.alloc(width * height);
  if (!backgroundCount || !characterCount) return matte;
  const budget = Math.floor(Math.min(matte.length * 0.08, backgroundCount * 0.2));
  // Rank against the nearer part of the complete role, including reaching hands and knees.
  const characterNear = histogramPercentile(characterHistogram, characterCount, 0.9);
  const reference = Math.max(characterNear, histogramPercentile(backgroundHistogram, backgroundCount, 0.65));
  const nearest = histogramPercentile(backgroundHistogram, backgroundCount, 0.995);
  const separation = nearest - reference;
  if (separation < 28) return matte;
  const start = reference + separation * 0.4;
  const solid = reference + separation * 0.75;
  for (let i = 0; i < matte.length; i++) {
    if (protectedSubject[i]) continue;
    const value = Math.max(0, Math.min(1, (values[i] - start) / (solid - start)));
    matte[i] = Math.round(value * value * (3 - 2 * value) * 255);
  }
  const { labels, components } = matteComponents(matte, width, height);
  const accepted = new Set(components.filter((component) =>
    component.strong >= Math.max(4, matte.length * 0.0001)
    && component.area >= Math.max(6, matte.length * 0.0005) && component.area <= budget
    && !smallEdgeObject(component, width, height),
  ).map((component) => component.id));
  for (let i = 0; i < matte.length; i++) if (!accepted.has(labels[i])) matte[i] = 0;
  const details = await preserveForegroundObjects(matte, values, rgb, reference, histogramPercentile(luminanceHistogram, backgroundCount, 0.5), width, height, protectedSubject, characterNear + 12);
  return limitForegroundObjects(details, values, characterNear, budget, width, height);
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

export async function createLayerImages(image, mask, maskWidth, maskHeight, { depth, subjectChecks = [] } = {}) {
  const { data: rgb, info } = await sharp(image, { limitInputPixels: 24_000_000 }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const resized = await sharp(mask, { raw: { width: maskWidth, height: maskHeight, channels: 1 } }).resize(width, height, { kernel: 'lanczos3' }).greyscale().raw().toBuffer();
  const checks = await Promise.all(subjectChecks.map((check) => sharp(check, { raw: { width: maskWidth, height: maskHeight, channels: 1 } }).resize(width, height, { kernel: 'lanczos3' }).greyscale().raw().toBuffer()));
  refineSubjectBackground(resized, checks, width, height);
  removeSubjectReflection(resized, rgb, width, height);
  const { subject: subjectAlpha, combined, coverage } = splitMatte(resized, width, height);
  if (coverage < 0.02 || coverage > 0.9) throw new Error('这张图片暂时无法可靠地分离主体');
  // Depth must never split limbs, clothing or disconnected details out of the saliency matte.
  const foregroundAlpha = depth ? await depthForeground(depth, subjectAlpha, rgb, width, height) : Buffer.alloc(width * height);
  for (let i = 0; i < combined.length; i++) combined[i] = Math.max(subjectAlpha[i], foregroundAlpha[i]);
  const hasForeground = foregroundAlpha.some((value) => value > 128);
  const backgroundPixels = fillBackground(rgb, combined, width, height);
  const subjectRgba = layerPixels(rgb, backgroundPixels, subjectAlpha);
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
