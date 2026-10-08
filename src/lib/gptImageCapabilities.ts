import type { GptImageQuality, ProviderName } from '../types';
import { API_BASE } from './apiBase';

export const GPT_IMAGE_QUALITY_LABELS: Record<GptImageQuality, string> = {
  auto: '自动', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高',
};
const BASE_QUALITIES: readonly GptImageQuality[] = ['auto', 'low', 'medium', 'high'];
const EXTENDED_QUALITIES: readonly GptImageQuality[] = [...BASE_QUALITIES, 'xhigh', 'max'];
const EXTENDED_QUALITY_MODELS = new Set(['gpt-image-2.5', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']);

export function gptImageQualityOptionsForModel(model?: string): readonly GptImageQuality[] {
  return EXTENDED_QUALITY_MODELS.has(normalizeModel(model)) ? EXTENDED_QUALITIES : BASE_QUALITIES;
}

export function isGptImageQuality(value: unknown): value is GptImageQuality {
  return typeof value === 'string' && EXTENDED_QUALITIES.some((quality) => quality === value);
}

/** Only public quality options are fetched; credentials never leave the server. */
export async function fetchPresetImageQualityOptions(): Promise<GptImageQuality[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(
      `${API_BASE}/image-capabilities`,
      { signal: controller.signal, cache: 'no-store' },
    );
    if (!response.ok) throw new Error('无法读取服务器精细度选项');
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('ok' in data) || data.ok !== true
      || !('presetQualityOptions' in data) || !Array.isArray(data.presetQualityOptions)
      || !data.presetQualityOptions.every(isGptImageQuality) || !data.presetQualityOptions.includes('auto')) {
      throw new Error('服务器精细度选项格式无效');
    }
    return [...new Set<GptImageQuality>(data.presetQualityOptions)];
  } finally {
    clearTimeout(timer);
  }
}

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
