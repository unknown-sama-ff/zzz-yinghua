/**
 * Stitch an array of image data URLs into a single horizontally-tiled PNG.
 * Null/undefined entries are skipped. All images are scaled to a shared height,
 * then placed side-by-side at equal widths.
 *
 * The shared height is capped at MAX_STITCH_HEIGHT so a few large uploads
 * don't produce a multi-thousand-pixel canvas whose base64 PNG blows past the
 * backend's JSON body limit (was causing 413s on three-view generation).
 */
const MAX_STITCH_HEIGHT = 1536;

export async function stitchImages(dataUrls: (string | null | undefined)[]): Promise<string> {
  const urls = dataUrls.filter((u): u is string => Boolean(u));
  if (urls.length === 0) throw new Error('stitchImages: no images provided');
  if (urls.length === 1) return urls[0];

  const imgs = await Promise.all(
    urls.map(
      (url) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('Failed to load image for stitching'));
          img.src = url;
        }),
    ),
  );

  const maxH = Math.min(Math.max(...imgs.map((img) => img.naturalHeight)), MAX_STITCH_HEIGHT);
  // Scale each image proportionally to match maxH, then tile.
  const scaledWidths = imgs.map((img) => Math.round((img.naturalWidth / img.naturalHeight) * maxH));
  const totalW = scaledWidths.reduce((a, b) => a + b, 0);

  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = maxH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('stitchImages: canvas 2d context unavailable');

  let x = 0;
  for (let i = 0; i < imgs.length; i++) {
    ctx.drawImage(imgs[i], x, 0, scaledWidths[i], maxH);
    x += scaledWidths[i];
  }

  return canvas.toDataURL('image/png');
}
