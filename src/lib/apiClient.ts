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
