import type { GenRequest } from '../types';

/** An output-quality constraint; keep the requested content and style authoritative. */
export const DENOISE_PROMPT = '【降噪与细节保真】在满足上述创作或编辑要求的前提下，减少非刻意的颗粒噪点、杂色、色块、压缩伪影与边缘毛刺；保持轮廓清晰、色彩过渡自然，保留发丝、衣料纹理、皮肤和机械结构等有效细节。保留原定画风、笔触及刻意的胶片颗粒，不以磨皮、模糊、过度锐化或塑料质感代替细节。不要因降噪改变角色身份、体态、构图、动作、文字或透明背景；局部编辑时仅在允许编辑的范围内处理。';

export function appendDenoisePrompt(prompt: string, enabled: boolean): string {
  return enabled && !prompt.includes(DENOISE_PROMPT) ? `${prompt}\n\n${DENOISE_PROMPT}` : prompt;
}

/** Store the choice in the request so queued work/retries ignore later toggles. */
export function withDenoise(request: GenRequest, enabled: boolean): GenRequest {
  return {
    ...request,
    denoiseEnabled: enabled,
    prompt: appendDenoisePrompt(request.prompt, enabled),
    ...(enabled && request.provider === 'gpt-image' ? {
      preserveInputQuality: true,
      inputImageMaxDimension: request.inputImageMaxDimension ?? 1536,
    } : {}),
  };
}
