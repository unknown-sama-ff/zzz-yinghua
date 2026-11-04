import sharp from 'sharp';
import { JPEG_QUALITY, MAX_INPUT_PIXELS } from './constants.js';

/** Shared primary/reference preprocessing; only publish a format after encoding succeeds. */
export async function prepareEditImage(input, { maxDimension, preserveInputQuality }) {
  const meta = await sharp(input.buffer, { failOnError: false, limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  const resize = meta.width && meta.height && (meta.width > maxDimension || meta.height > maxDimension);
  const convert = preserveInputQuality ? !['image/png', 'image/jpeg'].includes(input.mime) : input.mime !== 'image/jpeg';
  if (!resize && !convert) return input;

  const pipeline = sharp(input.buffer, { failOnError: false, limitInputPixels: MAX_INPUT_PIXELS });
  if (resize) pipeline.resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true });
  // A resized JPEG must be encoded again; the fidelity path uses lossless PNG.
  const png = preserveInputQuality;
  const buffer = png ? await pipeline.png().toBuffer() : await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
  return { buffer, mime: png ? 'image/png' : 'image/jpeg', ext: png ? 'png' : 'jpg' };
}

/** Bound decode/encode pressure for requests with up to seventeen input images. */
export async function prepareEditImages(inputs, options) {
  const result = new Array(inputs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(2, inputs.length) }, async () => {
    while (next < inputs.length) {
      const index = next++;
      const image = inputs[index];
      const mime = image.mime || 'image/png';
      const original = { buffer: image.buffer || Buffer.from(image.base64, 'base64'), mime, ext: mime === 'image/jpeg' || mime === 'image/jpg' ? 'jpg' : 'png' };
      try { result[index] = await prepareEditImage(original, options); }
      catch (error) {
        // Keep the existing non-fatal fallback, including the original MIME/ext.
        console.warn(`[gpt-image] input ${index} processing failed, using original: ${error.message}`);
        result[index] = original;
      }
    }
  }));
  return result;
}
