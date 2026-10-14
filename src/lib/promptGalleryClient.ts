import { API_BASE } from './apiBase';
import { GALLERY_FETCH_TIMEOUT_MS } from './constants';

export const PROMPT_CATEGORIES = ['场景', '角色', '风格', '构图', '其他'] as const;
export type PromptCategory = typeof PROMPT_CATEGORIES[number];

export interface PromptGalleryRow {
  id: string;
  created_at: string;
  title: string;
  prompt: string;
  category: PromptCategory;
  reference_image_urls: string[];
}

export interface PromptGalleryPage { rows: PromptGalleryRow[]; hasMore: boolean; }

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & { ok?: boolean; message?: string };
  if (!response.ok || data.ok === false) throw new Error(data.message || fallback);
  return data;
}

export async function listPromptGallery({ query = '', category = '', limit = 24, offset = 0 } = {}): Promise<PromptGalleryPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GALLERY_FETCH_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ q: query, category, limit: String(limit), offset: String(offset) });
    const response = await fetch(`${API_BASE}/prompts?${params}`, { signal: controller.signal });
    const data = await readJson<{ ok?: boolean; rows?: PromptGalleryRow[]; hasMore?: boolean; message?: string }>(response, '加载提示词画廊失败');
    if (!Array.isArray(data.rows)) throw new Error('提示词画廊返回数据无效');
    return { rows: data.rows, hasMore: Boolean(data.hasMore) };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('网络超时 // 请检查网络后重试');
    throw error instanceof Error ? error : new Error('无法连接到服务器 // 请检查网络后重试');
  } finally { clearTimeout(timer); }
}

export async function savePromptGallery(input: { title: string; prompt: string; category: PromptCategory; deleteToken: string; referenceImages?: File[] }): Promise<PromptGalleryRow> {
  const body = new FormData();
  body.set('title', input.title);
  body.set('prompt', input.prompt);
  body.set('category', input.category);
  body.set('deleteToken', input.deleteToken);
  for (const file of input.referenceImages || []) body.append('referenceImages', file);
  const response = await fetch(`${API_BASE}/prompts`, { method: 'POST', body });
  const data = await readJson<{ ok?: boolean; row?: PromptGalleryRow; message?: string }>(response, '保存提示词失败');
  if (!data.row) throw new Error('提示词画廊返回数据无效');
  return data.row;
}

export async function deletePromptGallery(id: string, deleteToken: string): Promise<void> {
  const response = await fetch(`${API_BASE}/prompts/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-Delete-Token': deleteToken },
    body: JSON.stringify({ deleteToken }),
  });
  await readJson(response, '删除提示词失败');
}

export function promptImageProxyUrl(imageUrl: string): string {
  return `${API_BASE}/proxy-image?url=${encodeURIComponent(imageUrl)}`;
}

export function generatePromptDeleteToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function readPromptTokens(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem('yinghua_prompt_gallery_tokens') || '{}'); } catch { return {}; }
}

export function rememberPromptToken(id: string, token: string): void {
  try {
    const tokens = readPromptTokens();
    tokens[id] = token;
    localStorage.setItem('yinghua_prompt_gallery_tokens', JSON.stringify(tokens));
  } catch { /* unavailable storage only affects deletion */ }
}

export function forgetPromptToken(id: string): void {
  try {
    const tokens = readPromptTokens();
    delete tokens[id];
    localStorage.setItem('yinghua_prompt_gallery_tokens', JSON.stringify(tokens));
  } catch { /* ignore */ }
}
