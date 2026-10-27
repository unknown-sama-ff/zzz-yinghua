import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

let harnessId = 0;
async function clientHarness(t) {
  const workers = [];
  class MockWorker {
    listeners = new Map();
    requests = [];
    terminated = false;
    constructor() { workers.push(this); }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    postMessage(request) { this.requests.push(request); }
    terminate() { this.terminated = true; }
    emit(type, data) {
      for (const listener of [...(this.listeners.get(type) ?? [])]) listener(type === 'message' ? { data } : {});
    }
    reply(index, images) {
      this.emit('message', { requestId: this.requests[index].requestId, type: 'result', data: { ok: true, images } });
    }
    listenerCount() { return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0); }
  }
  const originalWorker = globalThis.Worker;
  const originalFetch = globalThis.fetch;
  globalThis.Worker = MockWorker;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, images: ['unused'] }));
  t.after(() => { globalThis.Worker = originalWorker; globalThis.fetch = originalFetch; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = await build({
    stdin: { contents: `export { generate, ApiError } from './src/lib/apiClient'; export const harnessId = ${harnessId++};`, resolveDir: resolve('.'), sourcefile: 'api-client-test.ts', loader: 'ts' },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    define: { 'import.meta.env': '{}', 'import.meta.url': '"https://test.invalid/src/lib/apiClient.ts"' },
    write: false,
  });
  const client = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  return { client, workers };
}

async function waitingForRequests(workers, count) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (workers[0]?.requests.length === count) return workers[0];
    await new Promise((done) => setImmediate(done));
  }
  assert.equal(workers[0]?.requests.length, count, 'requests must reach the shared JSON worker');
}

test('concurrent generation responses stay with their request when the worker replies in reverse order', async (t) => {
  const { client, workers } = await clientHarness(t);
  const first = client.generate({ provider: 'gpt-image', prompt: 'first session' });
  const second = client.generate({ provider: 'gpt-image', prompt: 'second session' });
  const worker = await waitingForRequests(workers, 2);
  worker.reply(1, ['second-image']);
  assert.deepEqual(await second, ['second-image']);
  worker.reply(0, ['first-image']);
  assert.deepEqual(await first, ['first-image']);
  assert.equal(worker.listenerCount(), 0, 'completed requests must release all event listeners');
  t.mock.timers.tick(60_001);
});

test('a worker parse failure falls back to the retained response and releases listeners', async (t) => {
  const { client, workers } = await clientHarness(t);
  const recovered = client.generate({ provider: 'gpt-image', prompt: 'worker parse failure', idempotencyKey: 'parse-failure' });
  const successful = client.generate({ provider: 'gpt-image', prompt: 'valid response' });
  const worker = await waitingForRequests(workers, 2);
  worker.emit('message', { requestId: worker.requests[0].requestId, type: 'error', message: 'invalid JSON' });
  assert.deepEqual(await recovered, ['unused']);
  worker.reply(1, ['valid-image']);
  assert.deepEqual(await successful, ['valid-image']);
  assert.equal(worker.listenerCount(), 0);
});

test('a timed-out worker parse falls back all pending requests and later requests get a fresh worker', async (t) => {
  const { client, workers } = await clientHarness(t);
  const first = client.generate({ provider: 'gpt-image', prompt: 'slow response one' });
  const second = client.generate({ provider: 'gpt-image', prompt: 'slow response two' });
  const worker = await waitingForRequests(workers, 2);
  t.mock.timers.tick(120_000);
  assert.deepEqual(await Promise.all([first, second]), [['unused'], ['unused']]);
  assert.equal(worker.terminated, true, 'a timed-out parser must be terminated');
  const current = client.generate({ provider: 'gpt-image', prompt: 'new response' });
  for (let attempt = 0; attempt < 50 && workers[1]?.requests.length !== 1; attempt++) await new Promise((done) => setImmediate(done));
  assert.equal(workers.length, 2, 'a later request must create a fresh parser');
  workers[1].reply(0, ['current-image']);
  assert.deepEqual(await current, ['current-image']);
  assert.equal(workers[1].listenerCount(), 0);
});

for (const event of ['error', 'messageerror']) {
  test(`a worker ${event} falls back for current requests and a later generation uses a fresh worker`, async (t) => {
    const { client, workers } = await clientHarness(t);
    const first = client.generate({ provider: 'gpt-image', prompt: 'first' }).catch((error) => error);
    const second = client.generate({ provider: 'gpt-image', prompt: 'second' }).catch((error) => error);
    const worker = await waitingForRequests(workers, 2);
    worker.emit(event);
    assert.deepEqual(await first, ['unused']);
    assert.deepEqual(await second, ['unused']);
    assert.equal(worker.terminated, true);
    assert.equal(worker.listenerCount(), 0);
    const next = client.generate({ provider: 'gpt-image', prompt: 'recover' });
    for (let attempt = 0; attempt < 50 && workers[1]?.requests.length !== 1; attempt++) await new Promise((done) => setImmediate(done));
    assert.equal(workers.length, 2);
    workers[1].reply(0, ['recovered-image']);
    assert.deepEqual(await next, ['recovered-image']);
    assert.equal(workers[1].listenerCount(), 0);
  });
}

test('a failed worker post falls back and releases every listener and timer', async (t) => {
  const { client, workers } = await clientHarness(t);
  const first = client.generate({ provider: 'gpt-image', prompt: 'warm worker' });
  const worker = await waitingForRequests(workers, 1);
  worker.reply(0, ['warm-image']);
  await first;
  worker.postMessage = () => { throw new Error('could not clone input'); };
  assert.deepEqual(await client.generate({ provider: 'gpt-image', prompt: 'clone failure' }), ['unused']);
  assert.equal(worker.listenerCount(), 0);
  t.mock.timers.tick(120_001);
});

test('an invalid HTTP 200 body still reports a response parse failure after fallback', async (t) => {
  const { client, workers } = await clientHarness(t);
  globalThis.fetch = async () => new Response('{invalid', { status: 200 });
  const failure = client.generate({ provider: 'gpt-image', prompt: 'invalid JSON', idempotencyKey: 'invalid-json' }).catch((error) => error);
  const worker = await waitingForRequests(workers, 1);
  worker.emit('message', { requestId: worker.requests[0].requestId, type: 'error', message: 'invalid JSON' });
  const error = await failure;
  assert.equal(error.code, 'UPSTREAM_ERROR');
  assert.equal(error.status, 200);
  assert.equal(error.requestId, 'invalid-json');
  assert.equal(worker.listenerCount(), 0);
});

test('HTTP failures carry a status and the application attempt ID without exposing request credentials', async (t) => {
  const { client } = await clientHarness(t);
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, code: 'UPSTREAM_ERROR', message: 'gpt-image 图像编辑返回 400' }), { status: 400 });
  await assert.rejects(() => client.generate({ provider: 'gpt-image', prompt: 'test', apiKey: 'private-key', idempotencyKey: 'attempt-400' }), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.requestId, 'attempt-400');
    assert.equal(error.message.includes('private-key'), false);
    return true;
  });
});

for (const [status, code, message] of [[502, 'UPSTREAM_ERROR', '上游已确认生成失败'], [404, 'NOT_FOUND', '任务不存在或已过期']]) {
  test(`task polling surfaces a structured ${status} failure with the original attempt ID`, async (t) => {
    const { client, workers } = await clientHarness(t);
    let generations = 0;
    let polls = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/task/')) {
        polls += 1;
        return new Response(JSON.stringify({ ok: false, code, message }), { status });
      }
      generations += 1;
      return new Response(JSON.stringify({ ok: true, taskId: 'one-task' }));
    };
    let error;
    const generation = client.generate({ provider: 'gpt-image', prompt: 'async result', idempotencyKey: 'original-attempt' }).catch((failure) => { error = failure; });
    const worker = await waitingForRequests(workers, 1);
    worker.emit('message', { requestId: worker.requests[0].requestId, type: 'result', data: { ok: true, taskId: 'one-task' } });
    await new Promise((done) => setImmediate(done));
    t.mock.timers.tick(3_000);
    await new Promise((done) => setImmediate(done));
    assert.ok(error, 'a confirmed error must stop polling instead of waiting until the deadline');
    await generation;
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.equal(error.message, message);
    assert.equal(error.requestId, 'original-attempt');
    assert.equal(polls, 1);
    assert.equal(generations, 1, 'poll failures never start another generation');
  });
}

test('task polling keeps waiting for a 202 pending response and returns that task result', async (t) => {
  const { client, workers } = await clientHarness(t);
  let polls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/task/')) {
      polls += 1;
      return polls === 1
        ? new Response(JSON.stringify({ ok: true, taskId: 'pending-task', status: 'running' }), { status: 202 })
        : new Response(JSON.stringify({ ok: true, images: ['completed-task-image'], taskId: 'pending-task' }));
    }
    return new Response(JSON.stringify({ ok: true, taskId: 'pending-task' }));
  };
  const generation = client.generate({ provider: 'gpt-image', prompt: 'pending task', idempotencyKey: 'pending-attempt' });
  const worker = await waitingForRequests(workers, 1);
  worker.emit('message', { requestId: worker.requests[0].requestId, type: 'result', data: { ok: true, taskId: 'pending-task' } });
  await new Promise((done) => setImmediate(done));
  t.mock.timers.tick(3_000);
  await new Promise((done) => setImmediate(done));
  assert.equal(polls, 1);
  t.mock.timers.tick(3_000);
  assert.deepEqual(await generation, ['completed-task-image']);
  assert.equal(polls, 2);
});

test('the real JSON worker parses response Blobs and echoes request IDs for valid and malformed JSON', async () => {
  const result = await build({ entryPoints: ['src/workers/jsonWorker.ts'], bundle: true, platform: 'browser', format: 'iife', write: false });
  const replies = [];
  const worker = {};
  runInNewContext(result.outputFiles[0].text, { self: worker, TextDecoder, Blob, postMessage: (reply) => replies.push(reply) });
  const validJson = '{"ok":true,"images":["worker-image"]}';
  await worker.onmessage({ data: { requestId: 'success', blob: new Blob([validJson]) } });
  await worker.onmessage({ data: { requestId: 'failure', buffer: new TextEncoder().encode('{invalid').buffer } });
  for (const [requestId, type] of [['success', 'result'], ['failure', 'error']]) {
    const reply = replies.find((item) => item.requestId === requestId);
    assert.equal(reply.type, type);
  }
  assert.equal(replies[0].requestId, 'success');
  assert.equal(replies[0].type, 'result');
  assert.deepEqual(Array.from(replies[0].data.images), ['worker-image']);
  assert.equal(replies[1].requestId, 'failure');
  assert.equal(replies[1].type, 'error');
});
