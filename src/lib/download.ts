export function isGifImage(src: string): boolean {
  return /^data:image\/gif[;,]/i.test(src) || /\.gif(?:[?#]|$)/i.test(src);
}

/** Trigger a browser download for an image URL or data URI. */
export async function downloadImage(src: string, filename: string): Promise<void> {
  try {
    // data: URIs can be linked directly; remote URLs are fetched to a blob so
    // the download attribute is honored cross-origin where CORS allows.
    let href = src;
    let gif = isGifImage(src);
    if (!src.startsWith('data:')) {
      const res = await fetch(src);
      if (!res.ok) throw new Error('图片下载失败');
      const blob = await res.blob();
      gif = gif || blob.type === 'image/gif' || /^GIF8[79]a/.test(await blob.slice(0, 6).text());
      href = URL.createObjectURL(blob);
    }
    const a = document.createElement('a');
    a.href = href;
    a.download = gif ? filename.replace(/\.[^.\/]+$/, '') + '.gif' : filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (href !== src) URL.revokeObjectURL(href);
  } catch {
    // Fallback: open in a new tab so the user can save manually.
    window.open(src, '_blank');
  }
}


/** Trigger a browser download for an already-rendered binary asset. */
export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Keep the URL alive long enough for the browser to start reading it.
  window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
