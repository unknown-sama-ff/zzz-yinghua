import { API_BASE, STORAGE_OPENID } from './constants';

interface UploadResult {
  ok: boolean;
  code?: string;
  message?: string;
  taskId?: string;
  [key: string]: unknown;
}

/**
 * Upload a local file via wx.uploadFile (multipart/form-data), injecting
 * x-openid when available. `formData` values must be strings.
 */
export function uploadFile(
  urlPath: string,
  filePath: string,
  name: string,
  formData: Record<string, string>,
): Promise<UploadResult> {
  let openid = '';
  try {
    openid = (wx.getStorageSync(STORAGE_OPENID) as string) || '';
  } catch { /* ignore */ }

  return new Promise<UploadResult>((resolve, reject) => {
    wx.uploadFile({
      url: API_BASE + urlPath,
      filePath,
      name,
      formData,
      timeout: 120000,
      header: openid ? { 'x-openid': openid } : {},
      success: (res: any) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(res.data) as UploadResult);
          } catch {
            reject(new Error('服务端返回异常'));
          }
        } else {
          let message = `请求失败 (${res.statusCode})`;
          try {
            const parsed = JSON.parse(res.data) as { message?: string };
            if (parsed.message) message = parsed.message;
          } catch { /* keep default */ }
          reject(new Error(message));
        }
      },
      fail: () => reject(new Error('网络请求失败，请检查网络连接')),
    });
  });
}
