// ─── Image-processing Worker (runs OffscreenCanvas off the main thread) ───────
//
// Handles two operations:
//   - stitchImages: tile N images side-by-side into one wide PNG
//   - embedThumbnail: stamp a small thumbnail in the bottom-right corner
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
      const req = msg as { base: string; thumb: string; size?: number };
      const [baseBmp, thumbBmp] = await Promise.all([
        loadImage(req.base),
        loadImage(req.thumb),
      ]);

      const oc = new OffscreenCanvas(baseBmp.width, baseBmp.height);
      const ctx = oc.getContext('2d')!;
      ctx.drawImage(baseBmp, 0, 0);

      const size = req.size ?? 0.2;
      const thumbH = Math.round(baseBmp.height * size);
      const thumbW = Math.round((thumbBmp.width / thumbBmp.height) * thumbH);
      const margin = Math.round(baseBmp.height * 0.02);
      const tx = oc.width - thumbW - margin;
      const ty = oc.height - thumbH - margin;

      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(tx - 4, ty - 4, thumbW + 8, thumbH + 8);
      ctx.drawImage(thumbBmp, tx, ty, thumbW, thumbH);

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
