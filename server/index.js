import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import multer from 'multer';
import { providers, registerTaskStore } from './providers.js';
import { compositeEmbed, compositeStitch } from './lib/composite.js';
import {
  UpstreamError,
  fetchWithTimeout,
  fetchBufferLimited,
  parseJsonSafe,
  codeFromStatus,
  assertSafeUrl,
} from './http.js';
import { createRateLimiter, requestKey, consumePresetBudget } from './lib/rateLimit.js';
import {
  AlipayConfigError,
  closeTrade,
  createPagePayment,
  getConfiguredNotifyUrl,
  getConfiguredReturnUrl,
  isPaidTrade,
  queryRefund,
  queryTrade,
  refundTrade,
  sellerMatches,
  verifyNotify,
} from './payments/alipay.js';
import {
  amountBounds,
  applyTradeQuery,
  applyWechatTradeQuery,
  createOrder,
  createVisitorToken,
  findOrderForIdentity,
  isStorageError,
  listOrdersForIdentity,
  listPaidSponsors,
  parseAmountCents,
  recordNotifyAndApply,
  recordWechatNotifyAndApply,
  sha256Hex,
  visitorTokenHash,
} from './payments/orderService.js';
import {
  WechatConfigError,
  buildPaymentParams,
  code2Session,
  createJsapiOrder,
  queryOrder as wechatQueryOrder,
  queryRefund as wechatQueryRefund,
  refundTrade as wechatRefundTrade,
  verifyAndDecryptNotify,
} from './payments/wechat.js';
import { parseSponsorName } from './payments/sponsorName.js';
import { GalleryStorageError, deleteGalleryItem, listGallery, saveGalleryItem } from './gallery.js';

// Load .env without a dependency: minimal parser for KEY=VALUE lines.
loadEnv();

import { TASK_TTL_MS, MAX_UPLOAD_BYTES, MAX_FETCH_BYTES } from './lib/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Behind Railway's edge (and the optional Nginx in the mini-program topology)
// the socket peer is a trusted proxy, so trust one hop to make req.ip reflect
// the real client. This makes the IP rate-limit bucket per-client instead of a
// single global bucket keyed on the proxy address. Override with TRUST_PROXY
// (hops count, or 'false' to disable) if the topology differs.
app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : Number(process.env.TRUST_PROXY) || 1);
const IS_VERCEL = Boolean(process.env.VERCEL);
// Railway (and most PaaS) inject PORT and route the public domain to it.
// Fall back to 8080 — Railway's default target port — so a missing PORT var
// still lands where the proxy forwards. Local dev sets PORT=8787 via .env.
const PORT = Number(process.env.PORT || 8080);

const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',   // Vite dev server
  'http://localhost:8787',   // direct backend access
  'https://www.zzz-yinghua.asia',  // production frontend (www)
  'https://zzz-yinghua.asia',      // production frontend (apex)
  'https://servicewechat.com',     // WeChat mini program requests may carry this Origin
  ...(process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
    : []),
]);

const corsOrigin = (origin, callback) => {
  if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true);
  return callback(null, false);  // reflect: block unknown origins
};

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
);
// Capture the raw request body for the WeChat Pay notify endpoint — its
// signature is computed over the exact raw bytes, so a re-serialized JSON body
// would fail verification. express.raw sets req._body, so the global
// express.json below skips this path and the stream is never double-consumed.
app.use('/api/payments/wechat/notify', express.raw({ type: '*/*', limit: '100kb' }));

// Large limit to accommodate base64 image uploads. Three-view stitching tiles
// several images into one PNG, whose base64 is ~33% larger than the bytes —
// hence the generous ceiling beyond any single 10MB upload.
app.use(express.json({ limit: '50mb' }));

// Multer for multipart/form-data (inpaint endpoint).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

// ── Security hardening ───────────────────────────────────────────────────────
// Baseline response headers. A stricter SPA-level CSP is deliberately NOT added
// here: the Alipay payment form is injected into a popup that inherits the
// opener's CSP, and a `script-src 'self'` would block its inline auto-submit
// script — see src/lib/paymentClient.ts.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 30);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const rateLimit = createRateLimiter({
  max: RATE_LIMIT_MAX,
  windowMs: RATE_LIMIT_WINDOW_MS,
  // Prefer a verified identity for the bucket: a mini-program user's session
  // openid, else the visitor cookie, else the real client IP. The visitor
  // cookie is only issued after the first payment order, so the openid branch
  // matters for mini-program traffic that never touches payments.
  keyFn: (req) => {
    const identity = resolveIdentity(req);
    if (identity?.kind === 'openid') return `openid:${identity.hash}`;
    return requestKey(req);
  },
});

// Webhook endpoints do RSA/AES verification — a separate, looser limiter so an
// anonymous spammer can't drive CPU-bound signature checks, while legitimate
// payment-provider retries (bursty) aren't throttled.
const notifyRateLimit = createRateLimiter({
  max: Number(process.env.NOTIFY_RATE_LIMIT_MAX || 120),
  windowMs: 60_000,
  keyFn: (req) => requestKey(req) || 'unknown',
});

// Task polling can run 20+ requests in a couple of minutes, so it gets a looser
// window than the default generate limiter.
const taskRateLimit = createRateLimiter({
  max: Number(process.env.TASK_RATE_LIMIT_MAX || 90),
  windowMs: 60_000,
  keyFn: (req) => requestKey(req) || 'unknown',
});

const VALID_PROVIDERS = new Set(['seedream', 'gpt-image', 'custom-url']);
const VISITOR_COOKIE = 'yinghua_payment_visitor';
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;
const PAYMENT_ORDER_RE = /^[A-Za-z0-9_-]{8,80}$/;

// ── WeChat mini-program session tokens ───────────────────────────────────────
// A wx.login() code is exchanged for an openid once; that openid is then bound
// to a server-issued random session token. Identity-gated endpoints accept ONLY
// this token (x-session-token) as proof of a WeChat identity — a bare,
// client-assertable x-openid header is never trusted, so knowing someone's
// openid no longer grants access to their orders or lets you create orders in
// their name. Tokens live in process memory (Railway = one long-running node);
// sliding 7-day TTL.
const WECHAT_SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const WECHAT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const wechatSessions = new Map(); // sessionToken -> { openid, expiresAt }

function issueWechatSession(openid) {
  const token = crypto.randomBytes(32).toString('base64url');
  wechatSessions.set(token, { openid, expiresAt: Date.now() + WECHAT_SESSION_TTL_MS });
  return token;
}

function getWechatSession(token) {
  if (typeof token !== 'string' || !WECHAT_SESSION_TOKEN_RE.test(token)) return null;
  const session = wechatSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    wechatSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + WECHAT_SESSION_TTL_MS; // sliding renewal
  return session;
}

/** Identity key for the server-preset daily budget (per-openid/per-cookie/per-IP). */
function budgetKey(req) {
  const identity = resolveIdentity(req);
  if (identity?.kind === 'openid') return `openid:${identity.hash}`;
  return requestKey(req) || '';
}

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

function setVisitorCookie(req, res, token) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  const sameSite = isHttps ? 'None' : 'Lax';
  const secure = isHttps ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${VISITOR_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=31536000${secure}`);
}

function paymentOrderSummary(order) {
  if (!order) return null;
  return {
    orderNo: order.order_no,
    amount: order.amount_text,
    status: order.status,
    channel: order.channel || 'alipay',
    createdAt: order.created_at,
    paidAt: order.paid_at || null,
  };
}

/**
 * Resolve the caller's payment identity. The mini program proves its WeChat
 * identity with a server-issued session token (x-session-token); the web app
 * relies on the HttpOnly visitor cookie. A bare client-asserted x-openid header
 * is never accepted as identity. Returns null when neither is present.
 */
function resolveIdentity(req) {
  const sessionToken = typeof req.headers['x-session-token'] === 'string' ? req.headers['x-session-token'].trim() : '';
  if (sessionToken) {
    const session = getWechatSession(sessionToken);
    if (session) return { kind: 'openid', hash: sha256Hex(session.openid), openid: session.openid };
  }
  const visitorToken = getCookie(req, VISITOR_COOKIE);
  if (visitorToken) return { kind: 'visitor', hash: visitorTokenHash(visitorToken) };
  return null;
}

app.post('/api/payments/orders', rateLimit, async (req, res) => {
  const amountCents = parseAmountCents(req.body?.amount);
  const idempotencyKey = typeof req.body?.idempotencyKey === 'string' && IDEMPOTENCY_KEY_RE.test(req.body.idempotencyKey)
    ? req.body.idempotencyKey
    : null;
  if (!amountCents) return fail(res, 400, 'INVALID_INPUT', `赞助金额需在 ¥${amountBounds().min}–¥${amountBounds().max} 之间，最多两位小数`);
  if (!idempotencyKey) return fail(res, 400, 'INVALID_INPUT', '无效的支付幂等键');
  const sponsorName = parseSponsorName(req.body?.sponsorName);

  let identity = resolveIdentity(req);
  let freshVisitorToken = null;
  if (!identity) {
    freshVisitorToken = createVisitorToken();
    identity = { kind: 'visitor', hash: visitorTokenHash(freshVisitorToken) };
  }
  try {
    const returnUrl = resolvePublicReturnUrl(req);
    const { order, reused } = await createOrder({
      amountCents,
      identity,
      idempotencyKey,
      sponsorName,
      channel: 'alipay',
    });
    if (identity.kind === 'visitor' && !getCookie(req, VISITOR_COOKIE)) setVisitorCookie(req, res, freshVisitorToken);

    const paymentHtml = reused && order.status !== 'pending'
      ? null
      : createPagePayment({
        orderNo: order.order_no,
        amount: order.amount_text,
        returnUrl,
        notifyUrl: getConfiguredNotifyUrl(),
      });
    return res.json({ ok: true, order: paymentOrderSummary(order), paymentHtml });
  } catch (error) {
    if (error instanceof AlipayConfigError || isStorageError(error)) {
      return fail(res, 503, 'PAYMENT_NOT_CONFIGURED', error.message);
    }
    console.error('[payments/create] unexpected error:', error?.message || error);
    return fail(res, 500, 'UNKNOWN', '无法创建赞助订单');
  }
});

app.get('/api/payments/sponsors', rateLimit, async (_req, res) => {
  try {
    const rows = await listPaidSponsors(50);
    const sponsors = rows.map((row) => ({
      name: row.sponsor_name || 'Traveler',
      amount: row.amount_text,
      paidAt: row.paid_at,
    }));
    return res.json({ ok: true, sponsors });
  } catch (error) {
    if (isStorageError(error)) return fail(res, 503, 'PAYMENT_NOT_CONFIGURED', error.message);
    console.error('[payments/sponsors] unexpected error:', error?.message || error);
    return fail(res, 500, 'UNKNOWN', '无法获取赞助名单');
  }
});

app.get('/api/payments/orders', rateLimit, async (req, res) => {
  const identity = resolveIdentity(req);
  if (!identity) return fail(res, 404, 'NOT_FOUND', '订单不存在或无权访问');
  try {
    const orders = await listOrdersForIdentity(identity, 20);
    return res.json({ ok: true, orders: orders.map(paymentOrderSummary) });
  } catch (error) {
    if (isStorageError(error)) return fail(res, 503, 'PAYMENT_NOT_CONFIGURED', error.message);
    console.error('[payments/list] unexpected error:', error?.message || error);
    return fail(res, 500, 'UNKNOWN', '无法查询赞助订单列表');
  }
});

app.get('/api/payments/orders/:orderNo', rateLimit, async (req, res) => {
  const { orderNo } = req.params;
  const identity = resolveIdentity(req);
  if (!PAYMENT_ORDER_RE.test(orderNo) || !identity) return fail(res, 404, 'NOT_FOUND', '订单不存在或无权访问');

  try {
    let order = await findOrderForIdentity(orderNo, identity);
    if (!order) return fail(res, 404, 'NOT_FOUND', '订单不存在或无权访问');
    if (order.status === 'pending') {
      try {
        if (order.channel === 'wechat') {
          order = await applyWechatTradeQuery(order, await wechatQueryOrder(order.order_no));
        } else {
          order = await applyTradeQuery(order, await queryTrade(order.order_no));
        }
      } catch (error) {
        if (!(error instanceof AlipayConfigError) && !(error instanceof WechatConfigError)) {
          console.warn('[payments/query] trade query failed:', error?.message || error);
        }
      }
    }
    return res.json({ ok: true, order: paymentOrderSummary(order) });
  } catch (error) {
    if (isStorageError(error)) return fail(res, 503, 'PAYMENT_NOT_CONFIGURED', error.message);
    console.error('[payments/order] unexpected error:', error?.message || error);
    return fail(res, 500, 'UNKNOWN', '无法查询赞助订单');
  }
});

app.post('/api/payments/alipay/notify', notifyRateLimit, express.urlencoded({ extended: false, limit: '100kb' }), async (req, res) => {
  const params = { ...req.body };
  try {
    if (!params.app_id || !params.out_trade_no || !params.total_amount || !params.trade_status || !params.sign) {
      return res.type('text/plain').send('fail');
    }
    if (!verifyNotify(params)) return res.type('text/plain').send('fail');
    const expectedAppId = (process.env.ALIPAY_APP_ID || '').trim();
    if (!expectedAppId || params.app_id !== expectedAppId || !sellerMatches(params)) {
      return res.type('text/plain').send('fail');
    }
    const result = await recordNotifyAndApply(params);
    return res.type('text/plain').send(result.ok ? 'success' : 'fail');
  } catch (error) {
    console.warn('[payments/notify] rejected:', error?.message || error);
    return res.type('text/plain').send('fail');
  }
});

app.get('/api/payments/alipay/return', (req, res) => {
  const orderNo = typeof req.query.out_trade_no === 'string' && PAYMENT_ORDER_RE.test(req.query.out_trade_no)
    ? req.query.out_trade_no
    : '';
  const hasOrder = Boolean(orderNo);
  res.status(200).type('html').send(`<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><title>支付宝支付</title></head>
<body style="margin:0;background:#0d0a14;color:#f5f0ff;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center">
  <main>
    <p>${hasOrder ? '支付宝已返回，可以关闭此页面。' : '支付页面已返回，可以关闭此页面。'}</p>
    <button type="button" onclick="window.close()" style="padding:.6rem 1rem;cursor:pointer">关闭页面</button>
  </main>
  <script>
    window.setTimeout(() => window.close(), 100);
    window.setTimeout(() => window.close(), 800);
  </script>
</body>
</html>`);
});

// ── WeChat Pay (mini program sponsorship, JSAPI) ─────────────────────────────
app.post('/api/auth/wechat-login', rateLimit, async (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!code || !/^[A-Za-z0-9_.-]{1,128}$/.test(code)) {
    return fail(res, 400, 'INVALID_INPUT', '无效的登录凭证');
  }
  try {
    const { openid } = await code2Session(code);
    const sessionToken = issueWechatSession(openid);
    return res.json({ ok: true, openid, sessionToken });
  } catch (error) {
    if (error instanceof WechatConfigError) return fail(res, 503, 'WECHAT_NOT_CONFIGURED', error.message);
    console.warn('[auth/wechat-login] failed:', error?.message || error);
    return fail(res, 502, 'WECHAT_LOGIN_FAILED', '微信登录失败，请稍后重试');
  }
});

app.post('/api/payments/wechat/orders', rateLimit, async (req, res) => {
  const amountCents = parseAmountCents(req.body?.amount);
  const idempotencyKey = typeof req.body?.idempotencyKey === 'string' && IDEMPOTENCY_KEY_RE.test(req.body.idempotencyKey)
    ? req.body.idempotencyKey
    : null;
  if (!amountCents) return fail(res, 400, 'INVALID_INPUT', `赞助金额需在 ¥${amountBounds().min}–¥${amountBounds().max} 之间，最多两位小数`);
  if (!idempotencyKey) return fail(res, 400, 'INVALID_INPUT', '无效的支付幂等键');

  // Identity comes from the verified session token (x-session-token), never
  // from a client-assertable body field.
  const identity = resolveIdentity(req);
  if (!identity || identity.kind !== 'openid' || !identity.openid) {
    return fail(res, 401, 'UNAUTHORIZED', '需要微信登录后下单');
  }
  const openid = identity.openid;

  try {
    const { order, reused } = await createOrder({
      amountCents,
      identity,
      idempotencyKey,
      channel: 'wechat',
    });
    if (reused && order.status !== 'pending') {
      return res.json({ ok: true, order: paymentOrderSummary(order), payment: null });
    }
    const prepayId = await createJsapiOrder({ orderNo: order.order_no, amountCents, openid });
    const payment = buildPaymentParams({ orderNo: order.order_no, prepayId });
    return res.json({ ok: true, order: paymentOrderSummary(order), payment });
  } catch (error) {
    if (error instanceof WechatConfigError || isStorageError(error)) {
      return fail(res, 503, 'PAYMENT_NOT_CONFIGURED', error.message);
    }
    console.error('[payments/wechat/create] unexpected error:', error?.message || error);
    return fail(res, 500, 'UNKNOWN', '无法创建微信赞助订单');
  }
});

app.post('/api/payments/wechat/notify', notifyRateLimit, async (req, res) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
    const event = verifyAndDecryptNotify(req.headers, rawBody);
    const result = await recordWechatNotifyAndApply({
      outTradeNo: event.out_trade_no,
      transactionId: event.transaction_id,
      amountCents: event.amount?.total,
      tradeState: event.trade_state,
    });
    if (!result.ok) {
      console.warn('[payments/wechat/notify] rejected:', result.reason);
      return res.status(400).json({ code: 'FAIL', message: result.reason || '失败' });
    }
    return res.json({ code: 'SUCCESS', message: '成功' });
  } catch (error) {
    console.warn('[payments/wechat/notify] rejected:', error?.message || error);
    return res.status(400).json({ code: 'FAIL', message: '验签失败或数据无效' });
  }
});

// Service-side maintenance helpers for an admin job; never exposed as browser routes.
export const paymentMaintenance = {
  queryTrade, refundTrade, queryRefund, closeTrade,
  wechatQueryOrder, wechatRefundTrade, wechatQueryRefund,
};

// ── In-memory task registry for async image generation ────────────────────
// Vercel serverless functions have execution time limits. When running on
// Vercel, generate() returns a taskId immediately and the frontend polls
// GET /api/task/:id for completion.
const taskStore = new Map();
const generationFlights = new Map();

function cleanupGenerationFlight(idempotencyKey) {
  const entry = generationFlights.get(idempotencyKey);
  if (entry?.timer) clearTimeout(entry.timer);
  generationFlights.delete(idempotencyKey);
}

function cleanupTask(id) {
  const entry = taskStore.get(id);
  if (entry?.timer) clearTimeout(entry.timer);
  taskStore.delete(id);
}

// Let providers register task results (needed for async Vercel worker pattern).
registerTaskStore({
  onDone: (id, images) => {
    const entry = taskStore.get(id);
    if (!entry) return;
    entry.status = 'done';
    entry.images = images;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => cleanupTask(id), TASK_TTL_MS);
  },
  onError: (id, message) => {
    const entry = taskStore.get(id);
    if (!entry) return;
    entry.status = 'error';
    entry.error = message;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => cleanupTask(id), TASK_TTL_MS);
  },
});

app.get('/api/task/:id', taskRateLimit, (req, res) => {
  const { id } = req.params;
  const task = taskStore.get(id);
  if (!task) return fail(res, 404, 'NOT_FOUND', '任务不存在或已过期');
  // Metadata-only mode: the mini program first learns count/status, then pulls
  // each image as binary via /api/task/:id/images/:index. No cleanup here so the
  // binaries stay available; the TTL timer frees them.
  const metadataOnly = req.query.metadata === '1' || req.query.metadata === 'true';
  if (metadataOnly) {
    return res.json({
      ok: true,
      status: task.status,
      count: Array.isArray(task.images) ? task.images.length : 0,
      error: task.status === 'error' ? (task.error ?? '生成失败') : undefined,
      taskId: id,
    });
  }
  if (task.status === 'done') {
    cleanupTask(id);
    return res.json({ ok: true, images: task.images ?? [], taskId: id });
  }
  if (task.status === 'error') {
    cleanupTask(id);
    return fail(res, 502, 'UPSTREAM_ERROR', task.error ?? '生成失败');
  }
  // Still pending/running — 202 Accepted
  res.status(202).json({ ok: true, taskId: id, status: task.status });
});

// Binary delivery of a generated image by index — the mini program fetches
// these with responseType: 'arraybuffer' to avoid base64/JSON size limits.
app.get('/api/task/:id/images/:index', taskRateLimit, async (req, res) => {
  const { id, index } = req.params;
  const task = taskStore.get(id);
  if (!task || task.status !== 'done') return fail(res, 404, 'NOT_FOUND', '任务不存在或未完成');
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0) return fail(res, 400, 'INVALID_INPUT', '无效的图片索引');
  const images = task.images ?? [];
  if (i >= images.length) return fail(res, 404, 'NOT_FOUND', '图片索引越界');
  try {
    const buffer = await resolveImageBuffer(images[i]);
    if (!buffer) return fail(res, 502, 'UPSTREAM_ERROR', '图片获取失败');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'private, max-age=60');
    res.send(buffer);
  } catch (error) {
    console.warn(`[task/images] fetch failed id=${id} idx=${i}:`, error?.message || error);
    return fail(res, 502, 'UPSTREAM_ERROR', '图片获取失败');
  }
});

app.post('/api/generate', rateLimit, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'refImages', maxCount: 6 },
]), async (req, res) => {
  const body = { ...(req.body || {}) };

  // Normalize multipart uploads to the same shape the JSON path expects.
  if (Array.isArray(req.files?.image) && req.files.image.length > 0) {
    const file = req.files.image[0];
    body.imageBase64 = file.buffer.toString('base64');
    body.imageMime = file.mimetype;
  }
  if (Array.isArray(req.files?.refImages) && req.files.refImages.length > 0) {
    body.refImages = req.files.refImages.map((f) => ({ base64: f.buffer.toString('base64'), mime: f.mimetype }));
  }
  if (body.useServerPreset === 'true') body.useServerPreset = true;

  const idempotencyKey = typeof body.idempotencyKey === 'string' && IDEMPOTENCY_KEY_RE.test(body.idempotencyKey)
    ? body.idempotencyKey
    : null;

  if (typeof body.idempotencyKey === 'string' && !idempotencyKey) {
    return fail(res, 400, 'INVALID_INPUT', '无效的 idempotencyKey');
  }

  if (idempotencyKey) {
    const existing = generationFlights.get(idempotencyKey);
    if (existing) {
      const outcome = await existing.outcome;
      return res.status(outcome.status).json(outcome.body);
    }
  }

  const isAsync = body.asyncMode === true || body.asyncMode === 'true';
  if (isAsync) {
    // Long-running generation can exceed wx.request's timeout, so run it in the
    // background and return a taskId immediately for the mini program to poll.
    const taskId = createTaskId();
    const outcome = (async () => {
      const result = await executeGeneration(budgetKey(req), body, idempotencyKey);
      finalizeAsyncTask(taskId, result);
      return { status: 200, body: { ok: true, taskId } };
    })();
    if (idempotencyKey) {
      const timer = setTimeout(() => cleanupGenerationFlight(idempotencyKey), TASK_TTL_MS);
      generationFlights.set(idempotencyKey, { outcome, timer });
    }
    taskStore.set(taskId, { status: 'running', timer: setTimeout(() => cleanupTask(taskId), TASK_TTL_MS) });
    return res.json({ ok: true, taskId });
  }

  const outcome = executeGeneration(budgetKey(req), body, idempotencyKey);
  if (idempotencyKey) {
    const timer = setTimeout(() => cleanupGenerationFlight(idempotencyKey), TASK_TTL_MS);
    generationFlights.set(idempotencyKey, { outcome, timer });
  }

  const result = await outcome;
  return res.status(result.status).json(result.body);
});

function createTaskId() {
  return `T${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

/** Copy an executeGeneration outcome into a taskStore entry for polling. */
function finalizeAsyncTask(taskId, result) {
  const entry = taskStore.get(taskId);
  if (!entry) return;
  clearTimeout(entry.timer);
  const out = result.body || {};
  if (result.status === 200 && out.ok && Array.isArray(out.images) && out.images.length > 0) {
    entry.status = 'done';
    entry.images = out.images;
  } else if (result.status === 200 && out.ok && out.taskId) {
    // Provider returned its own long task — bridge to it and copy status/images.
    const innerId = out.taskId;
    entry.status = 'pending';
    const poll = () => {
      const inner = taskStore.get(innerId);
      if (!inner) { entry.status = 'error'; entry.error = '上游任务已过期'; return; }
      if (inner.status === 'done') { entry.status = 'done'; entry.images = inner.images; return; }
      if (inner.status === 'error') { entry.status = 'error'; entry.error = inner.error || '生成失败'; return; }
      setTimeout(poll, 1000);
    };
    poll();
  } else {
    entry.status = 'error';
    entry.error = out.message || '生成失败';
  }
  entry.timer = setTimeout(() => cleanupTask(taskId), TASK_TTL_MS);
}

/** Decode a task image (data URL, raw base64, or remote http(s) URL) to bytes. */
async function resolveImageBuffer(image) {
  if (typeof image !== 'string' || !image) return null;
  if (image.startsWith('data:')) {
    const comma = image.indexOf(',');
    if (comma < 0) return null;
    return Buffer.from(image.slice(comma + 1), 'base64');
  }
  if (/^https?:\/\//i.test(image)) {
    const url = await assertSafeUrl(image);
    const { ok, buffer } = await fetchBufferLimited(url.toString(), {}, 60000, MAX_FETCH_BYTES);
    return ok ? buffer : null;
  }
  try {
    return Buffer.from(image, 'base64');
  } catch {
    return null;
  }
}

async function executeGeneration(budgetIdentity, body, idempotencyKey) {
  const { provider, prompt } = body;

  if (!provider || !VALID_PROVIDERS.has(provider)) {
    return { status: 400, body: { ok: false, code: 'INVALID_INPUT', message: '无效的 provider' } };
  }
  if (!prompt || typeof prompt !== 'string') {
    return { status: 400, body: { ok: false, code: 'INVALID_INPUT', message: '缺少 prompt' } };
  }

  const started = Date.now();
  const hasImage = Boolean(body.imageBase64 || body.imageUrl);
  const operation = idempotencyKey ? ` operation=${idempotencyKey}` : '';

  // Server-preset (freeload) calls spend the operator's paid keys — cap daily
  // usage so anonymous callers can't burn through the quota.
  if (body.useServerPreset === true && !consumePresetBudget(budgetIdentity)) {
    return { status: 429, body: { ok: false, code: 'RATE_LIMITED', message: '服务端免费额度今日已用尽，请明日再来或自行填写 API Key' } };
  }

  console.log(
    `[generate] provider=${provider} hasImage=${hasImage} size=${body.size || 'default'} endpoint=${body.customEndpoint || body.baseUrl || '(env/default)'}${operation}`,
  );

  try {
    const result = await providers[provider](body);

    // Long-task: provider returned a task_id → register and return immediately.
    const taskId = result.taskId;
    if (taskId && (!result.images || result.images.length === 0)) {
      taskStore.set(taskId, {
        status: 'pending',
        timer: setTimeout(() => cleanupTask(taskId), TASK_TTL_MS),
      });
      console.log(`[generate] provider=${provider} task queued id=${taskId} (${Date.now() - started}ms)${operation}`);
      return { status: 200, body: { ok: true, taskId } };
    }

    if (!result.images || result.images.length === 0) {
      console.warn(`[generate] provider=${provider} 上游未返回图片 (${Date.now() - started}ms)${operation}`);
      return { status: 502, body: { ok: false, code: 'UPSTREAM_ERROR', message: '上游未返回图片' } };
    }
    console.log(`[generate] provider=${provider} ok images=${result.images.length} (${Date.now() - started}ms)${operation}`);
    return { status: 200, body: { ok: true, images: result.images } };
  } catch (err) {
    if (err instanceof UpstreamError) {
      console.warn(`[generate] provider=${provider} ${err.code}: ${err.message} (${Date.now() - started}ms)${operation}`);
      return { status: err.status, body: { ok: false, code: err.code, message: err.message } };
    }
    console.error(`[generate] unexpected error:${operation}`, err);
    return { status: 500, body: { ok: false, code: 'UNKNOWN', message: '服务端内部错误' } };
  }
}

// ── Inpaint (image + optional mask + prompt) via gpt-image ───────────────────
app.post('/api/inpaint', rateLimit, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'mask', maxCount: 1 },
]), async (req, res) => {
  if (!req.files?.image || !Array.isArray(req.files.image) || req.files.image.length === 0) {
    return fail(res, 400, 'INVALID_INPUT', '缺少图片文件 (field: image)');
  }
  const imageFile = req.files.image[0];
  const maskFile = req.files.mask?.[0];

  const { prompt, provider, model, apiKey, baseUrl, useServerPreset } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return fail(res, 400, 'INVALID_INPUT', '缺少 prompt');
  }

  const targetProvider = (typeof provider === 'string' && VALID_PROVIDERS.has(provider))
    ? provider
    : 'gpt-image';
  if (targetProvider !== 'gpt-image') {
    return fail(res, 400, 'INVALID_INPUT', '局部重绘目前仅支持 gpt-image 提供方');
  }

  const imageBase64 = imageFile.buffer.toString('base64');
  const maskBase64 = maskFile ? maskFile.buffer.toString('base64') : undefined;

  const body = {
    provider: targetProvider,
    prompt,
    imageBase64,
    imageMime: imageFile.mimetype,
    maskBase64,
    maskMime: maskFile ? maskFile.mimetype : undefined,
    n: 1,
    ...(typeof model === 'string' && model ? { model } : {}),
    ...(typeof apiKey === 'string' && apiKey ? { apiKey } : {}),
    ...(typeof baseUrl === 'string' && baseUrl ? { baseUrl } : {}),
    ...(useServerPreset === true ? { useServerPreset: true } : {}),
  };

  const started = Date.now();
  try {
    if (useServerPreset === true && !consumePresetBudget(budgetKey(req))) {
      return fail(res, 429, 'RATE_LIMITED', '服务端免费额度今日已用尽，请明日再来或自行填写 API Key');
    }
    const result = await providers[targetProvider](body);
    const taskId = result.taskId;
    if (taskId && (!result.images || result.images.length === 0)) {
      taskStore.set(taskId, {
        status: 'pending',
        timer: setTimeout(() => cleanupTask(taskId), TASK_TTL_MS),
      });
      console.log(`[inpaint] task queued id=${taskId} (${Date.now() - started}ms)`);
      return res.json({ ok: true, taskId });
    }
    if (!result.images || result.images.length === 0) {
      return fail(res, 502, 'UPSTREAM_ERROR', '上游未返回图片');
    }
    console.log(`[inpaint] ok images=${result.images.length} (${Date.now() - started}ms) mask=${Boolean(maskBase64)}`);
    return res.json({ ok: true, images: result.images });
  } catch (err) {
    if (err instanceof UpstreamError) {
      return fail(res, err.status, err.code, err.message);
    }
    console.error('[inpaint] unexpected error:', err);
    return fail(res, 500, 'UNKNOWN', '服务端内部错误');
  }
});

app.post('/api/detect-face', rateLimit, async (req, res) => {
  const { imageBase64, imageMime, apiKey, baseUrl, model, useServerPreset } = req.body || {};
  if (!imageBase64) return fail(res, 400, 'INVALID_INPUT', '缺少图片');

  const usingPreset = useServerPreset === true;
  const key = usingPreset ? process.env.VISION_API_KEY : apiKey;
  if (!key) {
    console.warn(`[detect-face] missing key useServerPreset=${Boolean(useServerPreset)} usingPreset=${usingPreset} frontHasKey=${Boolean(apiKey)} envHasKey=${Boolean(process.env.VISION_API_KEY)}`);
    return fail(res, 401, 'UNAUTHORIZED', usingPreset ? '视觉模型服务端预设缺少 API Key' : '视觉模型缺少 API Key，请在前端填写');
  }
  if (usingPreset && !consumePresetBudget(budgetKey(req))) {
    return fail(res, 429, 'RATE_LIMITED', '服务端免费额度今日已用尽，请明日再来或自行填写 API Key');
  }
  const root = (usingPreset
    ? (process.env.VISION_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')
    : baseUrl).replace(/\/$/, '');
  if (!root) {
    return fail(res, 401, 'UNAUTHORIZED', usingPreset ? '视觉模型服务端预设缺少 Base URL' : '视觉模型缺少 Base URL，请在前端填写');
  }
  // Client-supplied base URL is attacker-controlled — validate (SSRF) before
  // use. Wrapped: Express 4 does not catch rejections from async handlers.
  if (!usingPreset && baseUrl) {
    try {
      await assertSafeUrl(baseUrl);
    } catch (error) {
      if (error instanceof UpstreamError) return fail(res, error.status || 400, error.code, error.message);
      throw error;
    }
  }
  const mime = imageMime || 'image/png';

  const resolvedModel = usingPreset
    ? (process.env.VISION_MODEL || 'gpt-4o-mini')
    : model;
  if (!resolvedModel) {
    return fail(res, 401, 'UNAUTHORIZED', usingPreset ? '视觉模型服务端预设缺少模型名称' : '视觉模型缺少模型名称，请在前端填写');
  }
  console.log(`[detect-face] useServerPreset=${Boolean(useServerPreset)} usingPreset=${usingPreset} frontHasKey=${Boolean(apiKey)} envHasKey=${Boolean(process.env.VISION_API_KEY)} root=${root} model=${resolvedModel}`);

  const body = {
    model: resolvedModel,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
        { type: 'text', text: 'Detect the character\'s facial region and body motion axis. The character may be human, robot, animal, or any creature — adapt to their anatomy:\n\nfaceTop = top of the facial feature area (human: above eyebrows; robot: top of visor/screen/faceplate; animal: above eyes)\nfaceBottom = bottom of the facial feature area (human: bottom of chin; robot: bottom of faceplate; animal: bottom of muzzle/snout)\nfaceLeft = leftmost edge of the facial feature cluster\nfaceRight = rightmost edge of the facial feature cluster\n\nCRITICAL: Both eyes must be COMPLETELY visible within [faceLeft, faceRight] — the crop window must contain the full eyes, not cut off either eye. If one eye is near the edge, expand faceLeft/faceRight outward to include it fully. Only exclude the eyes if the character genuinely has no visible eyes.\n\nbodyAxisAngle = the angle in degrees of the character\'s primary body motion axis — their spine, torso, or core limb direction. This is the dominant directional line of their pose. 0 = horizontal, positive = right side higher (counter-clockwise), range roughly -60 to +60. For a standing upright character use 90, for a lying horizontal character use 0.\n\nReturn ONLY raw JSON: {"faceTop":0.05,"faceBottom":0.48,"faceLeft":0.10,"faceRight":0.55,"bodyAxisAngle":8}\nValues are 0-1 fractions: top/bottom = fraction of image height from top, left/right = fraction of image width from left. No markdown, no explanation.' },
      ],
    }],
    max_tokens: 200,
    response_format: { type: 'json_object' },
  };

  try {
    const response = await fetchWithTimeout(`${root}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    }, 180000);
    if (!response.ok) {
      throw new UpstreamError(codeFromStatus(response.status), `detect-face 返回 ${response.status}`, response.status);
    }
    const json = await parseJsonSafe(response);
    const text = json.choices?.[0]?.message?.content ?? '';
    console.log(`[detect-face] raw response: ${text.slice(0, 200)}`);
    let coords;
    try {
      coords = JSON.parse(text);
    } catch {
      const match = text.match(/\{[^}]+\}/);
      if (!match) throw new UpstreamError('UPSTREAM_ERROR', '视觉模型未返回有效坐标');
      coords = JSON.parse(match[0]);
    }
    const faceTop = Math.max(0, Math.min(1, Number(coords.faceTop)));
    const faceBottom = Math.max(0, Math.min(1, Number(coords.faceBottom)));
    const faceLeft = Math.max(0, Math.min(1, Number(coords.faceLeft ?? 0.25)));
    const faceRight = Math.max(0, Math.min(1, Number(coords.faceRight ?? 0.75)));
    const bodyAxisAngle = Number.isFinite(Number(coords.bodyAxisAngle)) ? Number(coords.bodyAxisAngle) : 8;
    console.log(`[detect-face] faceTop=${faceTop} faceBottom=${faceBottom} faceLeft=${faceLeft} faceRight=${faceRight} bodyAxisAngle=${bodyAxisAngle}`);
    return res.json({ ok: true, faceTop, faceBottom, faceLeft, faceRight, bodyAxisAngle });
  } catch (err) {
    if (err instanceof UpstreamError) return fail(res, err.status, err.code, err.message);
    console.error('[detect-face] unexpected error:', err);
    return fail(res, 500, 'UNKNOWN', '人脸检测失败');
  }
});

// ── Image composition (mini program calls this instead of client canvas) ────
app.post('/api/composite', rateLimit, async (req, res) => {
  const { op, images, base, thumbs } = req.body || {};
  try {
    if (op === 'stitch') {
      const image = await compositeStitch(images || []);
      return res.json({ ok: true, image: `data:image/png;base64,${image}` });
    }
    if (op === 'embed') {
      const image = await compositeEmbed(base, thumbs || []);
      return res.json({ ok: true, image: `data:image/png;base64,${image}` });
    }
    return fail(res, 400, 'INVALID_INPUT', '无效的合成操作');
  } catch (error) {
    console.warn('[composite] failed:', error?.message || error);
    return fail(res, 400, 'INVALID_INPUT', '图片合成失败');
  }
});

// SSRF-guarded image proxy so the mini program can render remote images whose
// hosts (supabase.co, provider CDNs) can never be whitelisted as mini program
// request domains. Callers pass ?url=<https URL>.
app.get('/api/proxy-image', rateLimit, async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url : '';
  if (!url) return fail(res, 400, 'INVALID_INPUT', '缺少 url 参数');
  try {
    const safeUrl = await assertSafeUrl(url);
    const { ok, status, buffer, contentType } = await fetchBufferLimited(safeUrl.toString(), {}, 60000, MAX_FETCH_BYTES);
    if (!ok) {
      throw new UpstreamError(codeFromStatus(status), `proxy-image 返回 ${status}`, status);
    }
    // Only ever serve images: reflecting an upstream text/html (or script)
    // Content-Type would let anyone host arbitrary HTML/JS at this origin.
    if (!/^image\//i.test(contentType)) {
      return fail(res, 400, 'INVALID_INPUT', '仅允许代理图片资源');
    }
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
  } catch (error) {
    if (error instanceof UpstreamError) return fail(res, error.status || 502, error.code, error.message);
    console.warn('[proxy-image] failed:', error?.message || error);
    return fail(res, 502, 'UPSTREAM_ERROR', '图片获取失败');
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, port: PORT }));

// ── Gallery write API (server-mediated; the anon key stays read-only) ────────
// Saves/deletes go through the service-role key with per-row delete tokens so
// anonymous visitors can't wipe the gallery or spam rows.
app.post('/api/gallery', rateLimit, async (req, res) => {
  const body = req.body || {};
  try {
    const row = await saveGalleryItem({
      imageBase64: body.imageBase64,
      mime: body.mime,
      style: body.style,
      characterName: body.characterName,
      prompt: body.prompt,
      provider: body.provider,
      deleteToken: body.deleteToken,
    });
    return res.json({ ok: true, row });
  } catch (error) {
    if (error instanceof GalleryStorageError) return fail(res, 400, 'INVALID_INPUT', error.message);
    console.error('[gallery/save] unexpected error:', error?.message || error);
    return fail(res, 500, 'UNKNOWN', '保存到画廊失败');
  }
});

app.delete('/api/gallery/:id', rateLimit, async (req, res) => {
  // Keep the raw id — the gallery table may use integer or UUID ids, and
  // Number() would turn a UUID into NaN.
  const id = req.params.id;
  const deleteToken = typeof req.body?.deleteToken === 'string'
    ? req.body.deleteToken
    : typeof req.query.deleteToken === 'string'
      ? req.query.deleteToken
      : (typeof req.headers['x-delete-token'] === 'string' ? req.headers['x-delete-token'] : '');
  try {
    const result = await deleteGalleryItem({ id, deleteToken });
    if (!result.ok) {
      if (result.reason === 'forbidden') return fail(res, 403, 'FORBIDDEN', '无权删除该作品');
      return fail(res, 404, 'NOT_FOUND', '作品不存在或已删除');
    }
    return res.json({ ok: true });
  } catch (error) {
    if (error instanceof GalleryStorageError) return fail(res, 400, 'INVALID_INPUT', error.message);
    console.error('[gallery/delete] unexpected error:', error?.message || error);
    return fail(res, 500, 'UNKNOWN', '删除失败');
  }
});

// Read the gallery through the service-role proxy (mini program request
// domains can't include *.supabase.co, so it must read here instead).
app.get('/api/gallery', rateLimit, async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  try {
    const rows = await listGallery(limit);
    return res.json({ ok: true, rows });
  } catch (error) {
    if (error instanceof GalleryStorageError) return fail(res, 503, 'PAYMENT_NOT_CONFIGURED', error.message);
    console.error('[gallery/list] unexpected error:', error?.message || error);
    return fail(res, 500, 'UNKNOWN', '无法获取画廊');
  }
});

// In production, serve the built frontend from dist/.
const distDir = path.resolve(__dirname, '..', 'dist');
const hasDist = fs.existsSync(distDir);
console.log(`[影画工坊] distDir=${distDir} exists=${hasDist}`);

// Root handler — explicit, no dependency on express.static index resolution.
app.get('/', (_req, res) => {
  if (hasDist) return res.sendFile(path.join(distDir, 'index.html'));
  res.type('html').send('<!DOCTYPE html><html><body><h1>影画工坊</h1><p>dist/ not found</p></body></html>');
});

if (hasDist) {
  // Cache hashed assets (Vite chunks contain `-` in the filename) for 1 year,
  // and everything else for 1 hour. This avoids re-downloading unchanged JS/CSS.
  app.use((req, res, next) => {
    if (req.path.match(/^\/assets\/.*-[a-f0-9]+\.(js|css)$/)) {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (req.path.match(/\.(js|css|woff2|png|webp|jpg|ico)$/)) {
      res.set('Cache-Control', 'public, max-age=3600');
    }
    next();
  });
  app.use(express.static(distDir));
  // SPA fallback for client-side routes — never swallow /api/*
  app.get(/^(?!\/api\/).*/, (req, _res, next) => {
    // Only reach here if the path doesn't match a file in dist/
    if (req.path === '/') return next(); // already handled above
    _res.sendFile(path.join(distDir, 'index.html'));
  });
}

// Global error handler — must not crash the server
app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err?.message || err);
  if (!res.headersSent) res.status(500).json({ ok: false, code: 'UNKNOWN', message: '服务端内部错误' });
});

function fail(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

/**
 * Alipay page-payment return URL. Never derived from the Host header — that
 * would let a spoofed Host redirect the payer to a phishing domain after
 * payment (host-header injection). Prefer ALIPAY_RETURN_URL, then
 * PUBLIC_BASE_URL; in production a missing value is a hard config error.
 */
function resolvePublicReturnUrl(req) {
  const configured = getConfiguredReturnUrl();
  if (configured) return configured;
  const publicBase = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (publicBase) return `${publicBase}/api/payments/alipay/return`;
  if (process.env.NODE_ENV === 'production') {
    throw new AlipayConfigError('支付宝支付回跳地址未配置（请设置 PUBLIC_BASE_URL）');
  }
  return `${req.protocol}://${req.get('host')}/api/payments/alipay/return`;
}

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

// Vercel serverless: export the app so the runtime can use it as a handler.
// Local / Railway: start the HTTP server as before.
// Vercel serverless: export the app so the runtime uses it as a handler.
// Local / Railway: also start the HTTP server below.
export default app;

// Express 4 does not catch rejections from async route handlers. Log instead
// of letting one malformed request crash the whole (payment-adjacent) process.
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandled rejection:', reason instanceof Error ? reason.stack || reason.message : reason);
});

if (!IS_VERCEL) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[影画工坊] proxy listening on http://0.0.0.0:${PORT} dist=${hasDist} node=${process.version}`);
  });

  // Allow long image-to-image requests to complete.
  if (typeof server.requestTimeout === 'number') {
    const upstreamMs = Number(process.env.UPSTREAM_TIMEOUT_MS || 300000);
    server.requestTimeout = upstreamMs + 60000;
    server.headersTimeout = upstreamMs + 60000;
  }
}

