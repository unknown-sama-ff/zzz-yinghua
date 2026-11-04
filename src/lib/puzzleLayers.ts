import { API_BASE } from './apiBase';

export interface PuzzleLayers { key: string; width: number; height: number; foreground: string; background: string }
const pending = new Map<string, Promise<PuzzleLayers>>();

function preload(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => finish(false), 20000);
    const finish = (ok: boolean) => {
      window.clearTimeout(timer); image.onload = image.onerror = null;
      if (ok) resolve(); else { image.src = ''; reject(new Error('分层图片暂时无法读取，请重试')); }
    };
    image.onload = () => finish(true); image.onerror = () => finish(false); image.src = src;
  });
}

export function forgetPuzzleLayers(galleryId: string | number): void { pending.delete(String(galleryId)); }

/** Cache promises as well as results, so a prefetch and the reveal share one server job. */
export function getPuzzleLayers(galleryId: string | number): Promise<PuzzleLayers> {
  const id = String(galleryId);
  const existing = pending.get(id);
  if (existing) return existing;
  const promise = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 180000);
    let response: Response;
    let data;
    try {
      response = await fetch(`${API_BASE}/puzzle-layers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ galleryId }), signal: controller.signal });
      data = await response.json().catch(() => ({}));
    } catch { throw new Error('分层服务暂时无法连接，可继续查看原图'); }
    finally { window.clearTimeout(timer); }
    if (!response.ok || !data.ok || !/^[a-f0-9]{64}$/.test(data.key ?? '') || !Number.isFinite(data.width) || !Number.isFinite(data.height) || data.width < 1 || data.height < 1 || data.width > 1024 || data.height > 1024) throw new Error(data.message || '分层结果暂时不可用，可继续查看原图');
    const result: PuzzleLayers = { key: data.key, width: data.width, height: data.height, foreground: `${API_BASE}/puzzle-layers/${data.key}/foreground.webp`, background: `${API_BASE}/puzzle-layers/${data.key}/background.webp` };
    await Promise.all([preload(result.foreground), preload(result.background)]);
    return result;
  })();
  pending.set(id, promise);
  while (pending.size > 12) pending.delete(pending.keys().next().value!);
  void promise.catch(() => { if (pending.get(id) === promise) pending.delete(id); });
  return promise;
}
