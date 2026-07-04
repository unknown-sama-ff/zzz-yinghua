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
 */
export function useBuildRequest() {
  const { provider, uploadedImage, custom, creds, freeloadEnabled } = useStore();

  return (prompt: string, opts?: { imageOverride?: string; size?: string }): GenRequest => {
    const image = opts?.imageOverride ?? uploadedImage ?? undefined;
    const parsed = image ? parseDataUrl(image) : undefined;
    const req: GenRequest = {
      provider,
      prompt,
      imageBase64: parsed?.base64,
      imageMime: parsed?.mime,
      size: opts?.size,
      n: 1,
      ...(freeloadEnabled ? { useServerPreset: true } : {}),
    };
    if (provider === 'seedance' || provider === 'gpt-image') {
      const c = creds[provider];
      if (c.apiKey.trim()) req.apiKey = c.apiKey.trim();
      if (c.baseUrl.trim()) req.baseUrl = c.baseUrl.trim();
      if (c.model.trim()) req.model = c.model.trim();
    }
    if (provider === 'custom-url') {
      req.customEndpoint = custom.endpoint;
      req.customHeaders = parseHeaders(custom.headers);
      req.customBodyTemplate = custom.bodyTemplate || undefined;
    }
    return req;
  };
}
