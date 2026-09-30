import assert from 'node:assert/strict';
import test from 'node:test';
import { capN } from '../providers.js';

// The budget ledger is module-level state; use a fresh import for each case.
let instance = 0;
async function freshBudget(t, cap) {
  const previous = process.env.PRESET_DAILY_CAP;
  t.after(() => {
    if (previous === undefined) delete process.env.PRESET_DAILY_CAP;
    else process.env.PRESET_DAILY_CAP = previous;
  });
  if (cap === undefined) delete process.env.PRESET_DAILY_CAP;
  else process.env.PRESET_DAILY_CAP = String(cap);
  const mod = await import(`./rateLimit.js?budget-test=${instance++}`);
  return mod.consumePresetBudget;
}

test('budget charges one unit per image, not per request', async (t) => {
  const consume = await freshBudget(t, 10);
  assert.equal(consume(4), true);
  assert.equal(consume(6), true);
  assert.equal(consume(1), false);
});

test('a request larger than the remaining budget is denied outright', async (t) => {
  const consume = await freshBudget(t, 5);
  assert.equal(consume(3), true);
  assert.equal(consume(3), false);
  assert.equal(consume(2), true);
  assert.equal(consume(1), false);
});

test('one caller can consume more than the former per-person limit', async (t) => {
  const consume = await freshBudget(t, 25);
  // There is no identity ledger: the same caller can use all 25 images.
  for (let i = 0; i < 25; i++) assert.equal(consume(1), true);
  assert.equal(consume(1), false);
});

test('omitted or invalid unit counts fall back to charging one', async (t) => {
  const consume = await freshBudget(t, 3);
  assert.equal(consume(), true);
  assert.equal(consume(0), true);
  assert.equal(consume(-5), true);
  assert.equal(consume(1), false);
});

test('a zero cap denies every request regardless of size', async (t) => {
  const consume = await freshBudget(t, 0);
  assert.equal(consume(1), false);
});

test('the charged count matches what the provider is asked for', () => {
  assert.equal(capN({ n: 3 }), 3);
  assert.equal(capN({ n: 99 }), 5);
  assert.equal(capN({ n: 1 }), 1);
  assert.equal(capN({}), 1);
  assert.equal(capN({ n: 2.5 }), 1);
});
