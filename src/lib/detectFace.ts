export interface FaceBounds {
  faceTop: number;
  faceBottom: number;
  faceLeft: number;
  faceRight: number;
  bodyAxisAngle: number;
}

export async function detectFace(
  imageBase64: string,
  imageMime: string,
  opts?: { apiKey?: string; baseUrl?: string; model?: string; useServerPreset?: boolean },
): Promise<FaceBounds> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetch('/api/detect-face', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, imageMime, ...opts }),
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
