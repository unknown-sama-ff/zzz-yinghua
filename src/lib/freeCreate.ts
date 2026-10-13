import { gptImageSizeForAspectRatio } from './gptImageCapabilities';
import { parseDataUrl } from './validation';
import type { FreeCreateCostumeMode, FreeCreateMode, FreeCreateReference, GenRequest, GptImageQuality } from '../types';

interface GptImageCredentials {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface BuildFreeCreateRequestInput {
  prompt: string;
  quality?: GptImageQuality;
  contextImageUrl: string | null;
  references: FreeCreateReference[];
  sharedReference?: FreeCreateReference | null;
  credentials: GptImageCredentials;
  useServerPreset: boolean;
  /** How many images to generate this turn (1–5). */
  imageCount: number;
  /** One of FREE_CREATE_ASPECT_RATIOS; converted to a pixel size before sending. */
  aspectRatio: string;
}

/**
 * References one free-creation turn may attach. Fixed rather than derived from the
 * model table: the server applies its own free-creation ceiling for these requests.
 */
export const MAX_FREE_CREATE_REFERENCES = 16;
export const MAX_FREE_CREATE_INPUT_IMAGES = 17;
export const MAX_FREE_CREATE_REQUEST_BYTES = 50 * 1024 * 1024;

/** Images a single free-creation turn may generate. */
export const MIN_FREE_CREATE_IMAGES = 1;
export const MAX_FREE_CREATE_IMAGES = 5;

/** Selectable output ratios. Converted to pixel sizes before the request goes out. */
export const FREE_CREATE_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;
export const DEFAULT_FREE_CREATE_ASPECT_RATIO = '1:1';

export function buildFreeCreateRequest({
  prompt,
  quality,
  contextImageUrl,
  references,
  sharedReference,
  credentials,
  useServerPreset,
  imageCount,
  aspectRatio,
}: BuildFreeCreateRequestInput): GenRequest {
  if (references.length > MAX_FREE_CREATE_REFERENCES) {
    throw new Error(`单轮最多支持 ${MAX_FREE_CREATE_REFERENCES} 张参考图`);
  }

  const primaryImage = contextImageUrl ?? sharedReference?.dataUrl ?? references[0]?.dataUrl;
  const additionalReferences = contextImageUrl
    ? [...(sharedReference ? [sharedReference] : []), ...references]
    : sharedReference ? references : references.slice(1);
  if ((primaryImage ? 1 : 0) + additionalReferences.length > MAX_FREE_CREATE_INPUT_IMAGES) {
    throw new Error(`单轮最多支持 ${MAX_FREE_CREATE_INPUT_IMAGES} 张输入图（包含主图和共用图）`);
  }
  // The proxy resolves a remote primary image itself; treating its URL as base64
  // would corrupt a result reused as the next turn's context.
  const primary = primaryImage && !/^https?:\/\//i.test(primaryImage) ? parseDataUrl(primaryImage) : undefined;
  const clampedCount = Math.max(MIN_FREE_CREATE_IMAGES, Math.min(MAX_FREE_CREATE_IMAGES, Math.round(imageCount)));

  const request: GenRequest = {
    provider: 'gpt-image',
    ...(quality !== undefined ? { quality } : {}),
    prompt,
    n: clampedCount,
    // Send only `size`, never `aspectRatio`: the server forwards aspect_ratio and
    // drops size when it sees one (server/providers.js), but the OpenAI images
    // endpoint only understands size.
    size: gptImageSizeForAspectRatio(aspectRatio),
    freeCreate: true,
    ...(primary ? { imageBase64: primary.base64, imageMime: primary.mime } : {}),
    ...(primaryImage && !primary ? { imageBase64: primaryImage } : {}),
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
  assertFreeCreateRequestSize(request);
  return request;
}

/** Catch the proxy's JSON payload ceiling before creating any queue entries. */
export function assertFreeCreateRequestSize(request: GenRequest): void {
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > MAX_FREE_CREATE_REQUEST_BYTES - 1024) {
    throw new Error('图片总量过大，请减少参考图或压缩图片后再试（单次请求上限 50 MB）');
  }
}

export interface BuildFreeCreateBatchInput extends Omit<BuildFreeCreateRequestInput, 'references' | 'sharedReference'> {
  mode: Exclude<FreeCreateMode, 'conversation'>;
  sharedReference: FreeCreateReference;
  targets: FreeCreateReference[];
  costumeMode?: FreeCreateCostumeMode;
}

/** Each batch item has a deliberate primary/reference order and creates one image. */
export function buildFreeCreateBatchRequests(input: BuildFreeCreateBatchInput): { reference: FreeCreateReference; request: GenRequest }[] {
  if (!input.sharedReference) throw new Error(input.mode === 'fixed-character' ? '请上传共用角色三视图' : '请上传共用背景图');
  if (input.targets.length === 0) throw new Error(input.mode === 'fixed-character' ? '请添加待替换的目标图片' : '请添加角色三视图');
  if (input.targets.length > MAX_FREE_CREATE_REFERENCES) throw new Error(`单批最多支持 ${MAX_FREE_CREATE_REFERENCES} 个任务`);
  const costume = input.costumeMode === 'target'
    ? '保留主图中原人物的衣装，仅替换为参考图人物的身份、脸部和发型。'
    : '人物身份、脸部、发型和衣装均以角色三视图为准。';
  return input.targets.map((reference) => {
    const fixedCharacter = input.mode === 'fixed-character';
    const primary = fixedCharacter ? reference : input.sharedReference;
    const character = fixedCharacter ? input.sharedReference : reference;
    const instruction = fixedCharacter
      ? '图 1 是待修改的目标画面，图 2 是唯一的角色三视图。将目标画面中的主要人物替换为三视图角色，保留目标画面的构图、姿势、镜头、背景和画风。'
      : '图 1 是所有任务共用的场景，图 2 是本次要放入场景的角色三视图。保持场景、构图和镜头一致，将本次角色自然融入场景。';
    return {
      reference,
      request: buildFreeCreateRequest({
        ...input,
        prompt: `${instruction}\n${costume}\n用户要求：${input.prompt}`,
        contextImageUrl: primary.dataUrl,
        sharedReference: null,
        references: [character],
        imageCount: 1,
      }),
    };
  });
}
