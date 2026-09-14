import type { YinghuaStyleId } from '../types';

const STYLE_REFERENCE_URLS: Record<YinghuaStyleId, string[]> = {
  1: [
    '/影画样式1/DM_20260627161836_002.webp',
    '/影画样式1/DM_20260627161836_005.webp',
    '/影画样式1/DM_20260627161836_008.webp',
  ],
  2: [
    '/影画样式2/DM_20260627161836_003.webp',
    '/影画样式2/DM_20260627161836_006.webp',
    '/影画样式2/DM_20260627161836_009.webp',
  ],
  3: [
    '/影画样式3/DM_20260627161836_004.webp',
    '/影画样式3/DM_20260627161836_007.webp',
    '/影画样式3/DM_20260627161836_010.webp',
  ],
};

const styleReferenceCache = new Map<YinghuaStyleId, Promise<string[]>>();

async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`参考图加载失败: ${url}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`参考图读取失败: ${url}`));
    reader.readAsDataURL(blob);
  });
}

export function loadStyleReferenceImages(styleId: YinghuaStyleId): Promise<string[]> {
  const cached = styleReferenceCache.get(styleId);
  if (cached) return cached;

  const promise = Promise.all(STYLE_REFERENCE_URLS[styleId].map(urlToDataUrl)).catch((err) => {
    styleReferenceCache.delete(styleId);
    throw err;
  });
  styleReferenceCache.set(styleId, promise);
  return promise;
}

export function preloadStyleReferenceImages(styleIds: YinghuaStyleId[] = [1, 2, 3]): Promise<void> {
  return Promise.all(styleIds.map(loadStyleReferenceImages)).then(() => undefined);
}
