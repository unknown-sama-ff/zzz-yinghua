import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createLayerWorkerPool } from './pool.js';
import { boundedInteger, inferenceOptions, resolveParallaxCacheDir } from './runtime.js';

async function fixturePool(t, settings = {}) {
  const root = path.resolve('node_modules/.cache/parallax-pool-tests');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'case-'));
  const workerFile = path.join(directory, 'worker.mjs');
  await fs.writeFile(workerFile, `
    let count = 0;
    process.on('disconnect', () => process.exit(0));
    process.on('message', (task) => {
      if (task.input === 'crash') process.exit(2);
      if (task.input === 'hang') return;
      if (task.input === 'fail') {
        process.send({ id: task.id, ok: false, error: 'fixture failure' });
        return;
      }
      const metrics = { workerPid: process.pid, warm: count++ > 0 };
      setTimeout(() => process.send({ id: task.id, ok: true, metrics }), task.input === 'slow' ? 80 : 0);
    });
  `);
  const pool = createLayerWorkerPool({ workerFile, ...settings });
  t.after(async () => {
    await pool.close();
    assert.ok(directory.startsWith(root + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return pool;
}

const task = (input = 'ok') => ({ model: 'fixture', depthModel: 'depth', input, output: 'fixture' });

test('inference defaults to two threads and persistent cache paths are selected explicitly', () => {
  assert.equal(boundedInteger(undefined, 2, 1, 2), 2);
  for (const value of ['0', '-1', 'NaN', '1.5', 'Infinity']) assert.equal(boundedInteger(value, 2, 1, 2), 2);
  assert.equal(boundedInteger('8', 2, 1, 2), 2);
  assert.equal(inferenceOptions().intraOpNumThreads, boundedInteger(process.env.PUZZLE_LAYER_THREADS, 2, 1, 2));
  assert.equal(resolveParallaxCacheDir({}), path.resolve('.cache/parallax'));
  assert.equal(resolveParallaxCacheDir({ RAILWAY_VOLUME_MOUNT_PATH: '/data' }), path.resolve('/data/puzzle-layers'));
  assert.equal(resolveParallaxCacheDir({ RAILWAY_VOLUME_MOUNT_PATH: '/data', PUZZLE_LAYER_CACHE_DIR: '/custom' }), path.resolve('/custom'));
});

test('a warm child handles subsequent images and at most two children run', async (t) => {
  const pool = await fixturePool(t);
  const first = await pool.run(task());
  assert.equal(first.warm, false);
  assert.equal(pool.hasIdleWorker(), true);
  const second = await pool.run(task());
  assert.equal(second.workerPid, first.workerPid);
  assert.equal(second.warm, true);
  const one = pool.run(task('slow'));
  const two = pool.run(task('slow'));
  await assert.rejects(() => pool.run(task()), /已满/);
  const results = await Promise.all([one, two]);
  assert.notEqual(results[0].workerPid, results[1].workerPid);
});

test('idle children are released and a later request starts a fresh child', async (t) => {
  const pool = await fixturePool(t, { idleMs: 20 });
  const first = await pool.run(task());
  await delay(100);
  const second = await pool.run(task());
  assert.notEqual(second.workerPid, first.workerPid);
  assert.equal(second.warm, false);
});

test('crashed, failed and timed-out workers are removed before retrying', async (t) => {
  const pool = await fixturePool(t, { maxWorkers: 1, timeoutMs: 1000 });
  await assert.rejects(() => pool.run(task('crash')), /已结束/);
  await assert.rejects(() => pool.run(task('fail')), /fixture failure/);
  await assert.rejects(() => pool.run(task('hang')), /超时/);
  assert.equal((await pool.run(task())).warm, false);
});

test('closing the pool rejects active work and further requests', async (t) => {
  const pool = await fixturePool(t);
  const pending = assert.rejects(() => pool.run(task('hang')), /已关闭/);
  await delay(30);
  await pool.close();
  await pending;
  await assert.rejects(() => pool.run(task()), /已关闭/);
});

test('idle workers allow parent exit and explicit close settles without other event-loop handles', async (t) => {
  // The fixture path is supplied to a separate parent to avoid the test runner
  // keeping it alive and hiding dangling IPC/stdio handles.
  const root = path.resolve('node_modules/.cache/parallax-pool-tests');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'exit-'));
  const workerFile = path.join(directory, 'worker.mjs');
  await fs.writeFile(workerFile, `
    process.on('disconnect', () => process.exit(0));
    process.on('message', (task) => process.send({ id: task.id, ok: true, metrics: {} }));
  `);
  t.after(async () => { assert.ok(directory.startsWith(root + path.sep)); await fs.rm(directory, { recursive: true, force: true }); });
  const poolModule = pathToFileURL(path.resolve('server/parallax/pool.js')).href;
  for (const close of [true, false]) {
    const script = `
      import { createLayerWorkerPool } from ${JSON.stringify(poolModule)};
      const pool = createLayerWorkerPool({ workerFile: ${JSON.stringify(workerFile)} });
      await pool.run(${JSON.stringify(task())});
      ${close ? 'await pool.close();' : ''}
      console.log('finished');
    `;
    const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { timeout: 5000 });
    assert.match(result.stdout, /finished/);
    assert.equal(result.stderr, '');
  }
});
