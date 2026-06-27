/** Trigger a browser download for an image URL or data URI. */
export async function downloadImage(src: string, filename: string): Promise<void> {
  try {
    // data: URIs can be linked directly; remote URLs are fetched to a blob so
    // the download attribute is honored cross-origin where CORS allows.
    let href = src;
    if (!src.startsWith('data:')) {
      const res = await fetch(src);
      const blob = await res.blob();
      href = URL.createObjectURL(blob);
    }
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (href !== src) URL.revokeObjectURL(href);
  } catch {
    // Fallback: open in a new tab so the user can save manually.
    window.open(src, '_blank');
  }
}
