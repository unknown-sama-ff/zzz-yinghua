// ─── Main-thread pool: one Worker + in-flight cache + Blob→dataURL cache ────
//
// Exposes the same async signature as the original stitchImages/embedThumbnail:
//   Promise<string>  (data-URL, ready for <img src> or parseDataUrl())
//
// Falls back to synchronous main-thread canvas if the environment doesn't
// support OffscreenCanvas, or if the Worker crashes mid-flight.

// ── Feature gate ──────────────────────────────────────────────────────────────

function hasOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

// ── Cache ─────────────────────────────────────────────────────────────────────

// stitchImages: key = JSON of the stable input signature
type StitchKey = string;
// embedThumbnail: key = JSON of [baseDataUrl, thumbDataUrl, size]
type EmbedKey = string;

interface CacheEntry {
  dataUrl: string;
  ts: number;
}
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes — matches the per-slot styleRef cache TTL
const stitchCache = new Map<StitchKey, CacheEntry>();
const embedCache = new Map<EmbedKey, CacheEntry>();

// Purge expired entries every 60 s; Map iteration is O(n) but n is tiny.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of stitchCache) if (now - v.ts > CACHE_TTL_MS) stitchCache.delete(k);
  for (const [k, v] of embedCache)   if (now - v.ts > CACHE_TTL_MS) embedCache.delete(k);
}, 60_000);

// ── Worker reference ──────────────────────────────────────────────────────────

let worker: Worker | null = null;
const WORKER_TIMEOUT = 360_000; // 6 min — matches generate() upstream timeout

function getWorker(): Worker | null {
  if (!worker || (worker as any)._disposed) {
    if (!hasOffscreenCanvas()) return null;
    try {
      worker = new Worker(new URL('../workers/imageWorker.ts', import.meta.url), {
        type: 'module',
      });
      (worker as any)._disposed = false;
      wireWorker(worker);
    } catch {
      return null;
    }
  }
  return worker;
}

// ── Request/response plumbing ─────────────────────────────────────────────────

type StitchPayload = { type: 'stitch'; op: 'stitch'; dataUrls: string[] };
type EmbedPayload = { type: 'embedThumbnail'; op: 'embedThumbnail'; base: string; thumb: string; size?: number };
type Msg = StitchPayload | EmbedPayload;

const drainQueue: {
  resolve: (blob: Blob) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}[] = [];

function wireWorker(w: Worker) {
  w.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { type: string; blob?: Blob; message?: string };
    if (!data || typeof data !== 'object') return;

    if (data.type === 'result' && data.blob instanceof Blob) {
      const entry = drainQueue.shift();
      if (!entry) return;
      clearTimeout(entry.timer);
      entry.resolve(data.blob);
    } else if (data.type === 'error') {
      const entry = drainQueue.shift();
      if (!entry) return;
      clearTimeout(entry.timer);
      entry.reject(new Error(data.message ?? 'worker error'));
    }
  });

  w.addEventListener('error', () => {
    // Worker crashed — drain remaining in-flight requests with an error so
    // callers fall through to the main-thread fallback instead of hanging.
    const err = new Error('worker crashed');
    for (const entry of drainQueue) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    drainQueue.length = 0;
    worker = null;
  });
}

function sendToWorker(w: Worker, payload: Msg): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('worker request timed out')),
      WORKER_TIMEOUT,
    );
    drainQueue.push({
      resolve: (blob) => { void blobToDataUrl(blob).then(resolve, reject); },
      reject,
      timer,
    });
    w.postMessage(payload);
  });
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

async function cachedOrRun<K extends StitchKey | EmbedKey>(
  cache: Map<K, CacheEntry>,
  key: K,
  run: () => Promise<string>, // run() does its own Blob → dataUrl conversion
): Promise<string> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < CACHE_TTL_MS) return hit.dataUrl;

  // Dedupe in-flight requests with the same key.
  const inflight = (cache as any)._inflight as Map<K, Promise<string>> | undefined;
  if (inflight?.has(key)) return inflight.get(key)!;

  const task = run().then((dataUrl) => {
    // Revoke any stale object URL we may have handed out earlier for the same key.
    const prev = cache.get(key);
    if (prev?.dataUrl.startsWith('blob:')) URL.revokeObjectURL(prev.dataUrl);

    cache.set(key, { dataUrl, ts: Date.now() });
    (cache as any)._inflight?.delete(key);
    return dataUrl;
  });

  if (!inflight) (cache as any)._inflight = new Map<K, Promise<string>>();
  (cache as any)._inflight.set(key, task);
  return task;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('FileReader failed on worker Blob'));
    reader.readAsDataURL(blob);
  });
}

// ── Main-thread fallback (canvas + toDataURL) ──────────────────────────────────

async function fallbackStitch(dataUrls: string[]): Promise<string> {
  const urls = dataUrls.filter((u) => u && u.trim().length > 0);
  if (urls.length === 0) throw new Error('stitchImages: no images provided');
  if (urls.length === 1) {
    const img = await loadImg(urls[0]);
    const oc = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
    const ctx = oc.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const blob = await oc.convertToBlob({ type: 'image/png' });
    return blobToDataUrl(blob);
  }

  const imgs = await Promise.all(urls.map(loadImg));
  const maxH = Math.min(
    Math.max(...imgs.map((i) => i.naturalHeight)),
    MAX_STITCH_HEIGHT,
  );
  const scaledWidths = imgs.map((i) => Math.round((i.naturalWidth / i.naturalHeight) * maxH));
  const totalW = scaledWidths.reduce((a, b) => a + b, 0);

  const c = document.createElement('canvas');
  c.width = totalW;
  c.height = maxH;
  const ctx = c.getContext('2d')!;
  let x = 0;
  for (let i = 0; i < imgs.length; i++) {
    ctx.drawImage(imgs[i], x, 0, scaledWidths[i], maxH);
    x += scaledWidths[i];
  }
  return new Promise((resolve, reject) => {
    c.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('canvas.toBlob returned null'));
        blobToDataUrl(blob).then(resolve, reject);
      },
      'image/png',
    );
  });
}

async function fallbackEmbed(base: string, thumb: string, size = 0.2): Promise<string> {
  const [baseImg, thumbImg] = await Promise.all([loadImg(base), loadImg(thumb)]);
  const c = document.createElement('canvas');
  c.width = baseImg.naturalWidth;
  c.height = baseImg.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(baseImg, 0, 0);

  const thumbH = Math.round(baseImg.naturalHeight * size);
  const thumbW = Math.round((thumbImg.naturalWidth / thumbImg.naturalHeight) * thumbH);
  const margin = Math.round(baseImg.naturalHeight * 0.02);
  const tx = c.width - thumbW - margin;
  const ty = c.height - thumbH - margin;

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(tx - 4, ty - 4, thumbW + 8, thumbH + 8);
  ctx.drawImage(thumbImg, tx, ty, thumbW, thumbH);

  return new Promise((resolve, reject) => {
    c.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('canvas.toBlob returned null'));
        blobToDataUrl(blob).then(resolve, reject);
      },
      'image/png',
    );
  });
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image load failed: ${url.slice(0, 80)}`));
    img.src = url;
  });
}

// ── Public API (mirrors original stitchImages / embedThumbnail signatures) ─────

export async function stitchImages(dataUrls: (string | null | undefined)[]): Promise<string> {
  const key = JSON.stringify(dataUrls) as StitchKey;
  return cachedOrRun(stitchCache, key, async () => {
    const w = getWorker();
    if (w) {
      try {
        return await sendToWorker(w, { type: 'stitch', op: 'stitch', dataUrls: dataUrls as string[] });
      } catch {
        // Worker died mid-flight: fall through to main thread.
      }
    }
    return fallbackStitch(dataUrls as string[]);
  });
}

export async function stitchRefImages(
  refs: { base64: string; mime?: string }[],
): Promise<string> {
  const dataUrls = refs.map((r) => {
    const mime = r.mime || 'image/png';
    return `data:${mime};base64,${r.base64}`;
  });
  // stitchImages already handles multi-image horizontal stitching with
  // max-height capping — same behaviour the old sharp server-side code had.
  return stitchImages(dataUrls);
}

export async function embedThumbnail(
  base: string,
  thumb: string,
  size = 0.2,
): Promise<string> {
  const key = JSON.stringify([base, thumb, size]) as EmbedKey;
  return cachedOrRun(embedCache, key, async () => {
    const w = getWorker();
    if (w) {
      try {
        return await sendToWorker(w, {
          type: 'embedThumbnail',
          op: 'embedThumbnail',
          base,
          thumb,
          size,
        });
      } catch {
        // fall through
      }
    }
    return fallbackEmbed(base, thumb, size);
  });
}
