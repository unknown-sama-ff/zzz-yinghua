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
