/**
 * Extract image URLs from common upstream API response shapes.
 * Shared between the main-thread providers and the Vercel worker script.
 */

function imageDataUrl(base64, format) {
  const header = Buffer.from(base64.slice(0, 24), 'base64');
  const gif = /^GIF8[79]a/.test(header.toString('ascii', 0, 6));
  const mime = gif ? 'image/gif' : header[0] === 0x89 && header.toString('ascii', 1, 4) === 'PNG' ? 'image/png'
    : header[0] === 0xff && header[1] === 0xd8 ? 'image/jpeg'
      : header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp'
        : `image/${format === 'jpeg' || format === 'webp' || format === 'gif' ? format : 'png'}`;
  return `data:${mime};base64,${base64}`;
}

export function pluckImages(json, format = 'png') {
  const out = [];
  if (Array.isArray(json?.data)) {
    for (const d of json.data) {
      if (d.url) out.push(d.url);
      else if (d.b64_json) out.push(imageDataUrl(d.b64_json, format));
    }
  }
  if (Array.isArray(json?.images)) {
    for (const im of json.images) {
      if (typeof im === 'string') out.push(im);
      else if (im?.url) out.push(im.url);
      else if (im?.b64_json) out.push(imageDataUrl(im.b64_json, format));
    }
  }
  if (typeof json?.output === 'string') out.push(json.output);
  if (Array.isArray(json?.output)) out.push(...json.output.filter((v) => typeof v === 'string'));
  return out;
}
