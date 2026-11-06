import sharp from 'sharp';

export const MODEL_SIZE = 1024;

// Match SkyTNT's get_mask: RGB / 255, aspect-preserving resize, centered zero padding.
export async function prepareModelInput(image, { flip = false, centered = false } = {}) {
  const { data, info } = await sharp(image).removeAlpha().toColourspace('srgb')
    .resize({ width: MODEL_SIZE, height: MODEL_SIZE, fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const left = Math.floor((MODEL_SIZE - info.width) / 2);
  const top = Math.floor((MODEL_SIZE - info.height) / 2);
  const size = MODEL_SIZE * MODEL_SIZE;
  const values = new Float32Array(size * 3);
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const source = (y * info.width + (flip ? info.width - 1 - x : x)) * 3;
    const target = (y + top) * MODEL_SIZE + x + left;
    for (let c = 0; c < 3; c++) values[c * size + target] = data[source + c] / 255 - (centered ? 0.5 : 0);
  }
  return { values, left, top, width: info.width, height: info.height, flipped: flip };
}

export function cropPrediction(prediction, layout) {
  const mask = Buffer.alloc(layout.width * layout.height);
  if (prediction.length !== MODEL_SIZE * MODEL_SIZE) throw new Error('分层模型输出尺寸不正确');
  let min = Infinity; let max = -Infinity;
  for (let y = 0; y < layout.height; y++) for (let x = 0; x < layout.width; x++) {
    const value = prediction[(y + layout.top) * MODEL_SIZE + x + layout.left];
    if (!Number.isFinite(value)) throw new Error('分层模型输出无效');
    min = Math.min(min, value); max = Math.max(max, value);
    const sourceX = layout.flipped ? layout.width - 1 - x : x;
    mask[y * layout.width + sourceX] = Math.round(Math.max(0, Math.min(1, value)) * 255);
  }
  if (max - min < 0.00001) throw new Error('未识别到可分层的主体');
  return mask;
}
