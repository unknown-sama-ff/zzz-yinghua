import { zipSync } from 'fflate';
import { galleryImageProxyUrl } from './galleryClient';

export interface MemeImage {
  dataUrl: string;
  width: number;
  height: number;
  hasTransparency: boolean;
}

/** Full pixel boundaries, including zero and the image's far edge. */
export interface MemeCuts { x: number[]; y: number[] }

const MAX_PIXELS = 16_777_216;
const MAX_EDGE = 8_192;

function validateDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('图片宽高必须是大于零的整数。');
  }
  if (width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) {
    throw new Error('图片过大，请先缩小到 1677 万像素以内，且单边不超过 8192 像素。');
  }
}

export function defaultMemeCuts(width: number, height: number, columns: number, rows: number): MemeCuts {
  validateDimensions(width, height);
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1 || columns > width || rows > height) {
    throw new Error('行列数必须是正整数，且每格至少保留 1 像素。');
  }
  const boundaries = (size: number, count: number) => Array.from({ length: count + 1 }, (_, i) => Math.floor(i * size / count));
  return { x: boundaries(width, columns), y: boundaries(height, rows) };
}

export function validateMemeCuts(cuts: MemeCuts, width: number, height: number): void {
  validateDimensions(width, height);
  for (const [axis, size, label] of [[cuts?.x, width, '横向'], [cuts?.y, height, '纵向']] as const) {
    if (!Array.isArray(axis) || axis.length < 2 || axis[0] !== 0 || axis[axis.length - 1] !== size) {
      throw new Error(`${label}切线必须包含 0 和图片边界 ${size}。`);
    }
    if (axis.some((value, i) => !Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > size || (i > 0 && value <= axis[i - 1]))) {
      throw new Error(`${label}切线必须是递增整数，每格至少保留 1 像素。`);
    }
  }
}

export function inspectMemeAlpha(pixels: Uint8ClampedArray): { hasTransparency: boolean; hasContent: boolean } {
  // Tiny alpha variations can be compression/edge artifacts, rather than a
  // usable transparent background. Classification never changes the pixels.
  const minimumClearPixels = Math.max(1, Math.ceil(Math.floor(pixels.length / 4) * 0.001));
  let clearPixels = 0;
  let hasContent = false;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] <= 16) clearPixels++;
    if (pixels[i] > 0) hasContent = true;
    if (clearPixels >= minimumClearPixels && hasContent) break;
  }
  return { hasTransparency: clearPixels >= minimumClearPixels, hasContent };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => finish(false), 15_000);
    const finish = (success: boolean) => {
      clearTimeout(timer);
      image.onload = image.onerror = null;
      if (success) resolve(image);
      else {
        image.src = '';
        reject(new Error('图片加载失败，请检查网络或重新选择图片。'));
      }
    };
    if (/^https?:\/\//i.test(src)) image.crossOrigin = 'anonymous';
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = src;
  });
}

function createCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  validateDimensions(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('浏览器无法处理图片，请更换浏览器重试。');
  return { canvas, context };
}

function snapshot(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, allowBlank = true): MemeImage {
  const alpha = inspectMemeAlpha(context.getImageData(0, 0, canvas.width, canvas.height).data);
  if (!allowBlank && !alpha.hasContent) throw new Error('图片完全透明，没有可用内容，请重新选择图片。');
  const dataUrl = canvas.toDataURL('image/png');
  if (!dataUrl.startsWith('data:image/png')) throw new Error('浏览器导出 PNG 失败，请缩小图片后重试。');
  return { dataUrl, width: canvas.width, height: canvas.height, hasTransparency: alpha.hasTransparency };
}

/** Decode and verify alpha; a painted checkerboard remains an opaque image. */
export async function readMemeImage(src: string): Promise<MemeImage> {
  if (!src?.trim()) throw new Error('请先选择图片。');
  const candidates = [src];
  if (/^https?:\/\//i.test(src)) candidates.push(galleryImageProxyUrl(src));
  for (let index = 0; index < candidates.length; index++) {
    let loaded: HTMLImageElement;
    try { loaded = await loadImage(candidates[index]); }
    catch (error) {
      if (index + 1 < candidates.length) continue;
      throw error;
    }
    // Size/content errors are final, rather than triggering another large decode.
    validateDimensions(loaded.naturalWidth, loaded.naturalHeight);
    const { canvas, context } = createCanvas(loaded.naturalWidth, loaded.naturalHeight);
    try {
      context.drawImage(loaded, 0, 0);
      return snapshot(canvas, context, false);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') {
        if (index + 1 < candidates.length) continue;
        throw new Error('图片不允许读取像素，请下载原图后重新上传。');
      }
      throw error;
    }
  }
  throw new Error('图片加载失败，请重新选择图片。');
}

export async function splitMemeSheet(sheet: MemeImage, cuts: MemeCuts): Promise<MemeImage[]> {
  validateMemeCuts(cuts, sheet.width, sheet.height);
  const loaded = await loadImage(sheet.dataUrl);
  if (loaded.naturalWidth !== sheet.width || loaded.naturalHeight !== sheet.height) throw new Error('图片尺寸已变化，请重新载入后再切图。');
  const tiles: MemeImage[] = [];
  for (let row = 0; row < cuts.y.length - 1; row++) {
    for (let column = 0; column < cuts.x.length - 1; column++) {
      const x = cuts.x[column];
      const y = cuts.y[row];
      const width = cuts.x[column + 1] - x;
      const height = cuts.y[row + 1] - y;
      const { canvas, context } = createCanvas(width, height);
      context.drawImage(loaded, x, y, width, height, 0, 0, width, height);
      tiles.push(snapshot(canvas, context));
    }
  }
  return tiles;
}

export async function composeMemeSheet(tiles: MemeImage[], cuts: MemeCuts): Promise<MemeImage> {
  const width = cuts.x[cuts.x.length - 1];
  const height = cuts.y[cuts.y.length - 1];
  validateMemeCuts(cuts, width, height);
  if (tiles.length !== (cuts.x.length - 1) * (cuts.y.length - 1)) throw new Error('图片数量与网格不一致，请补齐图片后再合并。');
  const { canvas, context } = createCanvas(width, height);
  for (let i = 0; i < tiles.length; i++) {
    const loaded = await loadImage(tiles[i].dataUrl);
    validateDimensions(loaded.naturalWidth, loaded.naturalHeight);
    const column = i % (cuts.x.length - 1);
    const row = Math.floor(i / (cuts.x.length - 1));
    const cellWidth = cuts.x[column + 1] - cuts.x[column];
    const cellHeight = cuts.y[row + 1] - cuts.y[row];
    const scale = Math.min(cellWidth / loaded.naturalWidth, cellHeight / loaded.naturalHeight);
    const drawnWidth = loaded.naturalWidth * scale;
    const drawnHeight = loaded.naturalHeight * scale;
    context.drawImage(loaded, cuts.x[column] + (cellWidth - drawnWidth) / 2, cuts.y[row] + (cellHeight - drawnHeight) / 2, drawnWidth, drawnHeight);
  }
  return snapshot(canvas, context, false);
}

function pngBytes(dataUrl: string): Uint8Array {
  const match = /^data:image\/png;base64,([\s\S]+)$/i.exec(dataUrl);
  if (!match) throw new Error('打包图片必须是 PNG，请重新切图后下载。');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0)); }
  catch { throw new Error('PNG 数据无效，请重新切图后下载。'); }
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) throw new Error('PNG 数据无效，请重新切图后下载。');
  return bytes;
}

export async function zipMemeTiles(tiles: MemeImage[], names?: string[]): Promise<Blob> {
  if (!tiles.length) throw new Error('没有可以打包的图片。');
  const files: Record<string, Uint8Array> = {};
  const digits = Math.max(2, String(tiles.length).length);
  tiles.forEach((tile, i) => {
    const label = (names?.[i] ?? '').normalize('NFKC').replace(/\.png$/i, '').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 80);
    const filename = `${String(i + 1).padStart(digits, '0')}${label ? `_${label}` : ''}.png`;
    files[filename] = pngBytes(tile.dataUrl);
  });
  const bytes = zipSync(files, { level: 0 });
  return new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' });
}
