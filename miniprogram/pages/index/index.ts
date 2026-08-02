import { chooseImage, PickedImage } from '../../utils/image';
import { workbench } from '../../utils/store';

Page({
  data: {
    baseImagePath: '',
    characterName: '',
    provider: 'seedream',
    providers: [
      { id: 'seedream', label: 'Seedream（推荐）' },
      { id: 'gpt-image', label: 'gpt-image' },
    ],
  },

  onShow() {
    this.setData({
      baseImagePath: workbench.baseImagePath || '',
      characterName: workbench.characterName || '',
      provider: workbench.provider || 'seedream',
    });
  },

  onChooseImage() {
    chooseImage()
      .then((img: PickedImage) => {
        workbench.baseImagePath = img.path;
        this.setData({ baseImagePath: img.path });
      })
      .catch((err: Error) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  onNameInput(e: any) {
    this.setData({ characterName: e.detail.value });
  },

  onProviderChange(e: any) {
    this.setData({ provider: e.detail.value });
  },

  onGoGenerate() {
    if (!this.data.baseImagePath) {
      wx.showToast({ title: '请先上传角色立绘', icon: 'none' });
      return;
    }
    workbench.characterName = this.data.characterName.trim() || 'CHARACTER';
    workbench.provider = this.data.provider;
    wx.navigateTo({ url: '/pages/generate/generate' });
  },

  onGoSponsor() {
    wx.navigateTo({ url: '/pages/sponsor/sponsor' });
  },
});
