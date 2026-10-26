import type { ProviderName } from '../types';
import { maxReferenceImagesForModel, supportsMultipleImageInputs } from './gptImageCapabilities';
import { stitchImages, embedThumbnails } from './imageWorkerPool';
import type { ThumbEntry } from './imageWorkerPool';
import { loadStyleReferenceImages } from './styleReferences';
import { compressDataUrl, parseDataUrl } from './validation';
import { ZERO_FATE_INPUT_MAX_DIM } from './constants';

async function asDataUrl(source: string): Promise<string> {
  if (!/^https?:\/\//.test(source)) return source;
  const response = await fetch(source);
  if (!response.ok) throw new Error('动作底稿或参考图读取失败，请重试');
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('动作底稿或参考图读取失败'));
    reader.readAsDataURL(blob);
  });
}

export async function prepareZeroFateInputs(options: {
  phase: 'draft' | 'render';
  sourceImage: string;
  addonImage: string | null;
  draftImage?: string;
  provider: ProviderName;
  model: string;
}) {
  const { phase, sourceImage, addonImage, draftImage, provider, model } = options;
  const base = phase === 'render' ? draftImage : sourceImage;
  if (!base) throw new Error('请先生成并确认动作底稿');
  const styles = phase === 'render' ? await loadStyleReferenceImages(1) : [];
  const references = (phase === 'render' ? [sourceImage, addonImage, ...styles] : [addonImage])
    .filter((url): url is string => Boolean(url));
  let imageOverride = base;
  let refImages: { base64: string; mime: string }[] | undefined;
  if (supportsMultipleImageInputs(provider, model)) {
    if (references.length > maxReferenceImagesForModel(provider, model)) {
      throw new Error('当前模型支持的参考图数量不足，请切换模型');
    }
    refImages = await Promise.all(references.map(async (url) => parseDataUrl(await asDataUrl(url))));
  } else if (phase === 'draft') {
    if (addonImage) imageOverride = await stitchImages([sourceImage, addonImage]);
  } else {
    // Preserve the approved draft's canvas and subject scale for single-image
    // endpoints, using the same thumbnail convention as later yinghua edits.
    const thumbs: ThumbEntry[] = [{ url: sourceImage, size: 0.23, position: 'bottom-right' }];
    if (addonImage) thumbs.push({ url: addonImage, size: 0.18, position: 'bottom-right' });
    thumbs.push({ url: await stitchImages(styles), size: 0.25, position: 'bottom-left' });
    imageOverride = await embedThumbnails(base, thumbs);
  }
  imageOverride = provider === 'gpt-image'
    ? await compressDataUrl(imageOverride, ZERO_FATE_INPUT_MAX_DIM)
    : await asDataUrl(imageOverride);
  return { imageOverride, refImages };
}
