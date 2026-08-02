import { API_BASE } from './apiBase';

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
