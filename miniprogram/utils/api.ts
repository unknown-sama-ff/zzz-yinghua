import { request, fetchBinaryToFile } from './request';
import { uploadFile } from './upload';
import { cacheFilePath, writeBase64File } from './image';
import { USE_SERVER_PRESET, STORAGE_OPENID } from './constants';

// ── Auth ─────────────────────────────────────────────────────────────────────

export function wechatLogin(code: string): Promise<{ openid: string }> {
  return request('/auth/wechat-login', { method: 'POST', data: { code } });
}

/** Ensure an openid is available: read cache, else wx.login → code2session. */
export async function login(): Promise<string> {
  let openid = '';
  try {
    openid = (wx.getStorageSync(STORAGE_OPENID) as string) || '';
  } catch { /* ignore */ }
  if (openid) return openid;
  const code = await new Promise<string>((resolve, reject) => {
    wx.login({
      success: (r: any) => (r.code ? resolve(r.code) : reject(new Error('微信登录失败'))),
      fail: () => reject(new Error('微信登录失败')),
    });
  });
  const res = await wechatLogin(code);
  wx.setStorageSync(STORAGE_OPENID, res.openid);
  return res.openid;
}

// ── Generate (multipart upload + asyncMode polling) ──────────────────────────

export interface GenerateParams {
  filePath: string; // local image to upload (composite result or base art)
  prompt: string;
  provider: 'seedream' | 'gpt-image';
  idempotencyKey: string;
}

export interface GenerateTask {
  taskId: string;
}

/** Upload one image and kick off async generation; returns the taskId. */
export async function generateAsync(params: GenerateParams): Promise<GenerateTask> {
  const data = await uploadFile('/generate', params.filePath, 'image', {
    prompt: params.prompt,
    provider: params.provider,
    idempotencyKey: params.idempotencyKey,
    asyncMode: 'true',
    useServerPreset: USE_SERVER_PRESET ? 'true' : 'false',
  });
  if (!data.ok || !data.taskId) {
    throw new Error(data.message || '生成请求失败');
  }
  return { taskId: data.taskId };
}

// ── Composite (server-side stitch / embed) ───────────────────────────────────

export interface ThumbSpec {
  url: string; // data URL or base64
  size?: number;
  position: 'bottom-left' | 'bottom-right';
}

/** Stitch images horizontally (三视图拼合). `images` are data URLs or base64. */
export async function compositeStitch(images: string[]): Promise<string> {
  const data = await request<{ ok: boolean; image: string }>('/composite', {
    method: 'POST',
    data: { op: 'stitch', images },
  });
  return data.image;
}

/** Embed thumbnail(s) into a base image. Returns a data URL. */
export async function compositeEmbed(base: string, thumbs: ThumbSpec[]): Promise<string> {
  const data = await request<{ ok: boolean; image: string }>('/composite', {
    method: 'POST',
    data: { op: 'embed', base, thumbs },
  });
  return data.image;
}

/** Download a generated image (binary) to a local cache file, return its path. */
export async function downloadTaskImage(taskId: string, index: number): Promise<string> {
  const filePath = cacheFilePath('png');
  await fetchBinaryToFile(`/task/${encodeURIComponent(taskId)}/images/${index}`, filePath);
  return filePath;
}

/** Convert a remote URL to a local file via the SSRF-guarded proxy. */
export async function proxyImageToFile(url: string): Promise<string> {
  const filePath = cacheFilePath('png');
  await fetchBinaryToFile(`/proxy-image?url=${encodeURIComponent(url)}`, filePath);
  return filePath;
}

// ── Payments (WeChat Pay JSAPI) ──────────────────────────────────────────────

export interface PaymentParams {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: string;
  paySign: string;
}

export interface SponsorOrder {
  orderNo: string;
  amount: string;
  status: string;
  channel: string;
  createdAt: string;
  paidAt: string | null;
}

export function createWechatOrder(
  amount: string,
  idempotencyKey: string,
  openid: string,
): Promise<{ order: SponsorOrder; payment: PaymentParams | null }> {
  return request('/payments/wechat/orders', {
    method: 'POST',
    data: { amount, idempotencyKey, openid },
  });
}

export function getOrder(orderNo: string): Promise<{ order: SponsorOrder }> {
  return request(`/payments/orders/${encodeURIComponent(orderNo)}`);
}

export function listOrders(): Promise<{ orders: SponsorOrder[] }> {
  return request('/payments/orders');
}

// ── Gallery ──────────────────────────────────────────────────────────────────

export interface GalleryRow {
  id: number;
  image_url: string;
  style: string;
  character_name: string;
  prompt: string;
  provider: string;
  created_at: string;
}

export function listGallery(limit = 20): Promise<{ rows: GalleryRow[] }> {
  return request(`/gallery?limit=${limit}`);
}

export interface GallerySaveParams {
  imageBase64: string;
  mime: string;
  style: string;
  characterName: string;
  prompt: string;
  provider: string;
  deleteToken: string;
}

export function saveGallery(params: GallerySaveParams): Promise<{ ok: boolean; row?: GalleryRow }> {
  return request('/gallery', { method: 'POST', data: params });
}

// ── Utility ──────────────────────────────────────────────────────────────────

/** Write a composite data URL (data:image/png;base64,...) to a local cache file. */
export async function dataUrlToFile(dataUrl: string): Promise<string> {
  const comma = dataUrl.indexOf(',');
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return writeBase64File(base64, 'png');
}
