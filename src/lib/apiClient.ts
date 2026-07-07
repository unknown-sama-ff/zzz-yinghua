import type { ApiResponse, GenRequest } from '../types';

/**
 * Call the Node proxy to generate images. The proxy handles upstream auth,
 * retries, timeouts and long-task polling, then returns the unified envelope.
 */
export async function generate(req: GenRequest): Promise<string[]> {
  // gpt-image edits can take ~60s+; keep the connection alive well past that so
  // a slow-but-successful upstream isn't reported as a "can't reach backend" error.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240000);
  let res: Response;
  try {
    res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('UPSTREAM_TIMEOUT', '生成超时（上游耗时过长）// 请重试或稍后再试');
    }
    throw new ApiError('UNKNOWN', '无法连接到后端代理 // 请确认服务端已启动或网络连接');
  } finally {
    clearTimeout(timer);
  }

  let data: ApiResponse;
  try {
    data = (await res.json()) as ApiResponse;
  } catch {
    throw new ApiError('UPSTREAM_ERROR', `服务端返回异常 (${res.status})`);
  }

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
