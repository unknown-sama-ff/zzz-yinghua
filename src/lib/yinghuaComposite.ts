import { API_BASE } from './apiBase';
import { containedImageRect, parseClipPolygon, type YinghuaLayer } from './yinghuaLayers';

interface LoadedImage {
  image: HTMLImageElement;
  revoke: () => void;
}

/** Render the stable visible image stack only, never its controls or effects. */
export async function renderYinghuaComposite(
  layers: readonly YinghuaLayer[],
  backgroundColor: string,
): Promise<Blob> {
  if (!layers.length || layers[0].code !== 'base') throw new Error('请先加载零命底图');
  const images = new Map<string, LoadedImage>();
  try {
    // At most one decode per source, even when three regions share the image.
    for (const layer of layers) {
      if (!images.has(layer.src)) images.set(layer.src, await loadImage(layer.src));
    }
    const base = images.get(layers[0].src)!.image;
    const width = base.naturalWidth;
    const height = base.naturalHeight;
    if (!width || !height) throw new Error('无法读取底图分辨率');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建图片合成画布');
    // Include the stage's actual background for transparent PNGs/letterboxing,
    // not the outer panel, border, or any browser UI.
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const layer of layers) {
      const image = images.get(layer.src)!.image;
      ctx.save();
      if (layer.clipPath) {
        ctx.beginPath();
        parseClipPolygon(layer.clipPath).forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.x * width, point.y * height);
          else ctx.lineTo(point.x * width, point.y * height);
        });
        ctx.closePath();
        ctx.clip();
      }
      const rect = containedImageRect(width, height, image.naturalWidth, image.naturalHeight);
      ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
      ctx.restore();
    }
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法生成 PNG，请重试')), 'image/png');
    });
  } finally {
    images.forEach(({ revoke }) => revoke());
  }
}

async function loadImage(src: string): Promise<LoadedImage> {
  const blob = await fetchImageBlob(src);
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('图层图片加载超时，请重试'));
      }, 30_000);
      const cleanup = () => {
        window.clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
      };
      image.onload = () => { cleanup(); resolve(); };
      image.onerror = () => { cleanup(); reject(new Error('图层图片无法解码，请重新上传后重试')); };
      image.src = url;
    });
    return { image, revoke: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function fetchImageBlob(src: string): Promise<Blob> {
  const url = new URL(src, window.location.href);
  try {
    return await fetchBlob(url.href);
  } catch (error) {
    // Reuse the existing SSRF-protected image proxy only when a remote CDN
    // refuses browser access. Inline/local images do not go to the backend.
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === window.location.origin) throw error;
    return fetchBlob(`${API_BASE}/proxy-image?url=${encodeURIComponent(url.href)}`);
  }
}

async function fetchBlob(url: string): Promise<Blob> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`图片读取失败 (${response.status})`);
    return await response.blob();
  } finally {
    window.clearTimeout(timer);
  }
}
