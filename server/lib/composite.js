// Server-side image composition, replicating the browser canvas helpers in
// src/lib/imageWorkerPool.ts (stitchImages / embedThumbnails) with sharp, so
// the mini program can avoid client-side canvas entirely.
import sharp from 'sharp';
import { MAX_INPUT_PIXELS } from './constants.js';

const MAX_STITCH_HEIGHT = 1536;
const EMBED_MARGIN_RATIO = 0.02;
const EMBED_PAD = 4;

// Cap decoded pixels on untrusted input (decompression-bomb guard).
const DECODE = { failOnError: false, limitInputPixels: MAX_INPUT_PIXELS };

function toBuffer(image) {
  if (typeof image !== 'string' || !image) throw new Error('invalid image input');
  if (image.startsWith('data:')) {
    const comma = image.indexOf(',');
    if (comma < 0) throw new Error('invalid data URL');
    return Buffer.from(image.slice(comma + 1), 'base64');
  }
  return Buffer.from(image, 'base64');
}

/** Horizontal stitch: cap the max height, scale each image proportionally. */
export async function compositeStitch(dataUrls) {
  const urls = (dataUrls || []).filter((u) => u && typeof u === 'string');
  if (urls.length === 0) throw new Error('compositeStitch: no images provided');
  if (urls.length === 1) {
    const out = await sharp(toBuffer(urls[0]), DECODE).png().toBuffer();
    return out.toString('base64');
  }

  const metas = await Promise.all(urls.map(async (u) => {
    const meta = await sharp(toBuffer(u), DECODE).metadata();
    return { w: meta.width || 0, h: meta.height || 0 };
  }));
  const maxH = Math.min(Math.max(...metas.map((m) => m.h)), MAX_STITCH_HEIGHT);
  const scaledWidths = metas.map((m) => Math.round((m.w / m.h) * maxH));
  const totalW = scaledWidths.reduce((a, b) => a + b, 0);

  const layers = [];
  let x = 0;
  for (let i = 0; i < urls.length; i++) {
    const input = await sharp(toBuffer(urls[i]), DECODE)
      .resize(scaledWidths[i], maxH, { fit: 'fill' })
      .png()
      .toBuffer();
    layers.push({ input, left: x, top: 0 });
    x += scaledWidths[i];
  }
  const out = await sharp({
    create: { width: totalW, height: maxH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(layers).png().toBuffer();
  return out.toString('base64');
}

/** Embed thumbnail(s) into the bottom corners of a base image. */
export async function compositeEmbed(baseDataUrl, thumbs) {
  const base = toBuffer(baseDataUrl);
  const baseMeta = await sharp(base, DECODE).metadata();
  const baseW = baseMeta.width || 0;
  const baseH = baseMeta.height || 0;
  if (!baseW || !baseH) throw new Error('compositeEmbed: invalid base image');

  const margin = Math.round(baseH * EMBED_MARGIN_RATIO);
  const leftThumbs = [];
  const rightThumbs = [];
  for (const spec of thumbs || []) {
    const size = spec.size ?? 0.2;
    const thumbH = Math.round(baseH * size);
    const meta = await sharp(toBuffer(spec.url), DECODE).metadata();
    const thumbW = Math.round(((meta.width || 0) / (meta.height || 1)) * thumbH);
    const entry = { spec, thumbW, thumbH };
    if (spec.position === 'bottom-left') leftThumbs.push(entry);
    else rightThumbs.push(entry);
  }

  const layers = [];
  let leftX = margin;
  for (const t of leftThumbs) {
    const ty = baseH - t.thumbH - margin;
    layers.push({ input: await paddingRect(t.thumbW, t.thumbH), left: leftX - EMBED_PAD, top: ty - EMBED_PAD });
    layers.push({ input: await thumbBuffer(t), left: leftX, top: ty });
    leftX += t.thumbW + margin;
  }

  const totalRightW = rightThumbs.reduce((s, t) => s + t.thumbW, 0)
    + (rightThumbs.length - 1) * margin;
  let rightX = baseW - totalRightW;
  for (const t of rightThumbs) {
    const ty = baseH - t.thumbH - margin;
    layers.push({ input: await paddingRect(t.thumbW, t.thumbH), left: rightX - EMBED_PAD, top: ty - EMBED_PAD });
    layers.push({ input: await thumbBuffer(t), left: rightX, top: ty });
    rightX += t.thumbW + margin;
  }

  const out = await sharp(base).composite(layers).png().toBuffer();
  return out.toString('base64');
}

async function thumbBuffer({ spec, thumbW, thumbH }) {
  return sharp(toBuffer(spec.url), DECODE)
    .resize(thumbW, thumbH, { fit: 'fill' })
    .png()
    .toBuffer();
}

/** Semi-transparent black backing plate, matching the canvas fillRect(-4). */
async function paddingRect(w, h) {
  return sharp({
    create: { width: w + EMBED_PAD * 2, height: h + EMBED_PAD * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 128 } },
  }).png().toBuffer();
}
