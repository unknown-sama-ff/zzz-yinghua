export interface FaceBounds {
  faceTop: number;
  faceBottom: number;
  faceLeft: number;
  faceRight: number;
  bodyAxisAngle: number;
}

/**
 * Resize a data URL image to fit within maxDim (longest side), keeping aspect ratio.
 * Returns a much smaller base64 for faster vision-model processing.
 */
function resizeDataUrl(dataUrl: string, maxDim: number = 384): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('resizeDataUrl: no 2d context'));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('resizeDataUrl: image load failed'));
    img.src = dataUrl;
  });
}

export async function detectFace(
  imageBase64: string,
  imageMime: string,
  opts?: { apiKey?: string; baseUrl?: string; model?: string; useServerPreset?: boolean },
): Promise<FaceBounds> {
  // Resize to max 384px before sending for fast vision-model turnaround.
  const small = await resizeDataUrl(`data:${imageMime};base64,${imageBase64}`, 384);
  const parsed = small.split(',');
  const smallBase64 = parsed[1] || imageBase64;
  const smallMime = small.startsWith('data:image/jpeg') ? 'image/jpeg' : imageMime;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    const res = await fetch('/api/detect-face', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: smallBase64, imageMime: smallMime, ...opts }),
      signal: controller.signal,
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.message ?? '人脸检测失败');
    return {
      faceTop: json.faceTop,
      faceBottom: json.faceBottom,
      faceLeft: json.faceLeft,
      faceRight: json.faceRight,
      bodyAxisAngle: json.bodyAxisAngle ?? 8,
    };
  } catch (err: any) {
    if (err.name === 'AbortError') throw new Error('人脸检测超时，请重试');
    if (err instanceof TypeError && err.message === 'Failed to fetch') {
      throw new Error('网络连接失败，请检查网络后重试');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
