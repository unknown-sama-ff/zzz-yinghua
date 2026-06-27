export interface FaceBounds {
  faceTop: number;
  faceBottom: number;
}

export async function detectFace(
  imageBase64: string,
  imageMime: string,
  opts?: { apiKey?: string; baseUrl?: string; model?: string },
): Promise<FaceBounds> {
  const res = await fetch('/api/detect-face', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, imageMime, ...opts }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.message ?? '人脸检测失败');
  return { faceTop: json.faceTop, faceBottom: json.faceBottom };
}
