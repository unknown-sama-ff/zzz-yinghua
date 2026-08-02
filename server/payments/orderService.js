import crypto from 'node:crypto';
import { formatAmountCents, amountText, isPaidTrade, sellerMatches } from './alipay.js';
import { parseSponsorName } from './sponsorName.js';

const MIN_AMOUNT_CENTS = 1;
const MAX_AMOUNT_CENTS = 10_000_000;

let client;

class PaymentStorageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaymentStorageError';
  }
}

function getClient() {
  if (client) return client;
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    throw new PaymentStorageError('赞助订单存储尚未配置 Supabase 服务端凭据');
  }
  return import('@supabase/supabase-js').then(({ createClient }) => {
    client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return client;
  });
}

async function db() {
  return client || await getClient();
}

function ensureOk(result, message) {
  if (result.error) throw new PaymentStorageError(`${message}: ${result.error.message}`);
  return result.data;
}

export function parseAmountCents(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [yuan, fraction = ''] = text.split('.');
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < MIN_AMOUNT_CENTS || cents > MAX_AMOUNT_CENTS) return null;
  return cents;
}

export function amountBounds() {
  return {
    min: formatAmountCents(MIN_AMOUNT_CENTS),
    max: formatAmountCents(MAX_AMOUNT_CENTS),
  };
}

export function createVisitorToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** Column holding the identity hash, depending on the identity kind. */
function identityColumn(kind) {
  return kind === 'openid' ? 'openid_hash' : 'visitor_token_hash';
}

function createOrderNo() {
  return `YH${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(7).toString('hex').toUpperCase()}`;
}

export async function createOrder({ amountCents, identity, idempotencyKey, sponsorName, channel = 'alipay' }) {
  const supabase = await db();
  const { kind, hash } = identity;
  const idemColumn = identityColumn(kind);
  const selectColumns = 'order_no, amount_cents, amount_text, status, channel, created_at, paid_at';
  const existingResult = await supabase
    .from('sponsor_orders')
    .select(selectColumns)
    .eq(idemColumn, hash)
    .eq('client_idempotency_key', idempotencyKey)
    .maybeSingle();
  const existing = ensureOk(existingResult, '查询幂等订单失败');
  if (existing) return { order: existing, reused: true };

  const order = {
    order_no: createOrderNo(),
    amount_cents: amountCents,
    amount_text: formatAmountCents(amountCents),
    status: 'pending',
    channel,
    [idemColumn]: hash,
    client_idempotency_key: idempotencyKey,
    sponsor_name: parseSponsorName(sponsorName),
  };
  const result = await supabase.from('sponsor_orders').insert(order).select(selectColumns).single();
  if (result.error?.code === '23505') {
    const retry = await supabase
      .from('sponsor_orders')
      .select(selectColumns)
      .eq(idemColumn, hash)
      .eq('client_idempotency_key', idempotencyKey)
      .single();
    return { order: ensureOk(retry, '读取并发创建的订单失败'), reused: true };
  }
  return { order: ensureOk(result, '创建赞助订单失败'), reused: false };
}

export function visitorTokenHash(token) {
  return hashToken(token);
}

export async function findOrderForIdentity(orderNo, identity) {
  const supabase = await db();
  const result = await supabase
    .from('sponsor_orders')
    .select('order_no, amount_cents, amount_text, status, trade_no, channel, created_at, paid_at')
    .eq('order_no', orderNo)
    .maybeSingle();
  const order = ensureOk(result, '查询赞助订单失败');
  if (!order) return null;
  const { kind, hash } = identity;
  const matches = kind === 'openid'
    ? order.openid_hash === hash
    : order.visitor_token_hash === hash;
  return matches ? order : null;
}

export async function listPaidSponsors(limit = 50) {
  const supabase = await db();
  const result = await supabase
    .from('sponsor_orders')
    .select('sponsor_name, amount_text, paid_at')
    .eq('status', 'paid')
    .not('paid_at', 'is', null)
    .order('paid_at', { ascending: false })
    .limit(limit);
  return ensureOk(result, '查询赞助名单失败');
}

export async function recordNotifyAndApply(params) {
  const supabase = await db();
  const orderResult = await supabase
    .from('sponsor_orders')
    .select('order_no, amount_cents, amount_text, status, trade_no')
    .eq('order_no', params.out_trade_no)
    .maybeSingle();
  const order = ensureOk(orderResult, '查询回调订单失败');
  if (!order) return { ok: false, reason: 'order_not_found' };

  const expectedAmount = amountText(order.amount_text || formatAmountCents(order.amount_cents));
  const actualAmount = amountText(params.total_amount);
  if (!expectedAmount || expectedAmount !== actualAmount || !isPaidTrade(params) || !sellerMatches(params)) {
    return { ok: false, reason: 'business_mismatch' };
  }

  const notifyKey = String(params.notify_id || `${params.trade_no}:${params.trade_status}:${params.out_biz_no || ''}`);
  const existingEventResult = await supabase
    .from('payment_notify_events')
    .select('notify_key')
    .eq('notify_key', notifyKey)
    .maybeSingle();
  const existingEvent = ensureOk(existingEventResult, '查询支付宝通知事件失败');
  if (existingEvent) return { ok: true, duplicate: true, order };

  if (order.status === 'paid') {
    return order.trade_no === params.trade_no
      ? { ok: true, duplicate: true, order }
      : { ok: false, reason: 'order_already_paid' };
  }

  // Serialize concurrent notifies for the same order: a pending order may only
  // be claimed while its trade_no is still NULL, so a raced second notify with a
  // different trade_no can't overwrite the winner's trade_no.
  let updateBuilder = supabase
    .from('sponsor_orders')
    .update({
      status: 'paid',
      trade_no: params.trade_no,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('order_no', params.out_trade_no)
    .in('status', ['pending', 'paid']);
  if (order.status === 'pending') updateBuilder = updateBuilder.is('trade_no', null);
  const updateResult = await updateBuilder
    .select('order_no, amount_cents, amount_text, status, trade_no, created_at, paid_at')
    .maybeSingle();
  const updatedOrder = ensureOk(updateResult, '更新赞助订单失败');
  if (!updatedOrder) {
    // Raced: another notify claimed this order first. Re-read to classify.
    const recheck = await supabase
      .from('sponsor_orders')
      .select('status, trade_no')
      .eq('order_no', params.out_trade_no)
      .maybeSingle();
    const current = ensureOk(recheck, '重读竞态订单失败');
    if (current && current.status === 'paid' && current.trade_no === params.trade_no) {
      return { ok: true, duplicate: true, order };
    }
    return { ok: false, reason: 'order_already_paid' };
  }

  const eventResult = await supabase.from('payment_notify_events').insert({
    notify_key: notifyKey,
    notify_id: params.notify_id || null,
    trade_no: params.trade_no || null,
    order_no: params.out_trade_no,
    trade_status: params.trade_status || null,
  });
  if (eventResult.error?.code === '23505') return { ok: true, duplicate: true, order: updatedOrder };
  ensureOk(eventResult, '保存支付宝通知失败');
  return { ok: true, duplicate: false, order: updatedOrder };
}

export async function applyTradeQuery(order, trade) {
  if (!trade || !isPaidTrade({ trade_status: trade.status })) return order;
  const expectedAmount = amountText(order.amount_text || formatAmountCents(order.amount_cents));
  const actualAmount = amountText(trade.totalAmount);
  if (expectedAmount !== actualAmount || trade.appId !== (process.env.ALIPAY_APP_ID || '').trim()) return order;
  if (!sellerMatches({ seller_id: trade.sellerId, seller_email: trade.sellerEmail })) return order;

  const supabase = await db();
  const result = await supabase.from('sponsor_orders').update({
    status: 'paid',
    trade_no: trade.tradeNo,
    paid_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('order_no', order.order_no).eq('status', 'pending').select(
    'order_no, amount_cents, amount_text, status, trade_no, created_at, paid_at',
  ).maybeSingle();
  return ensureOk(result, '更新查询到的赞助订单失败') || order;
}

/** WeChat Pay notify: verify amount + channel, dedupe, pending→paid. Mirrors recordNotifyAndApply (Alipay). */
export async function recordWechatNotifyAndApply({ outTradeNo, transactionId, amountCents, tradeState }) {
  const supabase = await db();
  const orderResult = await supabase
    .from('sponsor_orders')
    .select('order_no, amount_cents, amount_text, status, trade_no, channel')
    .eq('order_no', outTradeNo)
    .maybeSingle();
  const order = ensureOk(orderResult, '查询微信回调订单失败');
  if (!order) return { ok: false, reason: 'order_not_found' };

  if (tradeState !== 'SUCCESS') return { ok: false, reason: 'trade_state_not_success' };
  if (order.amount_cents !== amountCents) return { ok: false, reason: 'amount_mismatch' };
  if (order.channel && order.channel !== 'wechat') return { ok: false, reason: 'channel_mismatch' };

  const notifyKey = `${outTradeNo}:${transactionId}`;
  const existingEventResult = await supabase
    .from('payment_notify_events')
    .select('notify_key')
    .eq('notify_key', notifyKey)
    .maybeSingle();
  const existingEvent = ensureOk(existingEventResult, '查询微信通知事件失败');
  if (existingEvent) return { ok: true, duplicate: true, order };

  if (order.status === 'paid') {
    return order.trade_no === transactionId
      ? { ok: true, duplicate: true, order }
      : { ok: false, reason: 'order_already_paid' };
  }

  // Same serialization as the Alipay path: a pending order may only be claimed
  // while trade_no is NULL, so concurrent notifies can't overwrite the winner.
  let updateBuilder = supabase
    .from('sponsor_orders')
    .update({
      status: 'paid',
      channel: 'wechat',
      trade_no: transactionId,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('order_no', outTradeNo)
    .in('status', ['pending', 'paid']);
  if (order.status === 'pending') updateBuilder = updateBuilder.is('trade_no', null);
  const updateResult = await updateBuilder
    .select('order_no, amount_cents, amount_text, status, trade_no, channel, created_at, paid_at')
    .maybeSingle();
  const updatedOrder = ensureOk(updateResult, '更新微信赞助订单失败');
  if (!updatedOrder) {
    // Raced: another notify claimed this order first. Re-read to classify.
    const recheck = await supabase
      .from('sponsor_orders')
      .select('status, trade_no')
      .eq('order_no', outTradeNo)
      .maybeSingle();
    const current = ensureOk(recheck, '重读竞态订单失败');
    if (current && current.status === 'paid' && current.trade_no === transactionId) {
      return { ok: true, duplicate: true, order };
    }
    return { ok: false, reason: 'order_already_paid' };
  }

  const eventResult = await supabase.from('payment_notify_events').insert({
    notify_key: notifyKey,
    notify_id: transactionId,
    trade_no: transactionId,
    order_no: outTradeNo,
    trade_status: tradeState,
    channel: 'wechat',
  });
  if (eventResult.error?.code === '23505') return { ok: true, duplicate: true, order: updatedOrder };
  ensureOk(eventResult, '保存微信通知失败');
  return { ok: true, duplicate: false, order: updatedOrder };
}

/** Apply a WeChat Pay trade.query result to a pending order (mirrors applyTradeQuery). */
export async function applyWechatTradeQuery(order, trade) {
  if (!trade || trade.trade_state !== 'SUCCESS') return order;
  if (order.amount_cents !== trade.amount?.total) return order;

  const supabase = await db();
  const result = await supabase.from('sponsor_orders').update({
    status: 'paid',
    channel: 'wechat',
    trade_no: trade.transaction_id,
    paid_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('order_no', order.order_no).eq('status', 'pending').select(
    'order_no, amount_cents, amount_text, status, trade_no, channel, created_at, paid_at',
  ).maybeSingle();
  return ensureOk(result, '更新查询到的微信赞助订单失败') || order;
}

/** Recent orders for one identity (openid or visitor), newest first. */
export async function listOrdersForIdentity(identity, limit = 20) {
  const supabase = await db();
  const idemColumn = identityColumn(identity.kind);
  const result = await supabase
    .from('sponsor_orders')
    .select('order_no, amount_cents, amount_text, status, channel, created_at, paid_at')
    .eq(idemColumn, identity.hash)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ensureOk(result, '查询赞助订单列表失败');
}

export function isStorageError(error) {
  return error instanceof PaymentStorageError;
}
