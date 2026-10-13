import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';

const m = await loadFrontend(`
  export { buildFreeCreateRequest, buildFreeCreateBatchRequests } from './src/lib/freeCreate';
  export { useFreeCreateStore, sessionHasPending, sessionStatus } from './src/store/useFreeCreateStore';
  export { createFreeCreateQueue } from './src/lib/freeCreateQueue';
  export { ApiError } from './src/lib/apiClient';
`);

const store = m.useFreeCreateStore;
const reference = (id, dataUrl = `data:image/png;base64,${btoa(id)}`) => ({ id, dataUrl, name: `${id}.png` });
const creds = { apiKey: 'key', baseUrl: 'https://example.invalid/v1', model: 'gpt-image-2.5-sunburst' };
const standardInput = { prompt: 'replace character', contextImageUrl: null, references: [], credentials: creds, useServerPreset: false, imageCount: 3, aspectRatio: '16:9', quality: 'high' };

function freshSession(mode = 'conversation') {
  const id = crypto.randomUUID();
  const session = { id, messages: [], draft: '', draftReferences: [], batchReferences: [], sharedReference: null, mode, costumeMode: 'character', contextImageUrl: null, contextRevision: 0, imageCount: 1, aspectRatio: '1:1', createdAt: Date.now() };
  store.setState({ sessions: [session], activeSessionId: id });
  return session;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('legacy builder keeps ordinary input order, image count, and remote context URLs', () => {
  const first = reference('first');
  const second = reference('second');
  const request = m.buildFreeCreateRequest({ ...standardInput, references: [first, second] });
  assert.equal(request.imageBase64, btoa('first'));
  assert.deepEqual(request.refImages, [{ base64: btoa('second'), mime: 'image/png' }]);
  assert.equal(request.n, 3);

  const remote = m.buildFreeCreateRequest({ ...standardInput, contextImageUrl: 'https://cdn.invalid/previous.png', references: [first] });
  assert.equal(remote.imageBase64, 'https://cdn.invalid/previous.png');
  assert.deepEqual(remote.refImages, [{ base64: btoa('first'), mime: 'image/png' }]);
});

test('fixed-character and fixed-scene builders preserve the required primary/reference order and n=1', () => {
  const sharedCharacter = reference('character');
  const targetA = reference('target-a');
  const targetB = reference('target-b');
  const characterBatch = m.buildFreeCreateBatchRequests({ ...standardInput, mode: 'fixed-character', sharedReference: sharedCharacter, targets: [targetA, targetB] });
  assert.equal(characterBatch.length, 2);
  assert.equal(characterBatch[0].request.imageBase64, btoa('target-a'));
  assert.equal(characterBatch[0].request.refImages[0].base64, 'Y2hhcmFjdGVy');
  assert.equal(characterBatch[0].request.n, 1);
  assert.equal(characterBatch[1].request.imageBase64, btoa('target-b'));

  const scene = reference('scene');
  const actorA = reference('actor-a');
  const sceneBatch = m.buildFreeCreateBatchRequests({ ...standardInput, mode: 'fixed-scene', sharedReference: scene, targets: [actorA], costumeMode: 'target' });
  assert.equal(sceneBatch[0].request.imageBase64, btoa('scene'));
  assert.equal(sceneBatch[0].request.refImages[0].base64, 'YWN0b3ItYQ==');
  assert.equal(sceneBatch[0].request.n, 1);
  assert.match(sceneBatch[0].request.prompt, /仅替换为参考图人物/);
});

test('session-bound uploads, copy, and restore preserve draft inputs without copying requests', () => {
  const original = freshSession();
  const photo = reference('photo');
  store.getState().setDraft('keep me', original.id);
  store.getState().addDraftReferences([photo], original.id);
  store.getState().copyConversation(original.id);
  const copied = store.getState().sessions.at(-1);
  assert.equal(copied.draft, 'keep me');
  assert.equal(copied.messages.length, 0);
  assert.equal(copied.draftReferences[0].id, photo.id);
  const request = m.buildFreeCreateRequest({ ...standardInput, references: [photo] });
  const generation = store.getState().enqueueGeneration({ prompt: 'keep me', references: [photo], request, sessionId: original.id });
  assert.ok(generation);

  store.getState().setMode('fixed-character', original.id);
  store.getState().setSharedReference(reference('common'), original.id);
  store.getState().addBatchReferences([reference('target')], original.id);
  store.getState().restoreDraft(original.id, generation.userMessageId);
  const restored = store.getState().sessions.find((item) => item.id === original.id);
  assert.equal(restored.mode, 'conversation');
  assert.equal(restored.draft, 'keep me');
  assert.equal(restored.draftReferences[0].id, photo.id);
});

test('failed retry reuses the full input snapshot and creates a new idempotency key', () => {
  const session = freshSession();
  const prior = reference('prior');
  const shared = reference('shared');
  const uploaded = reference('uploaded');
  store.getState().selectContextImage(prior.dataUrl, session.id);
  store.getState().setSharedReference(shared, session.id);
  store.getState().setAspectRatio('4:3', session.id);
  store.getState().setImageCount(4, session.id);
  store.getState().addDraftReferences([uploaded], session.id);
  const request = m.buildFreeCreateRequest({ ...standardInput, contextImageUrl: prior.dataUrl, sharedReference: shared, references: [uploaded], imageCount: 4, aspectRatio: '4:3' });
  const generation = store.getState().enqueueGeneration({ prompt: 'full snapshot', references: [uploaded], request });
  const claimed = store.getState().claimNextGeneration();
  store.getState().failGeneration(claimed.generation, '400 bad input', { status: 400, code: 'UPSTREAM_ERROR' });
  const failed = store.getState().sessions[0].messages.find((message) => message.id === generation.userMessageId);
  assert.equal(failed.status, 'error');
  store.getState().selectContextImage(reference('new-context').dataUrl, session.id);
  store.getState().setAspectRatio('9:16', session.id);
  const retry = store.getState().retryGeneration(session.id, generation.userMessageId);
  const retried = store.getState().sessions[0].messages.find((message) => message.id === generation.userMessageId);
  assert.ok(retry);
  assert.equal(retried.status, 'queued');
  assert.notEqual(retried.attemptId, generation.attemptId);
  assert.notEqual(retried.requestSnapshot.idempotencyKey, failed.requestSnapshot.idempotencyKey);
  assert.deepEqual(retried.requestSnapshot, { ...request, idempotencyKey: retried.requestSnapshot.idempotencyKey });
  assert.equal(retried.inputSnapshot.sharedReference.id, 'shared');
  assert.equal(retried.inputSnapshot.aspectRatio, '4:3');
});

test('uncertain result recheck keeps the key; confirmed retry changes it; 429 pauses queued work', () => {
  const session = freshSession('fixed-character');
  store.getState().setSharedReference(reference('character'), session.id);
  const target = reference('target');
  const request = m.buildFreeCreateRequest({ ...standardInput, contextImageUrl: target.dataUrl, references: [reference('character')], imageCount: 1 });
  const siblingTarget = reference('target-two');
  const siblingRequest = m.buildFreeCreateRequest({ ...standardInput, contextImageUrl: siblingTarget.dataUrl, references: [reference('character')], imageCount: 1 });
  const [generation] = store.getState().enqueueBatch({ prompt: 'batch', items: [{ reference: target, request }, { reference: siblingTarget, request: siblingRequest }] });
  const sending = store.getState().claimNextGeneration();
  store.getState().failGeneration(sending.generation, 'network unavailable', { code: 'UNKNOWN', uncertain: true });
  const uncertain = store.getState().sessions[0].messages[0];
  assert.equal(uncertain.status, 'uncertain');
  const check = store.getState().recheckGeneration(session.id, generation.userMessageId);
  assert.ok(check);
  const rechecking = store.getState().sessions[0].messages[0];
  assert.equal(rechecking.requestSnapshot.idempotencyKey, uncertain.requestSnapshot.idempotencyKey);
  const active = store.getState().claimNextGeneration();
  store.getState().failGeneration(active.generation, 'still uncertain', { uncertain: true });
  const confirmedRetry = store.getState().retryGeneration(session.id, generation.userMessageId, true);
  assert.ok(confirmedRetry);
  assert.notEqual(store.getState().sessions[0].messages[0].requestSnapshot.idempotencyKey, uncertain.requestSnapshot.idempotencyKey);
  const pending = store.getState().sessions[0].messages.find((item) => item.role === 'user' && item.status === 'queued');
  const pendingRequest = pending.requestSnapshot;
  const pendingGeneration = store.getState().claimNextGeneration();
  store.getState().failGeneration(pendingGeneration.generation, 'rate limited', { code: 'RATE_LIMITED', status: 429 });
  assert.equal(m.sessionStatus(store.getState().sessions[0]), 'paused');
  assert.equal(store.getState().claimNextGeneration(), null);
  store.getState().resumeSession(session.id);
  const resumed = store.getState().claimNextGeneration();
  assert.equal(resumed.request.idempotencyKey, pendingRequest.idempotencyKey);
});

test('queue never exceeds two active image requests and routes out-of-order batch results', async () => {
  const session = freshSession('fixed-scene');
  store.getState().setSharedReference(reference('scene'), session.id);
  const targets = Array.from({ length: 5 }, (_, i) => reference(`actor-${i}`));
  const items = targets.map((target) => ({ reference: target, request: m.buildFreeCreateRequest({ ...standardInput, contextImageUrl: 'data:image/png;base64,c2NlbmU=', references: [target], imageCount: 1 }) }));
  store.getState().enqueueBatch({ prompt: 'five targets', items });

  const pending = [];
  let active = 0;
  let maxActive = 0;
  const stop = m.createFreeCreateQueue(store, (request) => {
    const result = deferred();
    pending.push({ request, result });
    active += 1;
    maxActive = Math.max(maxActive, active);
    return result.promise.finally(() => { active -= 1; });
  });
  assert.equal(pending.length, 2);
  assert.equal(maxActive, 2);
  pending[1].result.resolve(['image-1']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 3);
  pending[2].result.resolve(['image-2']);
  pending[0].result.resolve(['image-0']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 5);
  pending[4].result.resolve(['image-4']);
  pending[3].result.resolve(['image-3']);
  await new Promise((resolve) => setImmediate(resolve));
  stop();
  const messages = store.getState().sessions[0].messages;
  const results = messages.filter((message) => message.role === 'assistant');
  assert.equal(maxActive, 2);
  assert.equal(results.length, 5);
  for (const result of results) {
    const source = messages.find((message) => message.id === result.userMessageId);
    assert.deepEqual(result.images, [`image-${source.batchIndex}`]);
  }
});
