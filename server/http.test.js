import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchWithTimeout, fetchBufferLimited, parseJsonSafe, assertSafeUrl, createPublicLookup, logUrlOrigin } from './http.js';

test('URL diagnostics omit credentials, signed queries and private paths', () => {
  assert.equal(logUrlOrigin('https://user:private-password@example.com/private/path?signature=private-token'), 'https://example.com');
  assert.equal(logUrlOrigin('invalid-private-endpoint'), '(invalid URL)');
});

function stalledResponse() {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"partial":')); },
    cancel() { cancelled = true; },
  });
  return { response: new Response(body, { headers: { 'content-type': 'application/json' } }), cancelled: () => cancelled };
}

for (const consumer of ['buffer', 'json', 'text']) {
  test(`deadline covers slow body consumption through ${consumer}`, async (t) => {
    const upstream = stalledResponse();
    let signal;
    t.mock.method(globalThis, 'fetch', async (_url, options) => { signal = options.signal; return upstream.response; });
    const operation = consumer === 'buffer'
      ? fetchBufferLimited('https://8.8.8.8/image', {}, 20, 1000)
      : fetchWithTimeout('https://8.8.8.8/image', {}, 20).then(res => consumer === 'json' ? parseJsonSafe(res) : res.text());
    await assert.rejects(operation, error => error.code === 'UPSTREAM_TIMEOUT' && error.status === 504);
    assert.equal(signal.aborted, true);
    assert.equal(upstream.cancelled(), true);
  });
}

test('completed body clears deadline and preserves response metadata', async (t) => {
  let signal;
  t.mock.method(globalThis, 'fetch', async (_url, options) => { signal = options.signal; return new Response('{"ok":true}', { status: 201 }); });
  const res = await fetchWithTimeout('https://8.8.8.8/json', {}, 20);
  assert.equal(res.status, 201);
  assert.deepEqual(await parseJsonSafe(res), { ok: true });
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(signal.aborted, false);
});

test('size limit cancels streamed bodies and clears deadline', async (t) => {
  let signal;
  const upstream = stalledResponse();
  t.mock.method(globalThis, 'fetch', async (_url, options) => { signal = options.signal; return upstream.response; });
  const result = await fetchBufferLimited('https://8.8.8.8/image', {}, 20, 3);
  assert.equal(result.status, 413);
  assert.equal(upstream.cancelled(), true);
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(signal.aborted, false);
});

test('redirects still block private targets and cancel abandoned bodies', async (t) => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(body, { status: 302, headers: { location: 'http://127.0.0.1/private' } }));
  await assert.rejects(fetchWithTimeout('https://8.8.8.8/start', {}, 100), error => error.code === 'SSRF_BLOCKED');
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(cancelled, true);
});

test('cross-origin image redirects never forward caller credentials or custom secret headers', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, headers: new Headers(options.headers) });
    return requests.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://1.1.1.1/image' } }) : new Response('image');
  });
  const response = await fetchWithTimeout('https://8.8.8.8/image', { headers: { Authorization: 'Bearer test-secret', 'X-Api-Key': 'test-key', 'X-Custom-Secret': 'private', Accept: 'image/webp' } }, 500);
  await response.text();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].headers.get('authorization'), null);
  assert.equal(requests[1].headers.get('x-api-key'), null);
  assert.equal(requests[1].headers.get('x-custom-secret'), null);
  assert.equal(requests[1].headers.get('accept'), 'image/webp');
});

test('cross-origin API redirects cannot replay a private POST body', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 307, headers: { location: 'https://1.1.1.1/collect' } }));
  await assert.rejects(fetchWithTimeout('https://8.8.8.8/api', { method: 'POST', body: 'private image data', headers: { Authorization: 'Bearer test-secret' } }, 500), error => error.code === 'SSRF_BLOCKED');
  assert.equal(request.mock.callCount(), 1);
});

test('connection-time DNS lookup rejects rebinding and mixed public/private answers', async () => {
  let count = 0;
  const resolver = async () => ++count === 1 ? [{ address: '8.8.8.8', family: 4 }] : [{ address: '127.0.0.1', family: 4 }];
  const guarded = createPublicLookup(resolver);
  const resolve = () => new Promise((done, reject) => guarded('test.example', { all: true }, (error, addresses) => error ? reject(error) : done(addresses)));
  assert.deepEqual(await resolve(), [{ address: '8.8.8.8', family: 4 }]);
  await assert.rejects(resolve, error => error.code === 'SSRF_BLOCKED');
  const mixed = createPublicLookup(async () => [{ address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 }]);
  await assert.rejects(() => new Promise((done, reject) => mixed('test.example', { all: true }, (error, addresses) => error ? reject(error) : done(addresses))), error => error.code === 'SSRF_BLOCKED');
});

test('IPv6 translation/tunnel addresses and embedded URL credentials are rejected', async () => {
  for (const url of ['http://[::ffff:169.254.169.254]', 'http://[64:ff9b::7f00:1]', 'http://[2002:7f00:1::]', 'http://[2001::]', 'http://[ff02::1]', 'https://user:secret@8.8.8.8']) await assert.rejects(() => assertSafeUrl(url), error => error.code === 'SSRF_BLOCKED');
});

test('JSON response size is bounded and raw non-JSON error bodies stay out of logs', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('a response that is too large'));
  const response = await fetchWithTimeout('https://8.8.8.8/api', { maxResponseBytes: 4 }, 500);
  await assert.rejects(() => response.text(), error => error.status === 413);
  const messages = [];
  t.mock.method(console, 'warn', (...args) => messages.push(args.join(' ')));
  await assert.rejects(() => parseJsonSafe(new Response('<html>private-test-credential</html>')));
  assert.doesNotMatch(messages.join(' '), /private-test-credential/);
});
