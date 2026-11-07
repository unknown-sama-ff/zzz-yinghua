import sharp from 'sharp';
import { MAX_COMPRESS_DIM, MAX_INPUT_PIXELS } from './constants.js';

const MAX_GALLERY_GIF_FRAMES = 64;

function assertAnimationBounds(meta) {
  const frames = meta.pages || 1;
  const height = meta.pageHeight || meta.height;
  if (!meta.width || !height || frames > MAX_GALLERY_GIF_FRAMES || meta.width * height * frames > MAX_INPUT_PIXELS) {
    throw new Error('Animation exceeds frame or decoded pixel limit');
  }
}

export function assertGalleryGifBounds(meta, buffer) {
  assertAnimationBounds(meta);
  const frames = meta.pages || 1;
  // Some decoders report the frame rectangle instead of the logical screen.
  // Browsers still allocate the screen, so bound both representations.
  if (buffer.length < 13) throw new Error('GIF header');
  const screenWidth = buffer.readUInt16LE(6);
  const screenHeight = buffer.readUInt16LE(8);
  if (!screenWidth || !screenHeight || screenWidth * screenHeight * frames > MAX_INPUT_PIXELS) throw new Error('GIF screen limit');
}

/** Encode bounded animation as lossless WebP, retaining the smaller valid representation. */
export async function prepareGalleryAnimation(buffer, meta) {
  if (meta.format === 'gif') await validateGalleryGif(buffer, meta);
  else {
    assertAnimationBounds(meta);
    if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP'
      || buffer.readUInt32LE(4) + 8 !== buffer.length) throw new Error('Invalid animated WebP container');
    await sharp(buffer, { animated: true, failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS }).stats();
  }
  const encoded = await sharp(buffer, { animated: true, failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS })
    .resize(MAX_COMPRESS_DIM, MAX_COMPRESS_DIM, { fit: 'inside', withoutEnlargement: true })
    .webp({ lossless: true, effort: 4, delay: meta.delay, loop: meta.loop ?? 1 })
    .toBuffer();
  const result = await sharp(encoded).metadata();
  const sameTiming = (result.pages || 1) === (meta.pages || 1) && (result.loop ?? 1) === (meta.loop ?? 1)
    && JSON.stringify(result.delay || []) === JSON.stringify(meta.delay || []);
  const sameOrientation = (result.orientation || 1) === (meta.orientation || 1);
  const useEncoded = sameTiming && sameOrientation && encoded.length < buffer.length;
  return { buffer: useEncoded ? encoded : buffer, format: useEncoded ? 'webp' : meta.format, animated: (meta.pages || 1) > 1 };
}

/** Preserve validated animation bytes while excluding trailing/polyglot content. */
export async function validateGalleryGif(buffer, meta) {
  assertGalleryGifBounds(meta, buffer);
  if (!/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii')) || buffer.length < 14) throw new Error('GIF header');
  let offset = 13;
  let frames = 0;
  const skip = (length) => {
    offset += length;
    if (offset > buffer.length) throw new Error('Truncated GIF');
  };
  const skipBlocks = () => {
    while (true) {
      if (offset >= buffer.length) throw new Error('Truncated GIF block');
      const length = buffer[offset++];
      if (!length) return;
      skip(length);
    }
  };
  if (buffer[10] & 0x80) skip(3 * 2 ** ((buffer[10] & 7) + 1));
  while (offset < buffer.length) {
    const marker = buffer[offset++];
    if (marker === 0x3b) {
      if (offset !== buffer.length || frames !== (meta.pages || 1)) throw new Error('GIF trailer');
      // Decode every frame under the aggregate pixel bound. Metadata alone does
      // not establish that later compressed frames are valid.
      await sharp(buffer, { animated: true, failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS }).stats();
      return;
    }
    if (marker === 0x21) {
      skip(1); // Extension label, followed by length-delimited sub-blocks.
      skipBlocks();
    } else if (marker === 0x2c) {
      skip(9);
      const packed = buffer[offset - 1];
      const width = buffer.readUInt16LE(offset - 5);
      const height = buffer.readUInt16LE(offset - 3);
      const left = buffer.readUInt16LE(offset - 9);
      const top = buffer.readUInt16LE(offset - 7);
      if (!width || !height || left + width > buffer.readUInt16LE(6) || top + height > buffer.readUInt16LE(8)
        || width * height > MAX_INPUT_PIXELS || ++frames > MAX_GALLERY_GIF_FRAMES) throw new Error('GIF frame');
      if (packed & 0x80) skip(3 * 2 ** ((packed & 7) + 1));
      skip(1); // LZW minimum code size, checked by the decoder.
      skipBlocks();
    } else {
      throw new Error('GIF block');
    }
  }
  throw new Error('Missing GIF trailer');
}
