import type { YinghuaStyleId } from '../types';
import { stitchImages } from './stitchImages';

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

const styleReferenceSheetCache = new Map<YinghuaStyleId, Promise<string>>();

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

async function buildStyleReferenceSheetUncached(styleId: YinghuaStyleId): Promise<string> {
  const urls = STYLE_REFERENCE_URLS[styleId];
  const dataUrls = await Promise.all(urls.map(urlToDataUrl));
  return stitchImages(dataUrls);
}

export function buildStyleReferenceSheet(styleId: YinghuaStyleId): Promise<string> {
  const cached = styleReferenceSheetCache.get(styleId);
  if (cached) return cached;

  const promise = buildStyleReferenceSheetUncached(styleId).catch((err) => {
    styleReferenceSheetCache.delete(styleId);
    throw err;
  });
  styleReferenceSheetCache.set(styleId, promise);
  return promise;
}

export function preloadStyleReferenceSheets(styleIds: YinghuaStyleId[] = [1, 2, 3]): Promise<void> {
  return Promise.all(styleIds.map((id) => buildStyleReferenceSheet(id))).then(() => undefined);
}
