import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.VERCEL = '1';
const { providers, registerTaskStore } = await import('./providers.js');

test('the real polling worker imports the secure transport and reports to its local task ID', async (t) => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.method === 'POST'
      ? { task_id: 'shared/task' }
      : { status: 'succeeded', images: ['worker-image'] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); registerTaskStore(null); });
  const previousKey = process.env.SEEDREAM_API_KEY;
  const previousBase = process.env.SEEDREAM_BASE_URL;
  process.env.SEEDREAM_API_KEY = 'worker-fixture';
  process.env.SEEDREAM_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  t.after(() => {
    if (previousKey === undefined) delete process.env.SEEDREAM_API_KEY; else process.env.SEEDREAM_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.SEEDREAM_BASE_URL; else process.env.SEEDREAM_BASE_URL = previousBase;
  });
  let timer;
  const completed = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('worker did not complete')), 10000);
    registerTaskStore({ onDone: (id, images) => resolve({ id, images }), onError: (_id, message) => reject(new Error(message)) });
  });
  t.after(() => clearTimeout(timer));
  const task = await providers.seedream({ useServerPreset: true, prompt: 'worker fixture' });
  assert.deepEqual(await completed, { id: task.taskId, images: ['worker-image'] });
  assert.notEqual(task.taskId, 'shared/task');
  assert.deepEqual(requests, ['/v1/images/generations', '/v1/tasks/shared%2Ftask']);
});
