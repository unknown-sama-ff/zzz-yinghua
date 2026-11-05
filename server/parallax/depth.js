import sharp from 'sharp';
import * as ort from 'onnxruntime-node';

const SIZE = 518;
const MULTIPLE = 14;
const MAX_SIDE = 1022;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** Pinned DPT processor configuration: RGB, aspect-preserving bicubic, ImageNet normalization. */
export async function prepareDepthInput(image) {
  const { width, height } = await sharp(image).metadata();
  if (!width || !height) throw new Error('深度输入尺寸无效');
  const scaleWidth = SIZE / width;
  const scaleHeight = SIZE / height;
  const processorScale = Math.abs(1 - scaleWidth) < Math.abs(1 - scaleHeight) ? scaleWidth : scaleHeight;
  const scale = Math.min(processorScale, MAX_SIDE / Math.max(width, height));
  const inputWidth = Math.max(MULTIPLE, Math.round(width * scale / MULTIPLE) * MULTIPLE);
  const inputHeight = Math.max(MULTIPLE, Math.round(height * scale / MULTIPLE) * MULTIPLE);
  const pixels = await sharp(image).removeAlpha().toColourspace('srgb')
    .resize(inputWidth, inputHeight, { fit: 'fill', kernel: 'cubic' }).raw().toBuffer();
  const area = inputWidth * inputHeight;
  const values = new Float32Array(area * 3);
  for (let channel = 0; channel < 3; channel++) {
    for (let pixel = 0; pixel < area; pixel++) {
      values[channel * area + pixel] = (pixels[pixel * 3 + channel] / 255 - MEAN[channel]) / STD[channel];
    }
  }
  return { values, width: inputWidth, height: inputHeight };
}

/** Relative inverse depth. Larger values indicate nearer surfaces, with no metric distance claim. */
export function normalizeDepthPrediction(prediction, dims) {
  const width = dims.at(-1);
  const height = dims.at(-2);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || prediction.length !== width * height) {
    throw new Error('深度输出尺寸无效');
  }
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of prediction) {
    if (!Number.isFinite(value)) throw new Error('深度输出数值无效');
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const range = maximum - minimum;
  const data = Buffer.alloc(prediction.length);
  if (range > 0) {
    for (let index = 0; index < prediction.length; index++) data[index] = Math.round((prediction[index] - minimum) * 255 / range);
  }
  return { data, width, height };
}

export async function inferRelativeDepth(image, modelPath) {
  const input = await prepareDepthInput(image);
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: [{ name: 'cpu', useArena: false }], executionMode: 'sequential',
    intraOpNumThreads: Math.min(2, Math.max(1, Number(process.env.PUZZLE_LAYER_THREADS) || 1)), interOpNumThreads: 1, enableMemPattern: false,
  });
  try {
    const results = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input.values, [1, 3, input.height, input.width]) });
    const prediction = results[session.outputNames[0]];
    return normalizeDepthPrediction(prediction.data, prediction.dims);
  } finally {
    await session.release();
  }
}
