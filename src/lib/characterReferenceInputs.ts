import type { ProviderName } from '../types';
import { maxReferenceImagesForModel, supportsMultipleImageInputs } from './gptImageCapabilities';
import { parseDataUrl } from './validation';
import { uniqueImages } from './characterOriginals';

export async function imageAsDataUrl(source: string): Promise<string> {
  if (!/^https?:\/\//i.test(source)) return source;
  const response = await fetch(source);
  if (!response.ok) throw new Error('角色参考图读取失败，请重试');
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('角色参考图读取失败'));
    reader.readAsDataURL(blob);
  });
}

export async function prepareCharacterReferenceInputs(options: {
  originals: string[]; threeView?: string; provider: ProviderName; model: string;
}) {
  const images = uniqueImages([...options.originals, options.threeView]);
  if (!images.length) throw new Error('请先上传原始角色参考图');
  if (supportsMultipleImageInputs(options.provider, options.model)) {
    if (images.length - 1 > maxReferenceImagesForModel(options.provider, options.model)) throw new Error('当前模型支持的参考图数量不足');
    const [imageOverride, ...references] = await Promise.all(images.map(imageAsDataUrl));
    return { imageOverride, refImages: references.map(parseDataUrl) };
  }
  const { stitchImages } = await import('./imageWorkerPool');
  return { imageOverride: await stitchImages(await Promise.all(images.map(imageAsDataUrl))) };
}
