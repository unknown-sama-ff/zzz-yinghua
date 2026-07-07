import type { Palette } from '../types';

type RGB = [number, number, number];

interface Box {
  pixels: RGB[];
  // cached channel ranges
  rRange: number;
  gRange: number;
  bRange: number;
}

const DEFAULT_PALETTE: Palette = {
  dominant: '#b026ff',
  accent: '#ff2d9b',
  muted: '#16121f',
  textOn: '#f5f0ff',
  textTop: '#1a1a2e',
  textBottom: '#cc66ff',
  textTopBright: '#e099ff',
};

/**
 * Extract a semantic palette from an image via median-cut quantization.
 * Runs entirely client-side on a downsampled offscreen canvas.
 * Falls back to the default ZZZ theme on failure or near-grayscale images.
 */
export async function extractPalette(imageSrc: string): Promise<Palette> {
  try {
    const pixels = await samplePixels(imageSrc, 64);
    if (pixels.length === 0) return DEFAULT_PALETTE;

    const buckets = medianCut(pixels, 5); // up to 5 representative colors
    const swatches = buckets
      .map((b) => averageColor(b.pixels))
      .map((rgb) => ({ rgb, ...describe(rgb), count: 0 }));

    // Weight by population: bigger buckets first.
    const ranked = buckets
      .map((b, i) => ({ ...swatches[i], count: b.pixels.length }))
      .sort((a, b) => b.count - a.count);

    // dominant = most populous reasonably-saturated color; else most populous.
    const vivid = ranked.filter((s) => s.sat > 0.18 && s.light > 0.12 && s.light < 0.9);
    const dominant = (vivid[0] ?? ranked[0]).rgb;

    // accent = the most saturated color distinct from dominant, but with the same
    // brightness floor/ceiling as dominant so a high-saturation DARK color (e.g. a
    // deep-red shadow) is never chosen — that was leaking dark red into backgrounds.
    const bySat = [...ranked].sort((a, b) => b.sat - a.sat);
    const accentOk = (s: typeof bySat[number]) =>
      s.light > 0.12 && s.light < 0.9 && colorDistance(s.rgb, dominant) > 60;
    const accent =
      bySat.find(accentOk)?.rgb ??
      bySat.find((s) => colorDistance(s.rgb, dominant) > 60)?.rgb ??
      shiftHue(dominant);

    // muted = darkest low-saturation color for panels/backgrounds.
    const byDark = [...ranked].sort((a, b) => a.light - b.light);
    const muted = (byDark[0] ?? ranked[ranked.length - 1]).rgb;

    // If the whole image is basically grayscale, the theme would be flat — bail.
    const maxSat = Math.max(...ranked.map((s) => s.sat));
    if (maxSat < 0.08) return DEFAULT_PALETTE;

    return {
      dominant: toHex(dominant),
      accent: toHex(accent),
      muted: toHex(darken(muted, 0.4)),
      textOn: readableText(dominant),
      textTop: darkenHex(toHex(dominant), 0.85),
      textBottom: brightenHex(toHex(dominant), 0.25),
      textTopBright: brightenHex(toHex(dominant), 0.4),
    };
  } catch {
    return DEFAULT_PALETTE;
  }
}

export { DEFAULT_PALETTE };

/** Draw the image to an offscreen canvas and read downsampled pixels. */
function samplePixels(src: string, target: number): Promise<RGB[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = Math.min(1, target / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject(new Error('no 2d context'));
      ctx.drawImage(img, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      const out: RGB[] = [];
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 125) continue; // skip transparent pixels
        out.push([data[i], data[i + 1], data[i + 2]]);
      }
      resolve(out);
    };
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

function makeBox(pixels: RGB[]): Box {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (const [r, g, b] of pixels) {
    rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
    gMin = Math.min(gMin, g); gMax = Math.max(gMax, g);
    bMin = Math.min(bMin, b); bMax = Math.max(bMax, b);
  }
  return {
    pixels,
    rRange: rMax - rMin,
    gRange: gMax - gMin,
    bRange: bMax - bMin,
  };
}

/** Classic median-cut: repeatedly split the box with the widest channel. */
function medianCut(pixels: RGB[], depth: number): Box[] {
  let boxes: Box[] = [makeBox(pixels)];
  while (boxes.length < depth) {
    // Pick the box with the largest single-channel range.
    boxes.sort(
      (a, b) =>
        Math.max(b.rRange, b.gRange, b.bRange) -
        Math.max(a.rRange, a.gRange, a.bRange),
    );
    const target = boxes.shift();
    if (!target || target.pixels.length < 2) {
      if (target) boxes.push(target);
      break;
    }
    const channel =
      target.rRange >= target.gRange && target.rRange >= target.bRange
        ? 0
        : target.gRange >= target.bRange
          ? 1
          : 2;
    const sorted = [...target.pixels].sort((a, b) => a[channel] - b[channel]);
    const mid = sorted.length >> 1;
    boxes.push(makeBox(sorted.slice(0, mid)), makeBox(sorted.slice(mid)));
  }
  return boxes;
}

function averageColor(pixels: RGB[]): RGB {
  let r = 0, g = 0, b = 0;
  for (const p of pixels) {
    r += p[0]; g += p[1]; b += p[2];
  }
  const n = pixels.length || 1;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

function describe([r, g, b]: RGB): { sat: number; light: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const light = (max + min) / 2;
  const d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * light - 1) || 1);
  return { sat, light };
}

function colorDistance(a: RGB, b: RGB): number {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
  );
}

function toHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Brighten a hex color by factor (0-1). 0.25 = ~25% toward white. */
export function brightenHex(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  const b = rgb.map((v) => Math.min(255, Math.round(v + (255 - v) * factor)));
  return toHex(b as RGB);
}

/** Darken a hex color by factor (0-1). 0.6 = ~60% toward black. */
export function darkenHex(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  const d = rgb.map((v) => Math.round(v * (1 - factor)));
  return toHex(d as RGB);
}

function darken([r, g, b]: RGB, amount: number): RGB {
  return [r, g, b].map((v) => Math.round(v * (1 - amount))) as RGB;
}

function shiftHue([r, g, b]: RGB): RGB {
  // Cheap complementary-ish shift used when no distinct accent exists.
  return [g, b, r];
}

/** Pick black or white text for best contrast over a background color. */
function readableText([r, g, b]: RGB): string {
  // Relative luminance (sRGB approximation).
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? '#0d0a14' : '#f5f0ff';
}
