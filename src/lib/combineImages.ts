/**
 * Combine two data-URL images side by side into a single data URL.
 * Target: 2048x1024 (2:1 landscape) — each side is 1024x1024, centred in its half.
 */
export function combineImagesSideBySide(
  leftDataUrl: string,
  rightDataUrl: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject(new Error('Canvas context unavailable'));

    let loaded = 0;
    const imgs: [HTMLImageElement, HTMLImageElement] = [
      new Image(),
      new Image(),
    ];

    const onDone = () => {
      loaded++;
      if (loaded < 2) return;
      // Left half: fit image into 1024x1024 centred
      drawCentred(ctx, imgs[0], 0, 1024, 1024);
      // Right half: fit image into 1024x1024 centred
      drawCentred(ctx, imgs[1], 1024, 1024, 1024);
      // Divider line
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(1024, 0);
      ctx.lineTo(1024, 1024);
      ctx.stroke();
      resolve(canvas.toDataURL('image/png'));
    };

    imgs[0].onload = onDone;
    imgs[0].onerror = () => reject(new Error('Failed to load left image'));
    imgs[1].onload = onDone;
    imgs[1].onerror = () => reject(new Error('Failed to load right image'));

    imgs[0].src = leftDataUrl;
    imgs[1].src = rightDataUrl;
  });
}

function drawCentred(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  w: number,
  h: number,
) {
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = x + (w - dw) / 2;
  const dy = (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}
