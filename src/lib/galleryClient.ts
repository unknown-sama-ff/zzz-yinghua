import { API_BASE } from './apiBase';
import { GALLERY_FETCH_TIMEOUT_MS } from './constants';

export interface GallerySaveInput {
  imageBase64: string;
  mime: string;
  style: string;
  characterName: string;
  prompt: string;
  provider: string;
  deleteToken: string;
}

export interface GallerySaveResult {
  id: number | string;
  image_url: string;
  style: string;
  character_name: string;
  prompt: string;
  provider: string;
  created_at: string;
}

/** A saved gallery piece as returned by the read API. */
export interface GalleryRow {
  // The table's id may be UUID or BIGINT depending on how it was created
  // (see Supabase-Schema.md), so both shapes have to be accepted.
  id: number | string;
  created_at: string;
  image_url: string;
  style: string;
  character_name: string;
  prompt: string;
  provider: string;
}

export interface GalleryPage {
  rows: GalleryRow[];
  hasMore: boolean;
}

/** Rows fetched per gallery page. */
export const GALLERY_PAGE_SIZE = 60;

/**
 * Read a page of the gallery through our own backend.
 *
 * This deliberately does not use @supabase/supabase-js from the browser: many
 * visitors can't reach *.supabase.co reliably, and a stalled direct connection
 * never rejects, which used to leave the panel loading indefinitely. The server
 * reads the table with the service-role key instead, so the browser only ever
 * talks to this origin — and the abort timeout guarantees a decidable outcome.
 */
export async function listGalleryPage(
  { limit = GALLERY_PAGE_SIZE, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<GalleryPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GALLERY_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/gallery?limit=${limit}&offset=${offset}`, {
      signal: controller.signal,
    });
  } catch (err) {
    // An abort here means the deadline fired, not that the user navigated away.
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('网络超时 // 请检查网络后重试');
    }
    throw new Error('无法连接到服务器 // 请检查网络后重试');
  } finally {
    clearTimeout(timer);
  }

  const data = await response.json().catch(() => ({})) as {
    ok?: boolean;
    rows?: GalleryRow[];
    hasMore?: boolean;
    message?: string;
  };
  if (!response.ok || !data.ok || !Array.isArray(data.rows)) {
    throw new Error(data.message || '加载画廊失败');
  }
  return { rows: data.rows, hasMore: Boolean(data.hasMore) };
}

/** Route an image through our backend — used only when the direct load fails. */
export function galleryImageProxyUrl(imageUrl: string): string {
  return `${API_BASE}/proxy-image?url=${encodeURIComponent(imageUrl)}`;
}

/** Persist a generated piece to the gallery via the server (service-role key). */
export async function saveToGallery(input: GallerySaveInput): Promise<GallerySaveResult> {
  const response = await fetch(`${API_BASE}/gallery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({})) as { ok?: boolean; row?: GallerySaveResult; message?: string };
  if (!response.ok || !data.ok || !data.row) {
    throw new Error(data.message || '保存到画廊失败');
  }
  return data.row;
}

/** Delete a gallery piece the current browser saved (delete-token owned). */
export async function deleteFromGallery(id: number | string, deleteToken: string): Promise<void> {
  const response = await fetch(`${API_BASE}/gallery/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      // Some reverse proxies strip DELETE request bodies — the server reads the
      // token from the header as a fallback.
      'X-Delete-Token': deleteToken,
    },
    body: JSON.stringify({ deleteToken }),
  });
  const data = await response.json().catch(() => ({})) as { ok?: boolean; message?: string };
  if (!response.ok || !data.ok) {
    throw new Error(data.message || '删除失败');
  }
}
