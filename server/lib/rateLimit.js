// ── In-memory sliding-window rate limiter + server-preset daily budget ──────
//
// Suitable for a single long-running Node process (Railway). Not shared across
// serverless instances — for multi-instance deploys move the preset budget to
// Supabase (see the plan) and accept per-instance rate-limit approximations.

/** Express middleware factory. `keyFn(req)` returns the identity key; `max`
 *  requests per `windowMs` are allowed, the rest get HTTP 429. */
export function createRateLimiter({ max, windowMs, keyFn, maxKeys = 10000 }) {
  const limit = Number(max) || 30;
  const window = Number(windowMs) || 60_000;
  const hits = new Map(); // key -> sorted timestamps (ms)
  let nextSweep = 0;

  return function rateLimit(req, res, next) {
    const key = keyFn(req);
    if (!key) return next(); // no identity available — don't rate limit
    const now = Date.now();
    const cutoff = now - window;
    if (now >= nextSweep) {
      for (const [storedKey, timestamps] of hits) if (!timestamps.length || timestamps[timestamps.length - 1] <= cutoff) hits.delete(storedKey);
      nextSweep = now + window;
    }
    let bucket = hits.get(key);
    if (!bucket) {
      if (hits.size >= maxKeys) return res.status(429).json({ ok: false, code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' });
      bucket = [];
      hits.set(key, bucket);
    }
    // Drop entries that fell out of the window.
    while (bucket.length && bucket[0] <= cutoff) bucket.shift();
    if (bucket.length >= limit) {
      return res.status(429).json({ ok: false, code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' });
    }
    bucket.push(now);
    next();
  };
}

/**
 * Anonymous callers can choose arbitrary Cookie headers. Bind their quota to
 * req.ip, interpreted through the configured trusted proxy hop, not a cookie.
 * Verified WeChat identities are handled separately by the application.
 */
export function requestKey(req) {
  const ip = req.ip || req.socket?.remoteAddress || '';
  return ip ? `ip:${ip}` : null;
}

// ── Server-preset daily budget ────────────────────────────────────────────────
// Guards against anonymous callers burning the operator's paid API keys
// (SEEDREAM / OPENAI / VISION) via useServerPreset. Counts per UTC day in
// process memory; PRESET_DAILY_CAP=0 disables server-preset usage entirely.

const presetUsage = new Map(); // 'YYYY-MM-DD' -> count (global)

/**
 * Atomically consume `units` of the global daily budget (PRESET_DAILY_CAP).
 *
 * One unit is one upstream IMAGE, not one request: a request asking for 5
 * images costs the operator 5 images' worth of paid quota, so it must cost 5
 * units here. Callers pass the effective image count (see capN in
 * providers.js).
 *
 * All-or-nothing: a request that doesn't fit entirely within the remaining
 * budget is denied rather than silently downgraded to fewer images, because the
 * provider would still be asked for the full count.
 */
export function consumePresetBudget(units = 1) {
  const raw = process.env.PRESET_DAILY_CAP;
  const cap = raw === undefined || raw === '' ? 200 : Number(raw);
  if (!Number.isFinite(cap) || cap <= 0) return false; // cap 0 → deny all
  // Guard against a non-integer or absurd count reaching the ledger; the
  // provider clamp already bounds this, but the budget must not be corruptible
  // by a bad caller.
  const cost = Number.isInteger(units) && units > 0 ? units : 1;
  const today = new Date().toISOString().slice(0, 10);
  const usedGlobal = presetUsage.get(today) || 0;
  if (usedGlobal + cost > cap) return false;
  presetUsage.set(today, usedGlobal + cost);
  return true;
}
