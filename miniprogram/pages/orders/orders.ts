import { listOrders, login, SponsorOrder } from '../../utils/api';

Page({
  data: {
    orders: [] as SponsorOrder[],
    loading: false,
  },

  onShow() {
    this.loadOrders();
  },

  async loadOrders() {
    this.setData({ loading: true });
    try {
      await login();
      const res = await listOrders();
      this.setData({ orders: res.orders });
    } catch (e: any) {
      wx.showToast({ title: e.message || '无法获取订单', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onPullDownRefresh() {
    this.loadOrders().finally(() => wx.stopPullDownRefresh());
  },
});
