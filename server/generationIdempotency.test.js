import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { providers } from './providers.js';
import { TASK_TTL_MS } from './lib/constants.js';
import { UpstreamError } from './http.js';

process.env.VERCEL = '1';
const { default: app } = await import('./index.js');

async function harness(t, handler) {
  const originalProvider = providers['gpt-image'];
  providers['gpt-image'] = handler;
  t.after(() => { providers['gpt-image'] = originalProvider; });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => { server.close(); server.closeAllConnections(); });
  await new Promise((done) => server.once('listening', done));
  return 'http://127.0.0.1:' + server.address().port;
}

function request(base, idempotencyKey, asyncMode = false) {
  return fetch(base + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'gpt-image', prompt: 'one generation', idempotencyKey, asyncMode }),
  });
}

async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((done) => setImmediate(done));
  }
  assert.ok(predicate(), 'the provider must receive the request');
}

test('a synchronous generation stays deduplicated beyond the TTL and the cache expires after completion', async (t) => {
  const pending = [];
  let calls = 0;
  const base = await harness(t, () => {
    calls += 1;
    return new Promise((done) => pending.push(done));
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const key = randomUUID();
  const first = request(base, key);
  await until(() => calls === 1);
  t.mock.timers.tick(TASK_TTL_MS + 1);
  const duplicate = request(base, key);
  await new Promise((done) => setImmediate(done));
  await new Promise((done) => setImmediate(done));
  pending.forEach((done) => done({ images: ['first-result'] }));
  const firstResponse = await first;
  const duplicateResponse = await duplicate;
  assert.equal(calls, 1, 'an in-flight request must survive the TTL without a duplicate upstream call');
  assert.deepEqual(await firstResponse.json(), { ok: true, images: ['first-result'] });
  assert.deepEqual(await duplicateResponse.json(), { ok: true, images: ['first-result'] });
  t.mock.timers.tick(TASK_TTL_MS - 1);
  assert.deepEqual(await (await request(base, key)).json(), { ok: true, images: ['first-result'] });
  assert.equal(calls, 1, 'the full TTL begins when the original generation finishes');
  t.mock.timers.tick(2);
  const afterExpiry = request(base, key);
  await until(() => calls === 2);
  pending[1]({ images: ['new-result'] });
  assert.deepEqual(await (await afterExpiry).json(), { ok: true, images: ['new-result'] });
});

test('async duplicate submissions return the same task ID immediately and retain a running task beyond the TTL', async (t) => {
  let finish;
  let calls = 0;
  const base = await harness(t, () => {
    calls += 1;
    return new Promise((done) => { finish = done; });
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const key = randomUUID();
  const first = await (await request(base, key, true)).json();
  assert.ok(first.taskId);
  assert.equal(calls, 1);
  t.mock.timers.tick(TASK_TTL_MS + 1);
  const duplicate = await (await request(base, key, true)).json();
  assert.deepEqual(duplicate, first, 'a duplicate does not wait for the upstream generation');
  assert.equal(calls, 1);
  const running = await fetch(base + '/api/task/' + first.taskId + '?metadata=1');
  assert.equal(running.status, 200);
  assert.equal((await running.json()).status, 'running');
  finish({ images: ['async-result'] });
  await new Promise((done) => setImmediate(done));
  t.mock.timers.tick(TASK_TTL_MS - 1);
  assert.deepEqual(await (await request(base, key, true)).json(), first);
  assert.equal(calls, 1);
  assert.deepEqual(await (await fetch(base + '/api/task/' + first.taskId)).json(), { ok: true, images: ['async-result'], taskId: first.taskId });
});

test('confirmed failures remain cached for their attempt and a new attempt can generate again', async (t) => {
  let calls = 0;
  const base = await harness(t, async () => {
    calls += 1;
    if (calls === 1) throw new UpstreamError('UPSTREAM_ERROR', 'gpt-image 图像编辑返回 400', 400);
    return { images: ['retry-result'] };
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const failedKey = randomUUID();
  const failure = await request(base, failedKey);
  assert.equal(failure.status, 400);
  const failureBody = await failure.json();
  t.mock.timers.tick(TASK_TTL_MS - 1);
  const cached = await request(base, failedKey);
  assert.equal(cached.status, 400);
  assert.deepEqual(await cached.json(), failureBody);
  assert.equal(calls, 1);
  assert.deepEqual(await (await request(base, randomUUID())).json(), { ok: true, images: ['retry-result'] });
  assert.equal(calls, 2);
});
