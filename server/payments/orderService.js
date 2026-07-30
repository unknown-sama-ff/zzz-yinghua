import crypto from 'node:crypto';
import { formatAmountCents, amountText, isPaidTrade, sellerMatches } from './alipay.js';

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

function createOrderNo() {
  return `YH${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(7).toString('hex').toUpperCase()}`;
}

export async function createOrder({ amountCents, visitorTokenHash, idempotencyKey }) {
  const supabase = await db();
  const existingResult = await supabase
    .from('sponsor_orders')
    .select('order_no, amount_cents, amount_text, status, created_at, paid_at')
    .eq('visitor_token_hash', visitorTokenHash)
    .eq('client_idempotency_key', idempotencyKey)
    .maybeSingle();
  const existing = ensureOk(existingResult, '查询幂等订单失败');
  if (existing) return { order: existing, reused: true };

  const order = {
    order_no: createOrderNo(),
    amount_cents: amountCents,
    amount_text: formatAmountCents(amountCents),
    status: 'pending',
    visitor_token_hash: visitorTokenHash,
    client_idempotency_key: idempotencyKey,
  };
  const result = await supabase.from('sponsor_orders').insert(order).select(
    'order_no, amount_cents, amount_text, status, created_at, paid_at',
  ).single();
  if (result.error?.code === '23505') {
    const retry = await supabase
      .from('sponsor_orders')
      .select('order_no, amount_cents, amount_text, status, created_at, paid_at')
      .eq('visitor_token_hash', visitorTokenHash)
      .eq('client_idempotency_key', idempotencyKey)
      .single();
    return { order: ensureOk(retry, '读取并发创建的订单失败'), reused: true };
  }
  return { order: ensureOk(result, '创建赞助订单失败'), reused: false };
}

export function visitorTokenHash(token) {
  return hashToken(token);
}

export async function findOrderForVisitor(orderNo, token) {
  const supabase = await db();
  const result = await supabase
    .from('sponsor_orders')
    .select('order_no, amount_cents, amount_text, status, trade_no, created_at, paid_at')
    .eq('order_no', orderNo)
    .eq('visitor_token_hash', hashToken(token))
    .maybeSingle();
  return ensureOk(result, '查询赞助订单失败');
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

  const updateResult = await supabase
    .from('sponsor_orders')
    .update({
      status: 'paid',
      trade_no: params.trade_no,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('order_no', params.out_trade_no)
    .in('status', ['pending', 'paid'])
    .select('order_no, amount_cents, amount_text, status, trade_no, created_at, paid_at')
    .single();
  const updatedOrder = ensureOk(updateResult, '更新赞助订单失败');

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

export function isStorageError(error) {
  return error instanceof PaymentStorageError;
}
