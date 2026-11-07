/** Inspect animation signatures before a browser canvas can flatten the frames. */
export function detectAnimationMime(header: Uint8Array): 'image/gif' | 'image/webp' | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...header.subarray(start, end));
  if (/^GIF8[79]a$/.test(ascii(0, 6))) return 'image/gif';
  if (header.length >= 21 && ascii(0, 4) === 'RIFF' && ascii(8, 16) === 'WEBPVP8X' && (header[20] & 2)) return 'image/webp';
  return null;
}

export function isAnimatedWebpUrl(src: string): boolean {
  return /-animated-full\.webp(?:[?#]|$)/i.test(src);
}
