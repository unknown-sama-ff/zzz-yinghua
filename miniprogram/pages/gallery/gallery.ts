import { listGallery, proxyImageToFile, GalleryRow } from '../../utils/api';

interface DisplayRow extends GalleryRow {
  localPath: string;
  loading: boolean;
}

Page({
  data: {
    rows: [] as DisplayRow[],
    loading: false,
  },

  onShow() {
    this.loadGallery();
  },

  onPullDownRefresh() {
    this.loadGallery().finally(() => wx.stopPullDownRefresh());
  },

  async loadGallery() {
    this.setData({ loading: true });
    try {
      const res = await listGallery();
      const rows: DisplayRow[] = res.rows.map((r) => ({ ...r, localPath: '', loading: true }));
      this.setData({ rows });
      // Download each image through the SSRF-guarded proxy, 4 at a time.
      for (let i = 0; i < rows.length; i += 4) {
        await Promise.all(
          rows.slice(i, i + 4).map((row) => this.loadRowImage(row.id, row.image_url)),
        );
      }
    } catch (e: any) {
      wx.showToast({ title: e.message || '无法获取画廊', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadRowImage(id: number, imageUrl: string) {
    try {
      const path = await proxyImageToFile(imageUrl);
      this.updateRow(id, { localPath: path, loading: false });
    } catch {
      this.updateRow(id, { loading: false });
    }
  },

  updateRow(id: number, patch: Partial<DisplayRow>) {
    const rows = this.data.rows.map((r: any) => (r.id === id ? { ...r, ...patch } : r));
    this.setData({ rows });
  },

  onPreview(e: any) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.previewImage({ urls: [url], current: url });
  },
});
