import { useCallback, useEffect, useState } from 'react';
import { createSponsorOrder, getSponsorOrder, submitAlipayForm, type SponsorOrder } from '../lib/paymentClient';
import { useUploadStore } from '../store/useUploadStore';
import { SectionHeader } from './SectionHeader';

const MIN_AMOUNT = 0.01;
const MAX_AMOUNT = 100000;
const POLL_LIMIT = 20;

function formatStatus(status: SponsorOrder['status']): string {
  if (status === 'paid') return '赞助已确认';
  if (status === 'closed') return '订单已关闭';
  if (status === 'refunded') return '订单已退款';
  return '等待支付宝确认';
}

export function PaymentPanel() {
  const palette = useUploadStore((s) => s.palette);
  const [amount, setAmount] = useState('5.00');
  const [order, setOrder] = useState<SponsorOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshOrder = useCallback(async (orderNo: string) => {
    const next = await getSponsorOrder(orderNo);
    setOrder(next);
    return next;
  }, []);

  useEffect(() => {
    const orderNo = order?.status === 'pending' ? order.orderNo : null;
    if (!orderNo) return;
    let cancelled = false;
    setNotice('支付结果仍在确认中…');
    (async () => {
      for (let attempt = 0; attempt < POLL_LIMIT && !cancelled; attempt += 1) {
        try {
          const next = await getSponsorOrder(orderNo);
          if (cancelled) return;
          setOrder(next);
          if (next.status !== 'pending') {
            setNotice(null);
            return;
          }
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : '无法查询赞助订单');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!cancelled) setNotice('支付结果仍在确认中，可稍后刷新状态。');
    })();
    return () => { cancelled = true; };
  }, [order?.orderNo]);

  function validateAmount(): string | null {
    const normalized = amount.trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return '请输入最多两位小数的金额';
    const value = Number(normalized);
    if (!Number.isFinite(value) || value < MIN_AMOUNT || value > MAX_AMOUNT) {
      return `金额需在 ¥${MIN_AMOUNT.toFixed(2)}–¥${MAX_AMOUNT.toFixed(2)} 之间`;
    }
    return null;
  }

  async function startPayment() {
    const validationError = validateAmount();
    if (validationError) {
      setError(validationError);
      return;
    }
    const paymentWindow = window.open('', '_blank');
    if (!paymentWindow) {
      setError('浏览器拦截了新标签页，请允许本站打开新窗口后重试');
      return;
    }
    paymentWindow.document.write('<!doctype html><html><head><meta charset="utf-8"><title>正在打开支付宝…</title></head><body></body></html>');
    paymentWindow.document.close();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await createSponsorOrder(amount.trim());
      setOrder(result.order);
      if (result.paymentHtml) submitAlipayForm(result.paymentHtml, paymentWindow);
      else {
        paymentWindow.close();
        setNotice('该订单已存在或正在处理中，请刷新状态。');
      }
    } catch (err) {
      paymentWindow.close();
      setError(err instanceof Error ? err.message : '无法创建赞助订单');
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const next = await refreshOrder(order.orderNo);
      setNotice(next.status === 'pending' ? '支付结果仍在确认中。' : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法查询赞助订单');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass p-6" style={{ borderColor: 'color-mix(in srgb, var(--zzz-primary) 32%, transparent)' }}>
      <SectionHeader title="支持影画工坊" />
      <p className="mb-4 font-mono text-xs leading-relaxed text-zzz-text/55">
        赞助用于维护模型额度与创作工具。PC 网页与手机浏览器均使用支付宝网页支付，不影响现有免费功能。
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 font-mono text-xs text-zzz-text/60">
          赞助金额（人民币）
          <div className="mt-1 flex items-center glass-input overflow-hidden px-3 py-2">
            <span className="mr-2 text-zzz-primary">¥</span>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              maxLength={9}
              aria-label="赞助金额"
              className="w-full bg-transparent font-mono text-sm text-zzz-text outline-none"
              placeholder="5.00"
            />
          </div>
        </label>
        <button
          type="button"
          onClick={startPayment}
          disabled={busy}
          className="glass-btn px-5 py-2.5 font-mono text-xs text-zzz-text transition-colors disabled:cursor-wait disabled:opacity-50"
          style={{ borderColor: 'color-mix(in srgb, var(--zzz-primary) 55%, transparent)', boxShadow: '0 0 18px color-mix(in srgb, var(--zzz-primary) 20%, transparent)' }}
        >
          {busy ? '处理中…' : '去赞助 →'}
        </button>
      </div>
      <p className="mt-2 font-mono text-[11px] text-zzz-text/40">金额范围 ¥0.01–¥100,000 · 当前主题色会随立绘自适应</p>

      {(notice || error || order) && (
        <div className="mt-4 border-t border-zzz-text/10 pt-4" aria-live="polite">
          {notice && <p className="font-mono text-xs text-zzz-primary">{notice}</p>}
          {error && <p className="font-mono text-xs text-zzz-magenta">{error}</p>}
          {order && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-zzz-text/55">
              <span>订单 {order.orderNo} · ¥{order.amount} · {formatStatus(order.status)}</span>
              {order.status === 'pending' && (
                <button type="button" onClick={refresh} disabled={busy} className="text-zzz-primary underline underline-offset-4 disabled:opacity-50">
                  刷新状态
                </button>
              )}
            </div>
          )}
          {order?.status === 'paid' && <p className="mt-2 font-mono text-xs text-zzz-primary">感谢你的支持，影画工坊会继续保持免费。</p>}
        </div>
      )}
      {palette && <span className="sr-only">赞助卡片已跟随当前立绘主题色</span>}
    </section>
  );
}
