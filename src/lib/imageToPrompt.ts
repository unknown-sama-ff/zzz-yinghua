import { API_BASE } from './apiBase';
import { VISION_TIMEOUT_MS } from './constants';

export const PROMPT_TARGETS = [
  { value: 'general', label: '通用生图' }, { value: 'midjourney', label: 'Midjourney' },
  { value: 'sdxl', label: 'Stable Diffusion / SDXL' }, { value: 'flux', label: 'FLUX' },
] as const;
export type PromptTarget = typeof PROMPT_TARGETS[number]['value'];
export interface ImagePromptResult {
  summary: string; promptZh: string; promptEn: string; negativePrompt: string; editablePrompt: string; tips: string;
}
export interface ImagePromptResponse { result: ImagePromptResult; image: { width: number; height: number; aspectRatio: string } }
export function formatImagePrompt(result: ImagePromptResult): string {
  return [['中文 Prompt', result.promptZh], ['English Prompt', result.promptEn], ['Negative Prompt', result.negativePrompt], ['可复用模板', result.editablePrompt], ['复刻建议', result.tips]]
    .filter(([, text]) => text.trim()).map(([title, text]) => `${title}\n${text}`).join('\n\n');
}

export async function reverseImagePrompt(file: File, options: {
  target: PromptTarget; focus: string; useServerPreset: boolean; apiKey?: string; baseUrl?: string; model?: string;
}, signal?: AbortSignal): Promise<ImagePromptResponse> {
  const form = new FormData();
  form.append('image', file);
  for (const [key, value] of Object.entries(options)) if (value !== undefined) form.append(key, String(value));
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, VISION_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/image-to-prompt`, { method: 'POST', body: form, signal: controller.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) throw new Error(data?.message || `图片反推失败 (${res.status})`);
    const result = data.result as ImagePromptResult | undefined;
    if (!result || !['summary', 'promptZh', 'promptEn', 'negativePrompt', 'editablePrompt', 'tips'].every((key) => typeof result[key as keyof ImagePromptResult] === 'string')
        || !data.image || !Number.isFinite(data.image.width) || !Number.isFinite(data.image.height) || typeof data.image.aspectRatio !== 'string') throw new Error('返回的提示词不完整，请重试');
    return { result, image: data.image };
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('反推超时，请稍后重试或更换视觉模型');
    if (error instanceof TypeError) throw new Error('无法连接图片反推服务，请检查网络和后端服务');
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
  }
}
