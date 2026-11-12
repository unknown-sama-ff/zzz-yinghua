// Match documented families and date snapshots, never arbitrary future aliases.
const KNOWN_GPT_IMAGE_MODEL = /^gpt-image-(?:1(?:\.5|-mini)?|2|2\.[56](?:-sunburst|-flare)?)(?:-\d{4}-\d{2}-\d{2})?$/;
const TRANSPARENT_GPT_IMAGE_MODEL = /^gpt-image-(?:1(?:\.5|-mini)?|2|2\.[56]-(?:sunburst|flare))(?:-\d{4}-\d{2}-\d{2})?$/;

function normalizedModel(model) {
  return String(model || '').trim().toLowerCase();
}

export function maxInputImagesForGptModel(model) {
  return KNOWN_GPT_IMAGE_MODEL.test(normalizedModel(model)) ? 16 : 1;
}

export function supportsGptImageTransparency(model) {
  return TRANSPARENT_GPT_IMAGE_MODEL.test(normalizedModel(model));
}

/** Validate before using any public generation budget or contacting upstream. */
export function validateGptImageBackground(req) {
  if (req.background === undefined) return null;
  if (!['transparent', 'opaque', 'auto'].includes(req.background)) return '无效的图片背景选项';
  if (req.provider !== 'gpt-image') return '图片背景选项仅支持 gpt-image 提供方';
  if (req.background === 'transparent') {
    if (['jpeg', 'gif'].includes(req.output_format)) return '透明背景仅支持 PNG 或 WebP 输出';
    if (!supportsGptImageTransparency(resolveGptImageModel(req))) return '当前模型未确认支持透明背景，请检查模型或服务器预设';
  }
  return null;
}

const BASE_QUALITIES = Object.freeze(['auto', 'low', 'medium', 'high']);
const EXTENDED_QUALITIES = Object.freeze([...BASE_QUALITIES, 'xhigh', 'max']);
const EXTENDED_QUALITY_MODELS = new Set(['gpt-image-2.5', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']);

export function gptImageQualityOptionsForModel(model) {
  const normalized = String(model || '').trim().toLowerCase();
  return EXTENDED_QUALITY_MODELS.has(normalized) || supportsGptImageGif(normalized)
    ? EXTENDED_QUALITIES : BASE_QUALITIES;
}

export function supportsGptImageGif(model) {
  return /^gpt-image-2\.6(?:-|$)/.test(String(model || '').trim().toLowerCase());
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
