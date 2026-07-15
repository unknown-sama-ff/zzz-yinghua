import type { ApiResponse, GenRequest } from '../types';
import { API_BASE } from './apiBase';

// ── JSON-parse Worker (offload res.json() from the main thread) ───────────────

const JSON_WORKER_TIMEOUT = 60_000;

let jsonWorker: Worker | null = null;

function getJsonWorker(): Worker | null {
  if (!jsonWorker) {
    try {
      jsonWorker = new Worker(new URL('../workers/jsonWorker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      return null;
    }
  }
  return jsonWorker;
}

async function parseJsonOffThread(response: Response): Promise<ApiResponse> {
  const worker = getJsonWorker();
  if (!worker) {
    return response.json();
  }

  const buffer = await response.clone().arrayBuffer();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('json worker timed out')),
      JSON_WORKER_TIMEOUT,
    );
    const handler = (e: MessageEvent) => {
      const data = e.data as { type: string; data?: ApiResponse; message?: string };
      if (!data || typeof data !== 'object') return;
      clearTimeout(timer);
      worker.removeEventListener('message', handler);
      if (data.type === 'result' && data.data) {
        resolve(data.data);
      } else {
        reject(new Error(data.message ?? 'json worker error'));
      }
    };
    worker.addEventListener('message', handler);
    worker.postMessage(buffer, [buffer]);
  });
}

/**
 * Call the Node proxy to generate images. The proxy handles upstream auth,
 * retries, timeouts and long-task polling, then returns the unified envelope.
 *
 * The response body (potentially multi-MB with embedded base64 images) is
 * parsed in a Web Worker so JSON.parse doesn't block the main thread.
 */
export async function generate(req: GenRequest): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 360000);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('UPSTREAM_TIMEOUT', '生成超时（上游耗时过长）// 请重试或稍后再试');
    }
    throw new ApiError('UNKNOWN', '无法连接到后端代理 // 请确认服务端已启动或网络连接');
  }

  let data: ApiResponse;
  try {
    data = await parseJsonOffThread(res);
  } catch {
    clearTimeout(timer);
    throw new ApiError('UPSTREAM_ERROR', `服务端返回异常 (${res.status})`);
  }
  clearTimeout(timer);

  if (!data.ok) {
    throw new ApiError(data.code, data.message);
  }

  // Long-task: if the backend returns a task_id, poll until completion.
  const taskId = data.taskId;
  if (taskId) {
    const images = await pollTask(taskId);
    return images;
  }

  return data.images;
}

async function pollTask(taskId: string): Promise<string[]> {
  const maxMs = 180_000;
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await sleep(3000);
    const res = await fetch(`${API_BASE}/task/${encodeURIComponent(taskId)}`);
    if (!res.ok) continue;
    const data = (await res.json()) as ApiResponse;
    if (!data.ok) throw new ApiError(data.code, data.message);
    if (data.images && data.images.length > 0) return data.images;
    if (data.taskId && data.images?.length === 0) continue; // still processing
  }
  throw new ApiError('UPSTREAM_TIMEOUT', '生图任务轮询超时');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Call the inpaint endpoint. Uses multipart/form-data with image + optional mask.
 */
export async function inpaint(params: {
  imageDataUrl: string;
  maskDataUrl?: string;
  maskBlobUrl?: string;
  prompt: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  useServerPreset?: boolean;
}): Promise<string[]> {
  const { imageDataUrl, maskDataUrl, maskBlobUrl, prompt, provider = 'gpt-image', model, apiKey, baseUrl, useServerPreset } = params;

  // Parse data URLs to extract base64 and mime
  function parseDataUrl(dataUrl: string): { base64: string; mime: string } {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('Invalid data URL');
    return { base64: match[2], mime: match[1] };
  }

  const { base64: imageBase64, mime: imageMime } = parseDataUrl(imageDataUrl);

  // Convert base64 string to Uint8Array for FormData Blob
  function base64ToUint8Array(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  const imageBytes = base64ToUint8Array(imageBase64);
  const imageBlob = new Blob([imageBytes as BlobPart], { type: imageMime });
  const imageExt = imageMime === 'image/jpeg' || imageMime === 'image/jpg' ? 'jpg' : 'png';

  const form = new FormData();
  form.append('image', imageBlob, `image.${imageExt}`);
  form.append('prompt', prompt);
  form.append('provider', provider);
  if (model) form.append('model', model);
  if (apiKey) form.append('apiKey', apiKey);
  if (baseUrl) form.append('baseUrl', baseUrl);
  if (useServerPreset) form.append('useServerPreset', 'true');

  // Prefer blob URL (memory-efficient) over base64 dataUrl
  if (maskBlobUrl) {
    const maskBlob = await fetch(maskBlobUrl).then(r => r.blob());
    form.append('mask', maskBlob, 'mask.png');
  } else if (maskDataUrl) {
    const { base64: maskBase64, mime: maskMime } = parseDataUrl(maskDataUrl);
    const maskBytes = base64ToUint8Array(maskBase64);
    const maskBlob = new Blob([maskBytes as BlobPart], { type: maskMime });
    const maskExt = maskMime === 'image/jpeg' || maskMime === 'image/jpg' ? 'jpg' : 'png';
    form.append('mask', maskBlob, `mask.${maskExt}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 360000);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/inpaint`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('UPSTREAM_TIMEOUT', '生成超时（上游耗时过长）// 请重试或稍后再试');
    }
    throw new ApiError('UNKNOWN', '无法连接到后端代理 // 请确认服务端已启动或网络连接');
  }

  let data: ApiResponse;
  try {
    data = (await res.json()) as ApiResponse;
  } catch {
    clearTimeout(timer);
    throw new ApiError('UPSTREAM_ERROR', `服务端返回异常 (${res.status})`);
  }
  clearTimeout(timer);

  if (!data.ok) {
    throw new ApiError(data.code, data.message);
  }

  const taskId = data.taskId;
  if (taskId) {
    const images = await pollTask(taskId);
    return images;
  }

  return data.images;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
