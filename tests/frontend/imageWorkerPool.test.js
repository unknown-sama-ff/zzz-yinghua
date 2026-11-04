import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const poolSource = await readFile(new URL('../../src/lib/imageWorkerPool.ts', import.meta.url), 'utf8');
function harness({ offscreen = true } = {}) {
  const workers = [];
  const timers = new Map();
  let nextTimer = 0;
  class Worker {
    listeners = {};
    messages = [];
    terminated = false;
    constructor() { workers.push(this); }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    result(message, text) { this.listeners.message({ data: { type: 'result', requestId: message.requestId, blob: new Blob([text]) } }); }
  }
  const context = {
    exports: {}, URL, Blob, Worker, console,
    require: () => ({ CACHE_TTL_MS: 1000, CACHE_PURGE_INTERVAL_MS: 1000, WORKER_TIMEOUT_MS: 10, MAX_STITCH_HEIGHT: 1536 }),
    setInterval() {},
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    FileReader: class {
      readAsDataURL(blob) { void blob.text().then(text => { this.result = text; this.onload(); }); }
    },
    Image: class { set src(value) { queueMicrotask(() => this.onerror()); } },
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'fallback-png' }) },
    ...(offscreen ? { OffscreenCanvas: class {} } : {}),
  };
  const js = ts.transpileModule(poolSource.replaceAll('import.meta.url', "'file:///imageWorkerPool.ts'"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, context);
  return { api: context.exports, workers, timers, context };
}

test('concurrent worker results correlate by request ID even when completion order reverses', async () => {
  const { api, workers, timers } = harness();
  const first = api.stitchImages(['first']);
  const second = api.stitchImages(['second']);
  const worker = workers[0];
  assert.notEqual(worker.messages[0].requestId, worker.messages[1].requestId);
  worker.result(worker.messages[1], 'second-result');
  worker.result(worker.messages[0], 'first-result');
  assert.deepEqual(await Promise.all([first, second]), ['first-result', 'second-result']);
  assert.equal(timers.size, 0);
});

test('failed same-input request can retry and concurrent identical inputs still dedupe', async () => {
  const { api, workers, timers } = harness();
  const failed = api.stitchImages(['retry']);
  workers[0].listeners.message({ data: { type: 'error', requestId: workers[0].messages[0].requestId, message: 'bad image' } });
  await assert.rejects(failed, /image load failed/);
  const retry = api.stitchImages(['retry']);
  const duplicate = api.stitchImages(['retry']);
  assert.equal(workers[0].messages.length, 2);
  workers[0].result(workers[0].messages[1], 'recovered');
  assert.deepEqual(await Promise.all([retry, duplicate]), ['recovered', 'recovered']);
  assert.equal(timers.size, 0);
});

test('timeout terminates worker, removes pending work and ignores stale result/crash events', async () => {
  const { api, workers, timers } = harness();
  const timedOut = api.stitchImages(['old']);
  const timedOutAssertion = assert.rejects(timedOut, /image load failed/);
  const old = workers[0];
  [...timers.values()][0]();
  await timedOutAssertion;
  assert.equal(old.terminated, true);
  assert.equal(timers.size, 0);
  const current = api.stitchImages(['new']);
  const replacement = workers[1];
  // Even a forged matching ID from the old worker cannot resolve new work.
  old.result(replacement.messages[0], 'stale');
  old.listeners.error();
  replacement.result(replacement.messages[0], 'new-result');
  assert.equal(await current, 'new-result');
  assert.equal(timers.size, 0);
});

test('single-image fallback works without OffscreenCanvas', async () => {
  const { api, context } = harness({ offscreen: false });
  context.Image = class { naturalWidth = 100; naturalHeight = 200; set src(value) { queueMicrotask(() => this.onload()); } };
  assert.equal(await api.stitchImages(['single']), 'fallback-png');
});

test('worker includes request ID in both success and error responses', async () => {
  const source = await readFile(new URL('../../src/workers/imageWorker.ts', import.meta.url), 'utf8');
  const responses = [];
  const context = {
    self: {}, postMessage: message => responses.push(message),
    fetch: async () => ({ ok: true, blob: async () => new Blob(['input']) }),
    createImageBitmap: async () => ({ width: 10, height: 20 }),
    OffscreenCanvas: class { getContext() { return { drawImage() {} }; } async convertToBlob() { return new Blob(['png']); } },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  await context.self.onmessage({ data: { requestId: 42, type: 'stitch', dataUrls: ['data:image/png,test'] } });
  await context.self.onmessage({ data: { requestId: 43, type: 'stitch', dataUrls: [] } });
  context.fetch = async () => { throw new Error('network failed'); };
  await context.self.onmessage({ data: { requestId: 44, type: 'stitch', dataUrls: ['bad'] } });
  assert.equal(responses[0].requestId, 42);
  assert.equal(responses[0].type, 'result');
  assert.equal(responses[1].requestId, 43);
  assert.equal(responses[1].type, 'error');
  assert.equal(responses[2].requestId, 44);
  assert.equal(responses[2].type, 'error');
});
