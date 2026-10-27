import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';

const { generate, ApiError } = await loadFrontend("export { generate, ApiError } from './src/lib/apiClient';");
const upstreamError = {
  source: 'upstream', message: 'Your request was rejected by the safety system. safety_violations=[sexual].',
  httpStatus: 400, category: 'sexual', requestId: 'req-original-ui', redacted: false, truncated: false,
};
const failure = { ok: false, code: 'CONTENT_REJECTED', message: '上游返回内容审核拒绝（sexual）。', upstreamError };

for (const status of [400, 200]) {
  test(`API client preserves provider evidence in a ${status} failure envelope`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(failure), { status });
    try {
      await assert.rejects(generate({ provider: 'gpt-image', prompt: 'fully clothed action study' }), (error) => {
        assert.ok(error instanceof ApiError);
        assert.deepEqual(error.upstreamError, upstreamError);
        assert.equal(error.message, failure.message);
        return true;
      });
    } finally { globalThis.fetch = originalFetch; }
  });
}

test('task polling preserves the original provider category and request ID', async (t) => {
  const originalFetch = globalThis.fetch;
  let polls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/task/')) { polls++; return new Response(JSON.stringify(failure), { status: 400 }); }
    return new Response(JSON.stringify({ ok: true, taskId: 'local-task-fixture' }), { status: 200 });
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const result = generate({ provider: 'gpt-image', prompt: 'fully clothed action study' });
    // Give the real response parser time to enter its polling delay.
    await new Promise((resolve) => setImmediate(resolve));
    const check = assert.rejects(result, (error) => {
      assert.equal(error.code, 'CONTENT_REJECTED');
      assert.deepEqual(error.upstreamError, upstreamError);
      return true;
    });
    t.mock.timers.tick(3000);
    await check;
    assert.equal(polls, 1);
  } finally { globalThis.fetch = originalFetch; }
});
