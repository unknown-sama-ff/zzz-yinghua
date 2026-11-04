import test from 'node:test';
import assert from 'node:assert/strict';
import { randomFillSync } from 'node:crypto';
import sharp from 'sharp';
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.VERCEL = '1';
const { default: app } = await import('./index.js');

async function start(t) {
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  return 'http://127.0.0.1:' + server.address().port;
}

test('untrusted browser origins cannot submit API mutations', async (t) => {
  const base = await start(t);
  const blocked = await fetch(base + '/api/generate', { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(blocked.status, 403);
  const allowed = await fetch(base + '/api/generate', { method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(allowed.status, 400, 'trusted clients still reach input validation');
});

test('malformed visitor cookies are treated as absent rather than failing a payment read', async (t) => {
  const base = await start(t);
  const result = await fetch(base + '/api/payments/orders', { headers: { Cookie: 'yinghua_payment_visitor=%' } });
  assert.equal(result.status, 404);
});

test('signed payment notification endpoints remain accessible and reject unsigned data', async (t) => {
  const base = await start(t);
  const result = await fetch(base + '/api/payments/alipay/notify', { method: 'POST', headers: { Origin: 'https://payment.example', 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' });
  assert.equal(result.status, 200); assert.equal(await result.text(), 'fail');
});

test('small metadata endpoints reject oversized JSON before business logic', async (t) => {
  const base = await start(t);
  const result = await fetch(base + '/api/payments/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ padding: 'x'.repeat(270000) }) });
  assert.equal(result.status, 413);
});

test('payment notifications enforce their format and smaller body limit', async (t) => {
  const base = await start(t);
  const json = await fetch(base + '/api/payments/alipay/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(json.status, 400);
  const large = await fetch(base + '/api/payments/alipay/notify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'padding=' + 'x'.repeat(110000) });
  assert.equal(large.status, 413);
});

test('invalid JSON is rejected without echoing request secrets', async (t) => {
  const base = await start(t);
  const result = await fetch(base + '/api/payments/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"apiKey":"private-test-credential",' });
  assert.equal(result.status, 400); assert.doesNotMatch(await result.text(), /private-test-credential/);
});

test('multipart uploads bound field counts before reaching expensive handlers', async (t) => {
  const base = await start(t);
  for (const [endpoint, count] of [['generate', 33], ['prompts', 9]]) {
    const form = new FormData();
    for (let i = 0; i < count; i++) form.append('padding' + i, 'x');
    const response = await fetch(base + '/api/' + endpoint, { method: 'POST', body: form });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /上传格式无效/);
  }
});

test('image proxy rejects active SVG documents and preserves normal raster delivery', async (t) => {
  const base = await start(t);
  const request = globalThis.fetch;
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).png().toBuffer();
  t.mock.method(globalThis, 'fetch', async (url, options) => String(url).startsWith(base)
    ? request(url, options)
    : new Response(String(url).includes('.svg') ? '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>' : png,
      { headers: { 'Content-Type': String(url).includes('.svg') ? 'image/svg+xml' : 'image/png' } }));
  const svg = await fetch(base + '/api/proxy-image?url=' + encodeURIComponent('https://8.8.8.8/active.svg'));
  assert.equal(svg.status, 400);
  assert.doesNotMatch(await svg.text(), /<svg|<script/);
  const raster = await fetch(base + '/api/proxy-image?url=' + encodeURIComponent('https://8.8.8.8/safe.png'));
  assert.equal(raster.status, 200);
  assert.equal(raster.headers.get('content-type'), 'image/png');
  assert.equal(raster.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await raster.arrayBuffer()), png);
});

test('real image composition retains the larger JSON limit required by the mini program', async (t) => {
  const base = await start(t);
  const pixels = randomFillSync(Buffer.alloc(320 * 320 * 3));
  const image = await sharp(pixels, { raw: { width: 320, height: 320, channels: 3 } }).png().toBuffer();
  const body = JSON.stringify({ op: 'stitch', images: [image.toString('base64')] });
  assert.ok(body.length > 256 * 1024);
  const response = await fetch(base + '/api/composite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});
