import { useStore } from '../store/useStore';
import { parseDataUrl } from '../lib/validation';
import type { GenRequest } from '../types';

/** Parse "Key: Value" lines into a header record. */
export function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Build a GenRequest from current store state for a given prompt.
 * Reads provider, uploaded image and custom-url config.
 *
 * Size selection strategy:
 * - seedance: uses size (e.g. '2848x1600') for specific pixel dimensions
 * - gpt-image: uses size (e.g. '1536x1024') for fixed pixel dimensions
 * - custom-url: passes both size and aspectRatio (provider decides)
 */
export function useBuildRequest() {
  const { provider, uploadedImage, custom, creds, freeloadEnabled } = useStore();

  return (prompt: string, opts?: { imageOverride?: string; size?: string; aspectRatio?: string; refImages?: { base64: string; mime: string }[] }): GenRequest => {
    const image = opts?.imageOverride ?? uploadedImage ?? undefined;
    const parsed = image ? parseDataUrl(image) : undefined;

    // Smart defaults: if caller only provided one size param, fill the other based on provider
    let size = opts?.size;
    let aspectRatio = opts?.aspectRatio;

    if (provider === 'gpt-image') {
      // gpt-image prefers size; fall back to aspectRatio if size not provided
      if (!size && aspectRatio) {
        // Map aspect ratios to gpt-image supported sizes
        if (aspectRatio === '16:9') size = '1536x864';
        else if (aspectRatio === '9:16') size = '864x1536';
        else if (aspectRatio === '4:3') size = '1536x1024';
        else if (aspectRatio === '3:4') size = '1024x1536';
        else size = '1024x1024'; // 1:1 default
      }
    }

    const req: GenRequest = {
      provider,
      prompt,
      imageBase64: parsed?.base64,
      imageMime: parsed?.mime,
      size,
      aspectRatio,
      n: 1,
      refImages: opts?.refImages,
      ...(freeloadEnabled ? { useServerPreset: true } : {}),
    };
    if (provider === 'seedance' || provider === 'gpt-image') {
      const c = creds[provider];
      if (c.apiKey.trim()) req.apiKey = c.apiKey.trim();
      if (c.baseUrl.trim()) req.baseUrl = c.baseUrl.trim();
      if (c.model.trim()) req.model = c.model.trim();
    }
    if (provider === 'custom-url') {
      const c = creds['custom-url'];
      if (c.apiKey.trim()) req.customHeaders = { Authorization: `Bearer ${c.apiKey.trim()}` };
      if (c.baseUrl.trim()) req.customEndpoint = c.baseUrl.trim();
      if (c.model.trim()) req.model = c.model.trim();
      req.customBodyTemplate = custom.bodyTemplate || '{"model":"{model}","prompt":"{prompt}","n":1}';
    }
    return req;
  };
}
