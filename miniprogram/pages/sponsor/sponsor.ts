import { wechatLogin, createWechatOrder, getOrder, PaymentParams } from '../../utils/api';
import { createIdempotencyKey } from '../../utils/idempotency';
import { STORAGE_OPENID, MIN_AMOUNT, MAX_AMOUNT } from '../../utils/constants';

Page({
  data: {
    amount: '5.00',
    minAmount: MIN_AMOUNT,
    maxAmount: MAX_AMOUNT,
    orderNo: '',
    statusText: '',
    busy: false,
  },

  onAmountInput(e: any) {
    this.setData({ amount: e.detail.value });
  },

  onPay() {
    const err = this.validateAmount();
    if (err) {
      wx.showToast({ title: err, icon: 'none' });
      return;
    }
    if (this.data.busy) return;
    this.setData({ busy: true });
    this.runPay().catch((e: Error) => {
      wx.showToast({ title: e.message || '支付失败', icon: 'none' });
    }).finally(() => {
      this.setData({ busy: false });
    });
  },

  async runPay(): Promise<void> {
    const openid = await this.ensureOpenid();
    const res = await createWechatOrder(this.data.amount.trim(), createIdempotencyKey(), openid);
    if (!res.payment) {
      wx.showToast({ title: '订单已存在，请稍后刷新状态', icon: 'none' });
      this.setData({ orderNo: res.order.orderNo, statusText: '' });
      return;
    }
    this.setData({ orderNo: res.order.orderNo, statusText: '等待支付…' });
    await requestPayment(res.payment);
    // 支付拉起成功 → 轮询订单状态直到 paid。
    this.setData({ statusText: '支付完成，确认中…' });
    this.pollPaid(res.order.orderNo);
  },

  validateAmount(): string | null {
    const text = this.data.amount.trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return '请输入最多两位小数的金额';
    const value = Number(text);
    const min = Number(MIN_AMOUNT);
    const max = Number(MAX_AMOUNT);
    if (!Number.isFinite(value) || value < min || value > max) {
      return `金额需在 ¥${MIN_AMOUNT}–${MAX_AMOUNT} 之间`;
    }
    return null;
  },

  async ensureOpenid(): Promise<string> {
    let openid = '';
    try {
      openid = (wx.getStorageSync(STORAGE_OPENID) as string) || '';
    } catch { /* ignore */ }
    if (openid) return openid;
    const code = await wxLoginPromise();
    const res = await wechatLogin(code);
    wx.setStorageSync(STORAGE_OPENID, res.openid);
    return res.openid;
  },

  async pollPaid(orderNo: string): Promise<void> {
    for (let i = 0; i < 10; i++) {
      await sleep(2000);
      try {
        const res = await getOrder(orderNo);
        if (res.order.status === 'paid') {
          this.setData({ statusText: '赞助已确认，感谢支持！' });
          return;
        }
      } catch { /* retry */ }
    }
    this.setData({ statusText: '支付结果仍在确认中，可稍后到订单页刷新' });
  },
});

function wxLoginPromise(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (r: any) => (r.code ? resolve(r.code) : reject(new Error('微信登录失败'))),
      fail: () => reject(new Error('微信登录失败')),
    });
  });
}

function requestPayment(p: PaymentParams): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.requestPayment({
      timeStamp: p.timeStamp,
      nonceStr: p.nonceStr,
      package: p.package,
      signType: p.signType,
      paySign: p.paySign,
      success: () => resolve(),
      fail: (err: any) => {
        if (err && err.errMsg === 'requestPayment:fail cancel') reject(new Error('已取消支付'));
        else reject(new Error('支付未完成'));
      },
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
