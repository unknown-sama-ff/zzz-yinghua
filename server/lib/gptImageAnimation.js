import { resolveGptImageModel, supportsGptImageGif } from './gptImageCapabilities.js';

/** Validate before using any public generation budget or contacting the provider. */
export function validateGptImageAnimation(req, { editing = false } = {}) {
  const format = req.output_format;
  const hasFrames = req.frame_count !== undefined || req.frame_duration_ms !== undefined;
  if (format === undefined && !hasFrames) return null;
  if (format !== undefined && !['png', 'jpeg', 'webp', 'gif'].includes(format)) return '无效的图片输出格式';
  if (format !== 'gif') return hasFrames ? '动画帧参数仅适用于 GIF 输出' : null;
  if (req.provider !== 'gpt-image' || !supportsGptImageGif(resolveGptImageModel(req))) {
    return 'GIF 动画需要 GPT Image 2.6 系列模型，请检查模型或服务器预设';
  }
  if (editing || req.imageBase64 || req.refImages?.length || req.maskBase64 || req.image || req.mask) {
    return 'GIF 目前仅支持文字生成，请清除主图和参考图；图片编辑不支持 GIF 输出';
  }
  if (req.frame_count !== undefined && (!Number.isInteger(req.frame_count) || req.frame_count < 2 || req.frame_count > 64)) {
    return 'GIF 帧数必须为 2～64 的整数';
  }
  if (req.frame_duration_ms !== undefined && (!Number.isInteger(req.frame_duration_ms) || req.frame_duration_ms < 20 || req.frame_duration_ms > 2000)) {
    return 'GIF 每帧时长必须为 20～2000 毫秒的整数';
  }
  if ((req.stream !== undefined && req.stream !== false) || req.partial_images !== undefined
    || req.output_compression !== undefined || req.prompt_rewriter !== undefined) {
    return 'GIF 不支持流式输出、分段图片、自定义压缩或提示词重写';
  }
  if (req.aspectRatio !== undefined) return 'GIF 请使用 size 指定尺寸或使用 auto';
  if (req.size !== undefined && req.size !== 'auto') {
    const match = typeof req.size === 'string' && /^(\d+)x(\d+)$/.exec(req.size);
    const width = match && Number(match[1]); const height = match && Number(match[2]);
    if (!width || !height || width % 16 || height % 16 || width > 3840 || height > 3840 || width * height > 8_294_400) {
      return 'GIF 尺寸需为 auto 或不超过 3840 边长的 16 倍数尺寸，建议使用 auto';
    }
  }
  return null;
}
