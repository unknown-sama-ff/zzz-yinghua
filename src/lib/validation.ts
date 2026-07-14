export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export interface FileCheck {
  ok: boolean;
  message?: string;
}

/** Validate an uploaded image file against the type/size whitelist. */
export function validateImageFile(file: File): FileCheck {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { ok: false, message: '格式不支持 // 仅接受 PNG / JPEG / WEBP' };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: '文件过大 // 单文件上限 10 MB' };
  }
  return { ok: true };
}

/** Read a File as a data URL (base64). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/** Strip the `data:...;base64,` prefix, leaving raw base64. */
export function stripDataUrlPrefix(dataUrl: string): string {
  const idx = dataUrl.indexOf(',');
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

/**
 * Compress an image data URL to a smaller JPEG data URL. Resizes to max 1024px
 * on the longest side and uses 0.80 JPEG quality. Used to shrink API-returned
 * PNG images before re-sending them to another upstream API (e.g. gpt-image
 * /images/edits which is strict about payload size).
 *
 * Falls back to regular DOM canvas if OffscreenCanvas is not available.
 */
export async function compressDataUrl(
  dataUrl: string,
  maxDim = 1024,
  quality = 0.80,
): Promise<string> {
  // Handle remote URLs from upstream APIs — fetch and convert to data URL.
  let src = dataUrl;
  if (src.startsWith('http://') || src.startsWith('https://')) {
    const res = await fetch(src);
    const blob = await res.blob();
    src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  const { base64, mime } = parseDataUrl(src);

  // Decode base64 to a Blob
  const byteStr = atob(base64);
  const bytes = new Uint8Array(byteStr.length);
  for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });

  // Try OffscreenCanvas first (faster, doesn't need <img> in DOM)
  if (typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(blob);
      let { width, height } = bitmap;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const oc = new OffscreenCanvas(width, height);
      const ctx = oc.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0, width, height);
      const jpegBlob = await oc.convertToBlob({ type: 'image/jpeg', quality });
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(jpegBlob);
      });
    } catch (e) {
      console.warn('[compressDataUrl] OffscreenCanvas failed, falling back to DOM canvas:', e);
    }
  }

  // Fallback: regular DOM canvas
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (jpegBlob) => {
          if (!jpegBlob) return reject(new Error('canvas.toBlob returned null'));
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(jpegBlob);
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => reject(new Error('Failed to load image for compression'));
    img.src = dataUrl;
  });
}

/**
 * Parse a data URL into its mime type and raw base64. Falls back to image/png
 * when the prefix is missing or unparseable. Used so the backend can rebuild a
 * correctly-typed file for multipart image-edit uploads.
 */
export function parseDataUrl(dataUrl: string): { mime: string; base64: string } {
  const match = /^data:([^;,]+)[^,]*,(.*)$/s.exec(dataUrl);
  if (match) {
    return { mime: match[1] || 'image/png', base64: match[2] };
  }
  return { mime: 'image/png', base64: stripDataUrlPrefix(dataUrl) };
}
