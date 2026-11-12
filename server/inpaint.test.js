import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';

// Importing the Express application must not start its normal local listener.
process.env.VERCEL = '1';
const { default: app } = await import('./index.js');

async function pngBlob(channels = 3) {
  const buffer = await sharp({
    create: { width: 4, height: 4, channels, background: channels === 4 ? { r: 0, g: 0, b: 0, alpha: 0 } : '#ffffff' },
  }).png().toBuffer();
  return new Blob([buffer], { type: 'image/png' });
}

function editFields(form, editMode) {
  form.append('prompt', 'make this small adjustment');
  form.append('provider', 'gpt-image');
  form.append('apiKey', 'test-key');
  form.append('baseUrl', 'https://api.openai.com/v1');
  form.append('model', 'gpt-image-2.5-sunburst');
  form.append('editMode', editMode);
}

async function startApp(t) {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test('precise inpaint rejects a request whose mask was lost before it reaches the provider', async (t) => {
  const base = await startApp(t);
  const form = new FormData();
  form.append('image', await pngBlob(), 'image.png');
  editFields(form, 'precise');

  const response = await fetch(`${base}/api/inpaint`, { method: 'POST', body: form });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(body, {
    ok: false,
    code: 'INVALID_INPUT',
    message: '精准重绘缺少蒙版文件',
  });
});

test('precise inpaint forwards the uploaded mask to the gpt-image edit request', async (t) => {
  const base = await startApp(t);
  const originalFetch = globalThis.fetch;
  let upstreamMask = null;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(base)) return originalFetch(url, init);
    const mask = init.body.get('mask');
    assert.ok(mask);
    upstreamMask = await sharp(Buffer.from(await mask.arrayBuffer())).metadata();
    return new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const form = new FormData();
  form.append('image', await pngBlob(), 'image.png');
  form.append('mask', await pngBlob(4), 'mask.png');
  editFields(form, 'precise');

  const response = await fetch(`${base}/api/inpaint`, { method: 'POST', body: form });
  const body = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(upstreamMask.format, 'png');
  assert.equal(upstreamMask.hasAlpha, true);
});
test('inpaint forwards denoise input options and keeps a precise mask aligned', async (t) => {
  const base = await startApp(t);
  const originalFetch = globalThis.fetch;
  let receivedImage;
  let receivedMask;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(base)) return originalFetch(url, init);
    receivedImage = await sharp(Buffer.from(await init.body.get('image').arrayBuffer())).metadata();
    receivedMask = await sharp(Buffer.from(await init.body.get('mask').arrayBuffer())).metadata();
    return new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const source = await sharp({ create: { width: 1800, height: 900, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const form = new FormData();
  form.append('image', new Blob([source], { type: 'image/png' }), 'image.png');
  form.append('mask', await pngBlob(4), 'mask.png');
  editFields(form, 'precise');
  form.append('preserveInputQuality', 'true');
  form.append('inputImageMaxDimension', '1536');
  const response = await fetch(base + '/api/inpaint', { method: 'POST', body: form });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(receivedImage.format, 'png');
  assert.equal(receivedImage.width, 1536);
  assert.equal(receivedImage.height, 768);
  assert.equal(receivedMask.width, receivedImage.width);
  assert.equal(receivedMask.height, receivedImage.height);
  assert.equal(receivedMask.hasAlpha, true);
});

test('smart edits and masked repairs send the source aspect ratio to upstream instead of a square default', async (t) => {
  const base = await startApp(t);
  const originalFetch = globalThis.fetch;
  let requestedSize;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(base)) return originalFetch(url, init);
    requestedSize = init.body.get('size');
    return new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const [width, height, size, mode] of [
    [1536, 1024, '1536x1024', 'smart'],
    [1024, 1536, '1024x1536', 'smart'],
    [1920, 1080, '1536x864', 'precise'],
    [600, 900, '1024x1536', 'smart'],
    [1024, 1024, '1024x1024', 'smart'],
  ]) {
    const image = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const form = new FormData();
    form.append('image', new Blob([image], { type: 'image/png' }), 'image.png');
    if (mode === 'precise') form.append('mask', await pngBlob(4), 'mask.png');
    editFields(form, mode);
    const response = await fetch(base + '/api/inpaint', { method: 'POST', body: form });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(requestedSize, size, `${width}x${height}/${mode}`);
  }
});

test('remote-source edits infer output dimensions after fetching the original image', async (t) => {
  const base = await startApp(t);
  const originalFetch = globalThis.fetch;
  const image = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#ffffff' } }).png().toBuffer();
  let requestedSize;
  let imageFetches = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(base)) return originalFetch(url, init);
    if (!init?.body?.get) {
      imageFetches++;
      return new Response(image, { headers: { 'Content-Type': 'image/png' } });
    }
    requestedSize = init.body.get('size');
    return new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const form = new FormData();
  form.append('imageUrl', 'https://8.8.8.8/character.png');
  editFields(form, 'smart');
  const response = await fetch(base + '/api/inpaint', { method: 'POST', body: form });
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(requestedSize, '1024x1536');
  assert.equal(imageFetches, 1, 'dimension detection must reuse the existing source fetch');
});
