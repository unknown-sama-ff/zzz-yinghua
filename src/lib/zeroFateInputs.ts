import type { ProviderName } from '../types';
import { maxReferenceImagesForModel, supportsMultipleImageInputs } from './gptImageCapabilities';
import { stitchImages, embedThumbnails } from './imageWorkerPool';
import type { ThumbEntry } from './imageWorkerPool';
import { loadStyleReferenceImages } from './styleReferences';
import { compressDataUrl, parseDataUrl } from './validation';
import { ZERO_FATE_INPUT_MAX_DIM } from './constants';
import { imageAsDataUrl as asDataUrl } from './characterReferenceInputs';
import { uniqueImages } from './characterOriginals';

export async function prepareZeroFateInputs(options: {
  phase: 'draft' | 'render' | 'direct';
  sourceImage: string;
  originalImages?: string[];
  addonImage: string | null;
  breakdownImage?: string | null;
  draftImage?: string;
  provider: ProviderName;
  model: string;
}) {
  const { phase, sourceImage, addonImage, breakdownImage, draftImage, provider, model } = options;
  const originals = uniqueImages(options.originalImages?.length ? options.originalImages : [sourceImage]);
  const base = phase === 'render' ? draftImage : originals[0];
  if (!base) throw new Error('请先生成并确认动作底稿');
  const styles = phase !== 'draft' ? await loadStyleReferenceImages(1) : [];
  const references = uniqueImages([...originals, sourceImage, breakdownImage, addonImage, ...styles]).filter((url) => url !== base);
  let imageOverride = base;
  let refImages: { base64: string; mime: string }[] | undefined;
  if (supportsMultipleImageInputs(provider, model)) {
    if (references.length > maxReferenceImagesForModel(provider, model)) {
      throw new Error('当前模型支持的参考图数量不足，请切换模型');
    }
    refImages = await Promise.all(references.map(async (url) => parseDataUrl(await asDataUrl(url))));
  } else if (phase !== 'render') {
    if (references.length) imageOverride = await stitchImages(await Promise.all([base, ...references].map(asDataUrl)));
  } else {
    // Preserve the approved draft's canvas and subject scale for single-image
    // endpoints, using the same thumbnail convention as later yinghua edits.
    const originalSheet = originals.length > 1 ? await stitchImages(await Promise.all(originals.map(asDataUrl))) : originals[0];
    const thumbs: ThumbEntry[] = [{ url: originalSheet, size: 0.23, position: 'bottom-right' }];
    if (!originals.includes(sourceImage)) thumbs.push({ url: sourceImage, size: 0.18, position: 'bottom-right' });
    if (breakdownImage) thumbs.push({ url: breakdownImage, size: 0.25, position: 'bottom-right' });
    if (addonImage) thumbs.push({ url: addonImage, size: 0.18, position: 'bottom-right' });
    thumbs.push({ url: await stitchImages(styles), size: 0.25, position: 'bottom-left' });
    imageOverride = await embedThumbnails(base, thumbs);
  }
  imageOverride = provider === 'gpt-image'
    ? await compressDataUrl(imageOverride, phase === 'direct' ? 1024 : ZERO_FATE_INPUT_MAX_DIM)
    : await asDataUrl(imageOverride);
  return { imageOverride, refImages };
}
