import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { loadFrontend } from './loadFrontend.js';
const { saveGalleryImage } = await loadFrontend("export { saveGalleryImage } from './src/lib/gallerySave';");

test('gallery uploads preserve GIF and animated WebP bytes for server compression, including remote images', async () => {
  const original = { fetch: globalThis.fetch, FileReader: globalThis.FileReader,
    window: globalThis.window, localStorage: globalThis.localStorage, document: globalThis.document };
  const gif = 'R0lGODlhAgABAIAAAExpcf8AACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFBAAAACwAAAAAAgABAAACAkwKACH5BAUJAAAALAAAAAACAAEAgExpcQAA/wICTAoAOw==';
  const webp = await sharp(Buffer.from(gif, 'base64'), { animated: true }).webp({ lossless: true }).toBuffer();
  let uploads = 0;
  globalThis.FileReader = class {
    readAsDataURL(blob) {
      blob.arrayBuffer().then((bytes) => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`; this.onload(); });
    }
  };
  globalThis.document = { createElement: () => assert.fail('animations must not enter a flattening canvas path') };
  globalThis.window = { dispatchEvent() {} };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.fetch = async (url, init) => {
    if (url === 'https://cdn.invalid/animation') return new Response(Buffer.from(gif, 'base64'), { headers: { 'Content-Type': 'image/gif' } });
    if (url === 'https://cdn.invalid/optimized-animation') return new Response(webp, { headers: { 'Content-Type': 'image/webp' } });
    assert.equal(url, '/api/gallery');
    const body = JSON.parse(init.body); uploads++;
    assert.equal(body.mime, uploads <= 2 ? 'image/gif' : 'image/webp');
    assert.equal(body.imageBase64, uploads <= 2 ? gif : webp.toString('base64'));
    return new Response(JSON.stringify({ ok: true, row: { id: uploads, image_url: 'https://cdn.invalid/full.gif' } }));
  };
  try {
    const metadata = { style: '自由创作', characterName: 'cat', prompt: 'wave, seamless loop', provider: 'gpt-image' };
    await saveGalleryImage('data:image/gif;base64,' + gif, metadata);
    await saveGalleryImage('https://cdn.invalid/animation', metadata);
    await saveGalleryImage('data:image/webp;base64,' + webp.toString('base64'), metadata);
    await saveGalleryImage('https://cdn.invalid/optimized-animation', metadata);
    assert.equal(uploads, 4);
  } finally {
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});
