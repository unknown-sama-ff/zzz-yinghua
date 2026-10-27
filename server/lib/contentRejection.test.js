import assert from 'node:assert/strict';
import test from 'node:test';
import { contentRejectionError } from './contentRejection.js';

test('a content rejection keeps the provider message distinct from local advice', () => {
  const message = 'Your request was rejected by the safety system. safety_violations=[sexual].';
  const error = contentRejectionError(new Response('', { status: 400 }), JSON.stringify({ error: {
    message, code: 'moderation_blocked', type: 'image_generation_error', request_id: 'req-original-123',
  } }));
  assert.equal(error.code, 'CONTENT_REJECTED');
  assert.deepEqual(error.upstreamError, {
    source: 'upstream', message, httpStatus: 400, code: 'moderation_blocked',
    type: 'image_generation_error', category: 'sexual', requestId: 'req-original-123', redacted: false, truncated: false,
  });
  assert.notEqual(error.message, message);
});

test('provider diagnostics redact credentials and image data before returning them to the browser', () => {
  const secret = 'a-realistic-private-provider-credential';
  const message = `Your request was rejected by the safety system. safety_violations=[sexual]. Authorization: Bearer ${secret}; image=data:image/png;base64,YWJjZA==`;
  const error = contentRejectionError(new Response('', { status: 400, headers: { 'x-request-id': 'req-header-123' } }), JSON.stringify({ error: { message } }), [secret]);
  assert.equal(error.upstreamError.requestId, 'req-header-123');
  assert.equal(error.upstreamError.redacted, true);
  assert.doesNotMatch(error.upstreamError.message, /a-realistic-private|YWJjZA/);
  assert.match(error.upstreamError.message, /safety_violations=\[sexual\]/);
});
