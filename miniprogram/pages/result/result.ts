import { workbench } from '../../utils/store';
import { saveGallery } from '../../utils/api';
import { fileToBase64 } from '../../utils/image';
import { createGalleryDeleteToken } from '../../utils/idempotency';
import { STORAGE_GALLERY_DELETE_TOKEN } from '../../utils/constants';
import { YINGHUA_STYLES } from '../../utils/prompts';

Page({
  data: {
    imagePath: '',
    styleLabel: '',
  },

  onShow() {
    this.setData({
      imagePath: workbench.lastResultPath || '',
      styleLabel: this.currentStyleLabel(),
    });
  },

  currentStyleLabel(): string {
    const id = workbench.lastStyleId;
    const style = YINGHUA_STYLES.find((s) => s.id === id);
    return style ? style.label : '';
  },

  onSaveAlbum() {
    const path = this.data.imagePath;
    if (!path) return;
    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: (err: any) => {
        if (err.errMsg && err.errMsg.indexOf('auth deny') >= 0) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中开启「保存到相册」权限',
            confirmText: '去设置',
            success: (r: any) => {
              if (r.confirm) wx.openSetting();
            },
          });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      },
    });
  },

  async onSaveGallery() {
    const path = this.data.imagePath;
    if (!path) return;
    wx.showLoading({ title: '保存中…' });
    try {
      const imageBase64 = await fileToBase64(path);
      let deleteToken = '';
      try {
        deleteToken = (wx.getStorageSync(STORAGE_GALLERY_DELETE_TOKEN) as string) || '';
      } catch { /* ignore */ }
      if (!deleteToken) {
        deleteToken = createGalleryDeleteToken();
        wx.setStorageSync(STORAGE_GALLERY_DELETE_TOKEN, deleteToken);
      }
      await saveGallery({
        imageBase64,
        mime: 'image/png',
        style: this.data.styleLabel || '影画',
        characterName: workbench.characterName || '',
        prompt: '影画工坊小程序生成',
        provider: workbench.provider || '',
        deleteToken,
      });
      wx.showToast({ title: '已保存到画廊', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '保存失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onGoSponsor() {
    wx.navigateTo({ url: '/pages/sponsor/sponsor' });
  },

  onBackToGenerate() {
    wx.navigateBack();
  },
});
