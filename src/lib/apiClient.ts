import type { ApiResponse, GenRequest } from '../types';

/**
 * Call the Node proxy to generate images. The proxy handles upstream auth,
 * retries, timeouts and long-task polling, then returns the unified envelope.
 */
export async function generate(req: GenRequest): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch {
    throw new ApiError('UNKNOWN', '无法连接到后端代理 // 请确认服务端已启动');
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
