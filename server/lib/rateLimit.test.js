import assert from 'node:assert/strict';
import test from 'node:test';
import { capN } from '../providers.js';

/**
 * The budget ledger is module-level state, so each case needs a fresh module
 * instance — a unique query string defeats the ESM cache.
 *
 * The two caps are read at different times: PRESET_DAILY_PER_IDENTITY_CAP once
 * at import, PRESET_DAILY_CAP on every call. So the env has to stay in place for
 * the duration of the test, not just across the import, and is restored via
 * t.after rather than immediately.
 */
let instance = 0;
async function freshBudget(t, { cap, perIdentityCap }) {
  const previous = {
    cap: process.env.PRESET_DAILY_CAP,
    perIdentity: process.env.PRESET_DAILY_PER_IDENTITY_CAP,
  };
  t.after(() => {
    if (previous.cap === undefined) delete process.env.PRESET_DAILY_CAP;
    else process.env.PRESET_DAILY_CAP = previous.cap;
    if (previous.perIdentity === undefined) delete process.env.PRESET_DAILY_PER_IDENTITY_CAP;
    else process.env.PRESET_DAILY_PER_IDENTITY_CAP = previous.perIdentity;
  });

  if (cap === undefined) delete process.env.PRESET_DAILY_CAP;
  else process.env.PRESET_DAILY_CAP = String(cap);
  if (perIdentityCap === undefined) delete process.env.PRESET_DAILY_PER_IDENTITY_CAP;
  else process.env.PRESET_DAILY_PER_IDENTITY_CAP = String(perIdentityCap);

  const mod = await import(`./rateLimit.js?budget-test=${instance++}`);
  return mod.consumePresetBudget;
}

test('budget charges one unit per image, not per request', async (t) => {
  const consume = await freshBudget(t, { cap: 10, perIdentityCap: 10 });
  // A 4-image request must spend 4 of the 10 available units.
  assert.equal(consume('ip:1.2.3.4', 4), true);
  // 6 remain, so 6 more succeed and the 7th does not.
  assert.equal(consume('ip:1.2.3.4', 6), true);
  assert.equal(consume('ip:1.2.3.4', 1), false);
});

test('a request larger than the remaining budget is denied outright', async (t) => {
  const consume = await freshBudget(t, { cap: 5, perIdentityCap: 5 });
  assert.equal(consume('ip:1.2.3.4', 3), true);
  // Only 2 left: a 3-image request must not be partially served, since the
  // provider would still be asked for all 3.
  assert.equal(consume('ip:1.2.3.4', 3), false);
  // And the failed attempt must not have consumed anything.
  assert.equal(consume('ip:1.2.3.4', 2), true);
  assert.equal(consume('ip:1.2.3.4', 1), false);
});

test('the global cap is charged per image independently of the identity cap', async (t) => {
  // The per-identity cap is set out of reach so only the global ledger can deny.
  // Without this case the suite would pass even if the global path still counted
  // one unit per request, because a matching identity cap would mask it.
  const consume = await freshBudget(t, { cap: 4, perIdentityCap: 1000 });
  assert.equal(consume('ip:1.1.1.1', 4), true);
  // The global cap is now exhausted, even though this is a different caller
  // whose own per-identity allowance is nowhere near spent.
  assert.equal(consume('ip:2.2.2.2', 1), false);
});

test('the per-identity cap is also counted in images', async (t) => {
  const consume = await freshBudget(t, { cap: 100, perIdentityCap: 5 });
  assert.equal(consume('ip:1.1.1.1', 5), true);
  assert.equal(consume('ip:1.1.1.1', 1), false);
  // A different caller still has their own allowance out of the global cap.
  assert.equal(consume('ip:2.2.2.2', 5), true);
});

test('omitted or invalid unit counts fall back to charging one', async (t) => {
  const consume = await freshBudget(t, { cap: 3, perIdentityCap: 3 });
  assert.equal(consume('ip:1.2.3.4'), true);          // defaults to 1
  assert.equal(consume('ip:1.2.3.4', 0), true);       // 0 would be free
  assert.equal(consume('ip:1.2.3.4', -5), true);      // negative would refund
  assert.equal(consume('ip:1.2.3.4', 1), false);      // all 3 now spent
});

test('a zero cap denies every request regardless of size', async (t) => {
  const consume = await freshBudget(t, { cap: 0, perIdentityCap: 10 });
  assert.equal(consume('ip:1.2.3.4', 1), false);
});

test('the charged count matches what the provider is asked for', () => {
  // capN is the single source of truth for both, so the ledger can't drift from
  // the provider request.
  assert.equal(capN({ n: 3 }), 3);
  assert.equal(capN({ n: 99 }), 5);   // clamped to MAX_GENERATE_N
  assert.equal(capN({ n: 1 }), 1);
  assert.equal(capN({}), 1);
  assert.equal(capN({ n: 2.5 }), 1);  // non-integer → 1
});
