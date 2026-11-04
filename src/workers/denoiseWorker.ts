import { denoisePixels, validateDenoiseDimensions, type DenoiseWorkerRequest, type DenoiseWorkerResponse } from '../lib/localDenoise';
import { validateImageFile } from '../lib/validation';

let original: ImageData | null = null;
const send = (message: DenoiseWorkerResponse) => self.postMessage(message);

self.onmessage = async (event: MessageEvent<DenoiseWorkerRequest>) => {
  try {
    if (event.data.type === 'prepare') {
      original = null;
      const validation = validateImageFile(event.data.file);
      if (!validation.ok) throw new Error(validation.message);
      if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') throw new Error('当前浏览器不支持后台图片处理，请使用新版 Chrome、Edge、Firefox 或 Safari。');
      const bitmap = await createImageBitmap(event.data.file);
      try {
        validateDenoiseDimensions(bitmap.width, bitmap.height);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('无法创建图片处理画布。');
        ctx.drawImage(bitmap, 0, 0);
        original = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        send({ type: 'ready', width: bitmap.width, height: bitmap.height });
      } finally { bitmap.close(); }
    } else if (event.data.type === 'run') {
      if (!original) throw new Error('请先选择图片。');
      const start = performance.now();
      const pixels = denoisePixels(original.data, original.width, original.height, event.data.strength, (percent) => send({ type: 'progress', percent }));
      const canvas = new OffscreenCanvas(original.width, original.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建导出画布。');
      const imageData = ctx.createImageData(original.width, original.height);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      send({ type: 'result', blob, elapsedMs: performance.now() - start, strength: event.data.strength });
    }
  } catch (error) {
    const message = error instanceof DOMException && event.data.type === 'prepare'
      ? '图片无法解码，请重新导出为 PNG、JPEG 或 WebP 后重试。'
      : error instanceof Error ? error.message : '图片处理失败，请重试。';
    send({ type: 'error', message });
  }
};
