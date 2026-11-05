import sharp from 'sharp';
import { assertSafeUrl, fetchBufferLimited } from '../http.js';
import { MAX_FETCH_BYTES, MAX_INPUT_PIXELS } from './constants.js';
import { assertGalleryGifBounds } from './galleryGif.js';

export class GalleryThumbnailError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export function galleryThumbnailPath(path) {
  return /-full\.(?:webp|gif)$/.test(path) ? path.replace(/-full\.(?:webp|gif)$/, '-thumb.webp') : null;
}

function storedThumbnailUrl(source) {
  const url = new URL(source);
  const path = galleryThumbnailPath(url.pathname);
  if (!path) return null;
  url.pathname = path;
  return url.href;
}

export async function encodeGalleryThumbnail(buffer) {
  try {
    const image = sharp(buffer, { page: 0, pages: 1, limitInputPixels: MAX_INPUT_PIXELS });
    const meta = await image.metadata();
    if (!['png', 'jpeg', 'webp', 'gif'].includes(meta.format)) throw new Error('format');
    if (meta.format === 'gif') assertGalleryGifBounds(meta, buffer);
    return await image.rotate().resize(640, 640, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 76 }).toBuffer();
  } catch { throw new GalleryThumbnailError('作品图片无法生成缩略图', 422); }
}

async function loadGalleryImage(source) {
  const url = await assertSafeUrl(source);
  const response = await fetchBufferLimited(url.href, {}, 20_000, MAX_FETCH_BYTES);
  if (!response.ok) throw new GalleryThumbnailError('缩略图暂时无法读取');
  return response.buffer;
}

const validId = (id) => typeof id === 'number' ? Number.isSafeInteger(id) && id > 0
  : typeof id === 'string' && /^(?:\d{1,20}|[A-Za-z0-9-]{8,64})$/.test(id);

/** New uploads use stored thumbnails; legacy images are resized lazily, without a DB migration. */
export function createGalleryThumbnailService({ lookupImage, loadImage = loadGalleryImage, now = Date.now,
  maxBytes = 16 * 1024 * 1024, maxEntries = 256, ttlMs = 60 * 60_000 } = {}) {
  const cache = new Map(), metadata = new Map(), pending = new Map();
  const lanes = [Promise.resolve(), Promise.resolve()];
  let bytes = 0, nextLane = 0;

  function remove(key) { const entry = cache.get(key); if (entry) { bytes -= entry.buffer.length; cache.delete(key); } }
  function put(key, buffer) {
    remove(key);
    if (buffer.length > maxBytes || maxEntries < 1) return;
    for (const [id, entry] of cache) if (entry.expiresAt <= now()) remove(id);
    while (cache.size && (bytes + buffer.length > maxBytes || cache.size >= maxEntries)) remove(cache.keys().next().value);
    cache.set(key, { buffer, expiresAt: now() + ttlMs }); bytes += buffer.length;
  }
  function remember(rows) {
    for (const row of rows) {
      if (!validId(row.id) || typeof row.image_url !== 'string' || row.image_url.length > 4096) continue;
      const key = String(row.id), prev = metadata.get(key);
      if (prev && prev.image_url !== row.image_url) { remove(key); pending.delete(key); }
      metadata.delete(key); metadata.set(key, { image_url: row.image_url, expiresAt: now() + 10 * 60_000 });
    }
    while (metadata.size > 512) metadata.delete(metadata.keys().next().value);
  }

  return {
    remember,
    prime(row, buffer) { remember([row]); put(String(row.id), buffer); },
    invalidate(id) { const key = String(id); remove(key); metadata.delete(key); pending.delete(key); },
    async get(id) {
      if (!validId(id)) throw new GalleryThumbnailError('无效的画廊记录', 400);
      const key = String(id), hit = cache.get(key);
      if (hit && hit.expiresAt > now()) { cache.delete(key); cache.set(key, hit); return hit.buffer; }
      remove(key);
      if (pending.has(key)) return pending.get(key);
      if (pending.size >= 64) throw new GalleryThumbnailError('缩略图任务较多，请稍后再试', 429);
      const lane = nextLane++ % lanes.length;
      const task = lanes[lane].then(async () => {
        const known = metadata.get(key);
        const row = known && known.expiresAt > now() ? known : await lookupImage(id);
        if (!row?.image_url) throw new GalleryThumbnailError('作品不存在或已删除', 404);
        const stored = storedThumbnailUrl(row.image_url);
        if (stored) {
          try {
            const buffer = await loadImage(stored);
            const meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
            if (meta.format === 'webp' && (meta.pages || 1) === 1 && meta.width <= 640 && meta.height <= 640) return buffer;
          } catch { /* A missing derived asset must not hide the original work. */ }
        }
        return encodeGalleryThumbnail(await loadImage(row.image_url));
      });
      lanes[lane] = task.catch(() => {});
      const tracked = task.then((buffer) => { if (pending.get(key) === tracked) put(key, buffer); return buffer; })
        .finally(() => { if (pending.get(key) === tracked) pending.delete(key); });
      pending.set(key, tracked);
      return tracked;
    },
  };
}
