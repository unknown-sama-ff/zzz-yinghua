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
  /** How many images to generate this turn (1–5). Server preset forces this to 1. */
  imageCount: number;
}

/**
 * References one free-creation turn may attach. Fixed rather than derived from the
 * model table: the server applies its own free-creation ceiling for these requests.
 */
export const MAX_FREE_CREATE_REFERENCES = 16;

/** Images a single free-creation turn may generate. */
export const MIN_FREE_CREATE_IMAGES = 1;
export const MAX_FREE_CREATE_IMAGES = 5;

export function buildFreeCreateRequest({
  prompt,
  contextImageUrl,
  references,
  credentials,
  useServerPreset,
  imageCount,
}: BuildFreeCreateRequestInput): GenRequest {
  if (references.length > MAX_FREE_CREATE_REFERENCES) {
    throw new Error(`单轮最多支持 ${MAX_FREE_CREATE_REFERENCES} 张参考图`);
  }

  const primaryImage = contextImageUrl ?? references[0]?.dataUrl;
  const additionalReferences = contextImageUrl ? references : references.slice(1);
  const primary = primaryImage ? parseDataUrl(primaryImage) : undefined;
  const clampedCount = Math.max(MIN_FREE_CREATE_IMAGES, Math.min(MAX_FREE_CREATE_IMAGES, Math.round(imageCount)));

  return {
    provider: 'gpt-image',
    prompt,
    // The server preset path forces n:1 server-side regardless of what's sent
    // (see server/providers.js capN) to protect the shared daily budget — a
    // self-supplied key is required to actually generate more than one.
    n: useServerPreset ? 1 : clampedCount,
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
