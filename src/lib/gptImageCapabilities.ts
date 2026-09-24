import type { ProviderName } from '../types';

const MAX_INPUT_IMAGES_BY_MODEL: Record<string, number> = {
  'gpt-image-2.5-sunburst': 16,
};

function normalizeModel(model?: string): string {
  return model?.trim().toLowerCase() ?? '';
}

export function maxInputImagesForModel(provider: ProviderName, model?: string): number {
  if (provider !== 'gpt-image') return 1;
  return MAX_INPUT_IMAGES_BY_MODEL[normalizeModel(model)] ?? 1;
}

export function maxReferenceImagesForModel(provider: ProviderName, model?: string): number {
  return Math.max(0, maxInputImagesForModel(provider, model) - 1);
}

export function supportsMultipleImageInputs(provider: ProviderName, model?: string): boolean {
  return maxInputImagesForModel(provider, model) > 1;
}

/**
 * gpt-image takes pixel dimensions, not ratios. 1:1, 4:3 and 3:4 land on
 * OpenAI's documented sizes; 16:9 and 9:16 are relay-supported extras.
 */
const GPT_IMAGE_SIZE_BY_ASPECT_RATIO: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1536x864',
  '9:16': '864x1536',
  '4:3': '1536x1024',
  '3:4': '1024x1536',
};

export function gptImageSizeForAspectRatio(aspectRatio: string): string {
  return GPT_IMAGE_SIZE_BY_ASPECT_RATIO[aspectRatio.trim()] ?? '1024x1024';
}
