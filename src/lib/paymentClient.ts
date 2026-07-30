import { API_BASE } from './apiBase';

export type SponsorOrderStatus = 'pending' | 'paid' | 'closed' | 'refunded';

export interface SponsorOrder {
  orderNo: string;
  amount: string;
  status: SponsorOrderStatus;
  createdAt: string;
  paidAt: string | null;
}

interface CreateOrderResponse {
  ok: boolean;
  order?: SponsorOrder;
  paymentHtml?: string | null;
  message?: string;
}

interface OrderResponse {
  ok: boolean;
  order?: SponsorOrder;
  message?: string;
}

function errorMessage(message: string | undefined, fallback: string): Error {
  return new Error(message || fallback);
}

function createIdempotencyKey(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createSponsorOrder(amount: string): Promise<{
  order: SponsorOrder;
  paymentHtml: string | null;
}> {
  const response = await fetch(`${API_BASE}/payments/orders`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, idempotencyKey: createIdempotencyKey() }),
  });
  const data = await response.json() as CreateOrderResponse;
  if (!response.ok || !data.ok || !data.order) {
    throw errorMessage(data.message, '无法创建赞助订单');
  }
  return { order: data.order, paymentHtml: data.paymentHtml ?? null };
}

export async function getSponsorOrder(orderNo: string): Promise<SponsorOrder> {
  const response = await fetch(`${API_BASE}/payments/orders/${encodeURIComponent(orderNo)}`, {
    credentials: 'include',
  });
  const data = await response.json() as OrderResponse;
  if (!response.ok || !data.ok || !data.order) {
    throw errorMessage(data.message, '无法查询赞助订单');
  }
  return data.order;
}

export function submitAlipayForm(paymentHtml: string, targetWindow: Window): void {
  const targetDocument = targetWindow.document;
  targetDocument.title = '正在打开支付宝…';
  const container = targetDocument.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.style.position = 'fixed';
  container.style.inset = '0';
  container.innerHTML = paymentHtml;
  targetDocument.body.appendChild(container);
  const form = container.querySelector('form');
  if (!form) {
    container.remove();
    throw new Error('支付宝支付表单无效');
  }
  form.submit();
}
