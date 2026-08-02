import { chooseImage, fileToBase64 } from '../../utils/image';
import {
  compositeStitch,
  compositeEmbed,
  generateAsync,
  downloadTaskImage,
  dataUrlToFile,
} from '../../utils/api';
import { pollTask } from '../../utils/request';
import { createIdempotencyKey } from '../../utils/idempotency';
import { workbench } from '../../utils/store';
import { YINGHUA_STYLES, fillName, THREE_VIEW_PROMPT } from '../../utils/prompts';

Page({
  data: {
    frontPath: '',
    sidePath: '',
    backPath: '',
    threeViewPath: '',
    threeViewStatus: 'idle',
    styles: YINGHUA_STYLES.map((s) => ({
      id: s.id,
      label: s.label,
      description: s.description,
      status: 'idle',
      imagePath: '',
      error: '',
    })),
    generating: false,
    lastResultPath: '',
  },

  onShow() {
    this.setData({
      frontPath: '',
      sidePath: '',
      backPath: '',
      threeViewPath: workbench.threeViewPath || '',
      threeViewStatus: workbench.threeViewPath ? 'done' : 'idle',
      lastResultPath: workbench.lastResultPath || '',
    });
    // Restore any previously generated styles.
    const styles = this.data.styles.map((s: any) => {
      const gen = workbench.generations[s.id];
      return gen
        ? { ...s, status: gen.status, imagePath: gen.imagePath || '', error: gen.error || '' }
        : s;
    });
    this.setData({ styles });
  },

  onPickFront() { this.pickSlot('frontPath'); },
  onPickSide() { this.pickSlot('sidePath'); },
  onPickBack() { this.pickSlot('backPath'); },

  pickSlot(key: string) {
    chooseImage()
      .then((img) => this.setData({ [key]: img.path }))
      .catch((err: Error) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  async onGenerateThreeView() {
    const views = [this.data.frontPath, this.data.sidePath, this.data.backPath].filter(Boolean);
    if (views.length === 0) {
      wx.showToast({ title: '至少上传一张视图', icon: 'none' });
      return;
    }
    if (this.data.threeViewStatus === 'running') return;
    this.setData({ threeViewStatus: 'running', threeViewPath: '' });
    try {
      const dataUrls: string[] = [];
      for (const p of views) dataUrls.push(await fileToBase64(p));
      const stitched = await compositeStitch(dataUrls);
      const stitchedFile = await dataUrlToFile(stitched);
      const task = await generateAsync({
        filePath: stitchedFile,
        prompt: THREE_VIEW_PROMPT,
        provider: workbench.provider,
        idempotencyKey: createIdempotencyKey(),
      });
      const count = await pollTask(task.taskId);
      if (count === 0) throw new Error('上游未返回图片');
      const imagePath = await downloadTaskImage(task.taskId, 0);
      workbench.threeViewPath = imagePath;
      this.setData({ threeViewPath: imagePath, threeViewStatus: 'done' });
      wx.showToast({ title: '三视图生成完成', icon: 'success' });
    } catch (err) {
      this.setData({ threeViewStatus: 'error' });
      wx.showToast({ title: (err as Error).message || '三视图生成失败', icon: 'none' });
    }
  },

  async onGenerateStyle(e: any) {
    const styleId = Number(e.currentTarget.dataset.id);
    if (this.data.generating) return;
    const current = this.data.styles.find((s: any) => s.id === styleId);
    if (current && current.status === 'running') return;
    if (styleId > 1) {
      const prev = this.data.styles.find((s: any) => s.id === styleId - 1);
      if (!prev || prev.status !== 'done') {
        wx.showToast({ title: `请先完成「${prev ? prev.label : '上一风格'}」`, icon: 'none' });
        return;
      }
    }
    this.setData({ generating: true });
    this.setStyle(styleId, 'running', '');
    try {
      const baseFile = await this.buildBase(styleId);
      const style = YINGHUA_STYLES.find((s) => s.id === styleId)!;
      const prompt = fillName(style.promptTemplate, workbench.characterName, undefined, true, '', '', '', 'zh', styleId);
      const task = await generateAsync({
        filePath: baseFile,
        prompt,
        provider: workbench.provider,
        idempotencyKey: createIdempotencyKey(),
      });
      const count = await pollTask(task.taskId);
      if (count === 0) throw new Error('上游未返回图片');
      const imagePath = await downloadTaskImage(task.taskId, 0);
      workbench.generations[styleId] = { status: 'done', imagePath };
      workbench.lastResultPath = imagePath;
      workbench.lastStyleId = styleId;
      this.setStyle(styleId, 'done', imagePath);
      this.setData({ lastResultPath: imagePath });
    } catch (err) {
      this.setStyle(styleId, 'error', '', (err as Error).message || '生成失败');
      wx.showToast({ title: (err as Error).message || '生成失败', icon: 'none' });
    } finally {
      this.setData({ generating: false });
    }
  },

  // Build the base image to upload for a style.
  // 零命: 直接以上传立绘为底图；三命/六命: 前一风格成图 + 右下角嵌三视图。
  async buildBase(styleId: number): Promise<string> {
    if (styleId === 1) {
      if (!workbench.baseImagePath) throw new Error('缺少角色立绘');
      return workbench.baseImagePath;
    }
    const prev = workbench.generations[styleId - 1];
    const basePath = prev?.imagePath;
    if (!basePath) throw new Error('缺少前一风格底图');
    if (!workbench.threeViewPath) return basePath;
    const base64 = await fileToBase64(basePath);
    const thumb64 = await fileToBase64(workbench.threeViewPath);
    const composite = await compositeEmbed(base64, [
      { url: thumb64, size: 0.2, position: 'bottom-right' },
    ]);
    return dataUrlToFile(composite);
  },

  setStyle(styleId: number, status: string, imagePath: string, error = '') {
    const styles = this.data.styles.map((s: any) =>
      s.id === styleId ? { ...s, status, imagePath, error } : s,
    );
    this.setData({ styles });
  },

  onViewResult() {
    if (!workbench.lastResultPath) {
      wx.showToast({ title: '请先生成一张影画', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/result/result' });
  },
});
