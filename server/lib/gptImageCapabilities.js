const MAX_INPUT_IMAGES_BY_MODEL = new Map([
  ['gpt-image-2.5-sunburst', 16],
]);

export function maxInputImagesForGptModel(model) {
  return MAX_INPUT_IMAGES_BY_MODEL.get(String(model || '').trim().toLowerCase()) ?? 1;
}

const BASE_QUALITIES = Object.freeze(['auto', 'low', 'medium', 'high']);
const EXTENDED_QUALITIES = Object.freeze([...BASE_QUALITIES, 'xhigh', 'max']);
const EXTENDED_QUALITY_MODELS = new Set(['gpt-image-2.5', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']);

export function gptImageQualityOptionsForModel(model) {
  return EXTENDED_QUALITY_MODELS.has(String(model || '').trim().toLowerCase())
    ? EXTENDED_QUALITIES : BASE_QUALITIES;
}

export function resolveGptImageModel(req) {
  return req.useServerPreset === true ? (process.env.GPT_IMAGE_MODEL || 'gpt-image-2') : req.model;
}

/** Shared by generation and inpaint; run before spending any preset budget. */
export function validateGptImageQuality(req) {
  if (req.provider !== 'gpt-image' || req.quality === undefined) return null;
  if (typeof req.quality !== 'string' || !EXTENDED_QUALITIES.includes(req.quality)) {
    return '无效的生成精细度';
  }
  if (!gptImageQualityOptionsForModel(resolveGptImageModel(req)).includes(req.quality)) {
    return '当前模型不支持所选生成精细度，请选择自动、低、中或高';
  }
  return null;
}
