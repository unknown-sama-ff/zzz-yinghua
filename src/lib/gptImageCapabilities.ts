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
