// ─── Image-processing Worker (runs OffscreenCanvas off the main thread) ───────
//
// Handles two operations:
//   - stitchImages: tile N images side-by-side into one wide PNG
//   - embedThumbnails: stamp N small thumbnails in the bottom-left / bottom-right
//     corners of a base image
//
// Both return a PNG Blob via postMessage.
//
// Supported image sources inside this Worker:
//   - data: URLs (user uploads + Worker-generated results)
//   - same-origin absolute paths (style reference sheets, /影画样式X/...)
//   - blob: URLs created on the main thread and passed through
//
// Cross-origin URLs are blocked by Worker fetch (no credentials sent) —
// matches the original main-thread behaviour.

const MAX_STITCH_HEIGHT = 1536;

type ThumbPosition = 'bottom-left' | 'bottom-right';

interface ThumbSpec {
  url: string;
  size?: number;
  position: ThumbPosition;
}

function loadImage(src: string): Promise<ImageBitmap> {
  const url = src.trim();
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    return fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`fetch failed ${r.status}: ${url}`);
        return r.blob();
      })
      .then((blob) => createImageBitmap(blob));
  }
  // Absolute same-origin path (e.g. /影画样式1/xxx.PNG).
  return fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`fetch failed ${r.status}: ${url}`);
      return r.blob();
    })
    .then((blob) => createImageBitmap(blob));
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  // Cast once after the type guard — TypeScript can't narrow through try/catch.
  const isStitch = msg && typeof msg === 'object' && msg.type === 'stitch';
  const isEmbed  = msg && typeof msg === 'object' && msg.type === 'embedThumbnail';

  try {
    if (isStitch) {
      const req = msg as { dataUrls: string[] };
      const urls = req.dataUrls.filter((u) => u && u.trim().length > 0);
      if (urls.length === 0) {
        postMessage({ type: 'error', message: 'stitchImages: no images provided' });
        return;
      }
      if (urls.length === 1) {
        const bmp = await loadImage(urls[0]);
        const oc = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = oc.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        const blob = await oc.convertToBlob({ type: 'image/png' });
        postMessage({ type: 'result', blob });
        return;
      }

      const bitmaps = await Promise.all(urls.map(loadImage));
      const maxH = Math.min(
        Math.max(...bitmaps.map((b) => b.height)),
        MAX_STITCH_HEIGHT,
      );
      const scaledWidths = bitmaps.map((b) => Math.round((b.width / b.height) * maxH));
      const totalW = scaledWidths.reduce((a, b) => a + b, 0);

      const oc = new OffscreenCanvas(totalW, maxH);
      const ctx = oc.getContext('2d')!;
      let x = 0;
      for (let i = 0; i < bitmaps.length; i++) {
        ctx.drawImage(bitmaps[i], x, 0, scaledWidths[i], maxH);
        x += scaledWidths[i];
      }
      const blob = await oc.convertToBlob({ type: 'image/png' });
      postMessage({ type: 'result', blob });

    } else if (isEmbed) {
      const req = msg as { base: string; thumbs: ThumbSpec[] };
      const [baseBmp, ...thumbBmps] = await Promise.all([
        loadImage(req.base),
        ...req.thumbs.map((t) => loadImage(t.url)),
      ]);

      const oc = new OffscreenCanvas(baseBmp.width, baseBmp.height);
      const ctx = oc.getContext('2d')!;
      ctx.drawImage(baseBmp, 0, 0);

      const margin = Math.round(baseBmp.height * 0.02);

      // Group thumbs by position; for each side, arrange horizontally.
      const leftThumbs: { spec: ThumbSpec; bmp: ImageBitmap; w: number; h: number }[] = [];
      const rightThumbs: { spec: ThumbSpec; bmp: ImageBitmap; w: number; h: number }[] = [];

      for (let i = 0; i < req.thumbs.length; i++) {
        const spec = req.thumbs[i];
        const bmp = thumbBmps[i];
        const size = spec.size ?? 0.2;
        const thumbH = Math.round(baseBmp.height * size);
        const thumbW = Math.round((bmp.width / bmp.height) * thumbH);
        const entry = { spec, bmp, w: thumbW, h: thumbH };
        if (spec.position === 'bottom-left') {
          leftThumbs.push(entry);
        } else {
          rightThumbs.push(entry);
        }
      }

      // Draw left thumbs (left-to-right from left margin).
      let leftX = margin;

      for (const t of leftThumbs) {
        const tx = leftX;
        const ty = baseBmp.height - t.h - margin;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(tx - 4, ty - 4, t.w + 8, t.h + 8);
        ctx.drawImage(t.bmp, tx, ty, t.w, t.h);
        leftX += t.w + margin;
      }

      // Draw right thumbs (left-to-right from the right edge).
      const totalRightW = rightThumbs.reduce((s, t) => s + t.w, 0)
        + (rightThumbs.length - 1) * margin;
      let rightX = baseBmp.width - totalRightW;

      for (const t of rightThumbs) {
        const tx = rightX;
        const ty = baseBmp.height - t.h - margin;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(tx - 4, ty - 4, t.w + 8, t.h + 8);
        ctx.drawImage(t.bmp, tx, ty, t.w, t.h);
        rightX += t.w + margin;
      }

      const blob = await oc.convertToBlob({ type: 'image/png' });
      postMessage({ type: 'result', blob });
    }
  } catch (err) {
    postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'unknown worker error',
    });
  }
};
