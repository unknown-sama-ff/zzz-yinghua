import type { ApiResponse, GenRequest } from '../types';
import { API_BASE } from './apiBase';
import { GENERATE_TIMEOUT_MS, JSON_WORKER_TIMEOUT_MS, POLL_DEADLINE_MS, POLL_INTERVAL_MS } from './constants';

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
      JSON_WORKER_TIMEOUT_MS,
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

// ── Shared primitives ────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const TIMEOUT_ERROR = new ApiError('UPSTREAM_TIMEOUT', '生成超时（上游耗时过长）// 请重试或稍后再试');
const NETWORK_ERROR = new ApiError('UNKNOWN', '无法连接到后端代理 // 请确认服务端已启动或网络连接');

/** Create an AbortController with an auto-fire timeout. */
function withAbortTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<{ data: T; clear: () => void }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fn(controller.signal).then(
    (data) => ({
      data,
      clear: () => clearTimeout(timer),
    }),
    (err) => {
      clearTimeout(timer);
      throw err;
    },
  );
}

/** Wrap a fetch call with abort-timeout + error normalization. */
async function fetchJson(
  url: string,
  init: RequestInit & { timeout?: number },
): Promise<ApiResponse> {
  const useWorker = init.timeout !== 0;
  const timeoutMs = init.timeout ?? GENERATE_TIMEOUT_MS;
  delete init.timeout;

  const { data: res, clear } = await withAbortTimeout(
    (signal) => fetch(url, { ...init, signal }),
    timeoutMs,
  );

  clear();

  if (!res.ok) {
    throw new ApiError('UPSTREAM_ERROR', `服务端返回异常 (${res.status})`);
  }

  try {
    return useWorker ? await parseJsonOffThread(res) : (await res.json()) as ApiResponse;
  } catch {
    throw new ApiError('UPSTREAM_ERROR', `服务端返回异常 (${res.status})`);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollTask(taskId: string): Promise<string[]> {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(`${API_BASE}/task/${encodeURIComponent(taskId)}`);
    if (!res.ok) continue;
    const data = (await res.json()) as ApiResponse;
    if (!data.ok) throw new ApiError(data.code, data.message);
    if (data.images && data.images.length > 0) return data.images;
    if (data.taskId && data.images?.length === 0) continue; // still processing
  }
  throw new ApiError('UPSTREAM_TIMEOUT', '生图任务轮询超时');
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function generate(req: GenRequest): Promise<string[]> {
  try {
    const data = await fetchJson(`${API_BASE}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      timeout: GENERATE_TIMEOUT_MS,
    });

    if (!data.ok) {
      throw new ApiError(data.code, data.message);
    }

    if (data.taskId) {
      return pollTask(data.taskId);
    }

    return data.images;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') throw TIMEOUT_ERROR;
    throw NETWORK_ERROR;
  }
}

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
  const {
    imageDataUrl,
    maskDataUrl,
    maskBlobUrl,
    prompt,
    provider = 'gpt-image',
    model,
    apiKey,
    baseUrl,
    useServerPreset,
  } = params;

  function parseDataUrl(dataUrl: string): { base64: string; mime: string } {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('Invalid data URL');
    return { base64: match[2], mime: match[1] };
  }

  function base64ToUint8Array(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  const { base64: imageBase64, mime: imageMime } = parseDataUrl(imageDataUrl);
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

  if (maskBlobUrl) {
    const maskBlob = await fetch(maskBlobUrl).then((r) => r.blob());
    form.append('mask', maskBlob, 'mask.png');
  } else if (maskDataUrl) {
    const { base64: maskBase64, mime: maskMime } = parseDataUrl(maskDataUrl);
    const maskBytes = base64ToUint8Array(maskBase64);
    const maskBlob = new Blob([maskBytes as BlobPart], { type: maskMime });
    const maskExt = maskMime === 'image/jpeg' || maskMime === 'image/jpg' ? 'jpg' : 'png';
    form.append('mask', maskBlob, `mask.${maskExt}`);
  }

  try {
    const data = await fetchJson(`${API_BASE}/inpaint`, {
      method: 'POST',
      body: form,
      timeout: GENERATE_TIMEOUT_MS,
    });

    if (!data.ok) {
      throw new ApiError(data.code, data.message);
    }

    if (data.taskId) {
      return pollTask(data.taskId);
    }

    return data.images;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') throw TIMEOUT_ERROR;
    throw NETWORK_ERROR;
  }
}

