import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchWithTimeout, fetchBufferLimited, parseJsonSafe } from './http.js';

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
