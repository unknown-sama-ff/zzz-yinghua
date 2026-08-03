// ── In-memory sliding-window rate limiter + server-preset daily budget ──────
//
// Suitable for a single long-running Node process (Railway). Not shared across
// serverless instances — for multi-instance deploys move the preset budget to
// Supabase (see the plan) and accept per-instance rate-limit approximations.

/** Express middleware factory. `keyFn(req)` returns the identity key; `max`
 *  requests per `windowMs` are allowed, the rest get HTTP 429. */
export function createRateLimiter({ max, windowMs, keyFn }) {
  const limit = Number(max) || 30;
  const window = Number(windowMs) || 60_000;
  const hits = new Map(); // key -> sorted timestamps (ms)

  return function rateLimit(req, res, next) {
    const key = keyFn(req);
    if (!key) return next(); // no identity available — don't rate limit
    const now = Date.now();
    const cutoff = now - window;
    let bucket = hits.get(key);
    if (!bucket) {
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
 * Identity for rate limiting: the anonymous visitor cookie (strong — HttpOnly,
 * unguessable), else the real client IP via req.ip (which respects the app's
 * `trust proxy` setting). The raw X-Forwarded-For header is deliberately NOT
 * trusted — it is client-assertable and trivially spoofable.
 */
export function requestKey(req, cookieName = 'yinghua_payment_visitor') {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split('=');
    if (key === cookieName) {
      const token = decodeURIComponent(value.join('='));
      if (token) return `cookie:${token}`;
    }
  }
  const ip = req.ip || req.socket?.remoteAddress || '';
  return ip ? `ip:${ip}` : null;
}

// ── Server-preset daily budget ────────────────────────────────────────────────
// Guards against anonymous callers burning the operator's paid API keys
// (SEEDREAM / OPENAI / VISION) via useServerPreset. Counts per UTC day in
// process memory; PRESET_DAILY_CAP=0 disables server-preset usage entirely.

const presetUsage = new Map(); // 'YYYY-MM-DD' -> count (global)
const presetUsageByIdentity = new Map(); // 'YYYY-MM-DD:<identity>' -> count
const PRESET_DAILY_PER_IDENTITY_CAP = Number(process.env.PRESET_DAILY_PER_IDENTITY_CAP || 20);

/**
 * Atomically consume one unit of the daily budget. Enforces BOTH a global daily
 * cap (PRESET_DAILY_CAP) and a per-identity daily cap, so a single caller can't
 * monopolize the whole day's quota. `identityKey` is an opaque caller-supplied
 * string (openid hash / visitor cookie / client IP).
 */
export function consumePresetBudget(identityKey = '') {
  const raw = process.env.PRESET_DAILY_CAP;
  const cap = raw === undefined || raw === '' ? 200 : Number(raw);
  if (!Number.isFinite(cap) || cap <= 0) return false; // cap 0 → deny all
  const today = new Date().toISOString().slice(0, 10);
  const usedGlobal = presetUsage.get(today) || 0;
  if (usedGlobal >= cap) return false;
  let usedIdentity = 0;
  const identityBudgetKey = identityKey ? `${today}:${identityKey}` : '';
  if (identityBudgetKey) {
    usedIdentity = presetUsageByIdentity.get(identityBudgetKey) || 0;
    if (usedIdentity >= PRESET_DAILY_PER_IDENTITY_CAP) return false;
  }
  presetUsage.set(today, usedGlobal + 1);
  if (identityBudgetKey) presetUsageByIdentity.set(identityBudgetKey, usedIdentity + 1);
  return true;
}
