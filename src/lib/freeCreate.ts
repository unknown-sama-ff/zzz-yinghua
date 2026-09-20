import { maxInputImagesForModel } from './gptImageCapabilities';
import { parseDataUrl } from './validation';
import type { FreeCreateReference, GenRequest } from '../types';

interface GptImageCredentials {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface BuildFreeCreateRequestInput {
  prompt: string;
  contextImageUrl: string | null;
  references: FreeCreateReference[];
  credentials: GptImageCredentials;
  useServerPreset: boolean;
}

export function maxFreeCreateReferenceImages(model: string, hasContextImage: boolean): number {
  const maxInputs = maxInputImagesForModel('gpt-image', model);
  return hasContextImage ? Math.max(0, maxInputs - 1) : maxInputs;
}

export function buildFreeCreateRequest({
  prompt,
  contextImageUrl,
  references,
  credentials,
  useServerPreset,
}: BuildFreeCreateRequestInput): GenRequest {
  const maxReferences = maxFreeCreateReferenceImages(credentials.model, Boolean(contextImageUrl));
  if (references.length > maxReferences) {
    throw new Error(`当前模型本轮最多支持 ${maxReferences} 张参考图`);
  }

  const primaryImage = contextImageUrl ?? references[0]?.dataUrl;
  const additionalReferences = contextImageUrl ? references : references.slice(1);
  const primary = primaryImage ? parseDataUrl(primaryImage) : undefined;

  return {
    provider: 'gpt-image',
    prompt,
    n: 1,
    ...(primary ? { imageBase64: primary.base64, imageMime: primary.mime } : {}),
    ...(additionalReferences.length > 0
      ? {
          refImages: additionalReferences.map((reference) => {
            const parsed = parseDataUrl(reference.dataUrl);
            return { base64: parsed.base64, mime: parsed.mime };
          }),
        }
      : {}),
    ...(useServerPreset
      ? { useServerPreset: true }
      : {
          ...(credentials.apiKey.trim() ? { apiKey: credentials.apiKey.trim() } : {}),
          ...(credentials.baseUrl.trim() ? { baseUrl: credentials.baseUrl.trim() } : {}),
          ...(credentials.model.trim() ? { model: credentials.model.trim() } : {}),
        }),
  };
}
