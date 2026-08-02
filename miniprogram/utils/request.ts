import { API_BASE, POLL_DEADLINE_MS, POLL_INTERVAL_MS, STORAGE_OPENID } from './constants';

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function getOpenid(): string {
  try {
    return (wx.getStorageSync(STORAGE_OPENID) as string) || '';
  } catch {
    return '';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  data?: object;
  timeout?: number;
}

/** Promise wrapper around wx.request with x-openid injection + error normalization. */
export function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const openid = getOpenid();
  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: API_BASE + url,
      method: options.method || 'GET',
      data: options.data,
      timeout: options.timeout || 60000,
      header: {
        'content-type': 'application/json',
        ...(openid ? { 'x-openid': openid } : {}),
      },
      success: (res: any) => {
        const data = res.data as { ok?: boolean; code?: string; message?: string } | undefined;
        if (res.statusCode >= 200 && res.statusCode < 300 && data && data.ok !== false) {
          resolve(data as T);
          return;
        }
        reject(new ApiError(data?.code || 'UNKNOWN', data?.message || `请求失败 (${res.statusCode})`));
      },
      fail: () => reject(new ApiError('NETWORK', '网络请求失败，请检查网络连接')),
    });
  });
}

/** Fetch a binary (image) with responseType arraybuffer, write to a local file. */
export function fetchBinaryToFile(url: string, filePath: string): Promise<string> {
  const openid = getOpenid();
  return new Promise((resolve, reject) => {
    wx.request({
      url: API_BASE + url,
      method: 'GET',
      responseType: 'arraybuffer',
      timeout: 60000,
      header: openid ? { 'x-openid': openid } : {},
      success: (res: any) => {
        if (res.statusCode !== 200 || !(res.data instanceof ArrayBuffer)) {
          reject(new ApiError('UNKNOWN', `图片下载失败 (${res.statusCode})`));
          return;
        }
        wx.getFileSystemManager().writeFile({
          filePath,
          data: res.data as ArrayBuffer,
          success: () => resolve(filePath),
          fail: () => reject(new ApiError('UNKNOWN', '写入本地图片失败')),
        });
      },
      fail: () => reject(new ApiError('NETWORK', '图片下载失败')),
    });
  });
}

/** Poll an async generate task until done; returns the image count. */
export async function pollTask(taskId: string): Promise<number> {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const meta = await request<{ ok: boolean; status: string; count: number; error?: string }>(
      `/task/${encodeURIComponent(taskId)}?metadata=1`,
      { timeout: POLL_INTERVAL_MS + 5000 },
    );
    if (meta.status === 'done') return meta.count || 0;
    if (meta.status === 'error') throw new ApiError('UPSTREAM_ERROR', meta.error || '生成失败');
  }
  throw new ApiError('UPSTREAM_TIMEOUT', '生图任务轮询超时');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
