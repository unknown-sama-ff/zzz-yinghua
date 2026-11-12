const FLEXIBLE_SIZE_MODEL = /^gpt-image-(?:2|2\.[56](?:-sunburst|-flare)?)(?:-\d{4}-\d{2}-\d{2})?$/;
const MIN_PIXELS = 655_360;
const MAX_PIXELS = 1536 * 1024;

/** Keep source framing at a normal edit resolution, within the model's size grid. */
export function editOutputSize(width, height, model) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('无法读取原图尺寸');
  }
  if (!FLEXIBLE_SIZE_MODEL.test(String(model || '').trim().toLowerCase())) {
    // Older/unknown models choose among their own supported sizes.
    return width === height ? '1024x1024' : 'auto';
  }
  const ratio = width / height;
  if (ratio > 3 || ratio < 1 / 3) throw new Error('当前模型无法保持超过3:1的原图画幅比例');
  const pixels = width * height;
  if (width % 16 === 0 && height % 16 === 0 && pixels >= MIN_PIXELS && pixels <= MAX_PIXELS && Math.max(width, height) <= 1536) {
    return `${width}x${height}`;
  }

  // Prefer the exact ratio whenever it fits the 16-pixel grid. Otherwise choose
  // the nearest supported ratio; do not crop or stretch the returned image.
  const targetPixels = width === height ? 1024 * 1024 : MAX_PIXELS;
  let best;
  for (let w = 16; w <= 1536; w += 16) {
    for (let h = 16; h <= 1536; h += 16) {
      const area = w * h;
      if (area < MIN_PIXELS || area > MAX_PIXELS || w / h > 3 || h / w > 3) continue;
      const ratioError = Math.abs(Math.log((w / h) / ratio));
      const areaError = Math.abs(area - targetPixels);
      if (!best || ratioError < best.ratioError - 1e-10
        || (Math.abs(ratioError - best.ratioError) <= 1e-10 && areaError < best.areaError)) {
        best = { w, h, ratioError, areaError };
      }
    }
  }
  return `${best.w}x${best.h}`;
}
