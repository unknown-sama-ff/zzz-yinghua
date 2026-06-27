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
