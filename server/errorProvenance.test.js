import assert from 'node:assert/strict';
import test from 'node:test';
import { providers } from './providers.js';
import { contentRejectionError } from './lib/contentRejection.js';

process.env.VERCEL = '1';
const { default: app } = await import('./index.js');
const originalMessage = 'Your request was rejected by the safety system. safety_violations=[sexual].';

for (const asyncMode of [false, true]) {
  test(`provider error provenance reaches the browser through ${asyncMode ? 'async task polling' : 'synchronous generation'}`, async (t) => {
    const originalProvider = providers['gpt-image'];
    providers['gpt-image'] = async () => { throw contentRejectionError(new Response('', { status: 400 }), JSON.stringify({ error: { message: originalMessage, code: 'moderation_blocked', request_id: 'req-provenance-fixture' } })); };
    t.after(() => { providers['gpt-image'] = originalProvider; });
    const server = app.listen(0, '127.0.0.1');
    t.after(() => { server.close(); server.closeAllConnections(); });
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base + '/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'gpt-image', prompt: 'a fully clothed character study', asyncMode }),
    });
    let result = await response.json();
    if (asyncMode) {
      const taskId = result.taskId;
      for (let attempt = 0; attempt < 100; attempt++) {
        const polled = await fetch(base + '/api/task/' + taskId);
        if (polled.status !== 202) { result = await polled.json(); break; }
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CONTENT_REJECTED');
    assert.equal(result.upstreamError?.message, originalMessage);
    assert.equal(result.upstreamError?.requestId, 'req-provenance-fixture');
  });
}
