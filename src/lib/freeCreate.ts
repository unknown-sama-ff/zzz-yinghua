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

/**
 * References one free-creation turn may attach. Fixed rather than derived from the
 * model table: the server applies its own free-creation ceiling for these requests.
 */
export const MAX_FREE_CREATE_REFERENCES = 16;

export function buildFreeCreateRequest({
  prompt,
  contextImageUrl,
  references,
  credentials,
  useServerPreset,
}: BuildFreeCreateRequestInput): GenRequest {
  if (references.length > MAX_FREE_CREATE_REFERENCES) {
    throw new Error(`单轮最多支持 ${MAX_FREE_CREATE_REFERENCES} 张参考图`);
  }

  const primaryImage = contextImageUrl ?? references[0]?.dataUrl;
  const additionalReferences = contextImageUrl ? references : references.slice(1);
  const primary = primaryImage ? parseDataUrl(primaryImage) : undefined;

  return {
    provider: 'gpt-image',
    prompt,
    n: 1,
    freeCreate: true,
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
