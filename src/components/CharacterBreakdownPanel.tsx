import { useMemo } from 'react';
import { useUploadStore } from '../store/useUploadStore';
import { useWorkbenchStore } from '../store/useWorkbenchStore';
import { useCharacterSheetStore } from '../store/useCharacterSheetStore';
import { useIdentityStore } from '../store/useIdentityStore';
import { useProviderStore } from '../store/useProviderStore';
import { useToast } from '../store/useToast';
import { generate } from '../lib/apiClient';
import { buildNamedCharacterPrompt } from '../lib/characterBreakdown';
import { refreshUploadPalette } from '../lib/uploadTheme';
import { YINGHUA_SIZE } from '../lib/prompts';
import { useBuildRequest } from './useBuildRequest';
import { SectionHeader } from './SectionHeader';
import { CharacterBreakdownReference } from './CharacterBreakdownReference';

export function CharacterBreakdownPanel() {
  const source = useUploadStore((state) => state.uploadedImage);
  const threeViews = useWorkbenchStore((state) => state.threeViewSlot.images);
  const history = useWorkbenchStore((state) => state.costumeChangeHistory);
  const names = useCharacterSheetStore((state) => state.namesBySource);
  const sheet = useCharacterSheetStore((state) => source ? state.sheets[source] : undefined);
  const template = useCharacterSheetStore((state) => state.promptTemplate);
  const name = useIdentityStore((state) => state.characterName);
  const provider = useProviderStore((state) => state.provider);
  const buildRequest = useBuildRequest();
  const sources = useMemo(() => [...new Set([source, ...threeViews, ...history].filter((url): url is string => Boolean(url)))], [source, threeViews, history]);
  const loading = sheet?.slot.status === 'loading';
  const run = async () => {
    if (!source || loading || useCharacterSheetStore.getState().sheets[source]?.uploading) return;
    if (!name.trim()) { useToast.getState().show('请先填写角色名字'); return; }
    const prompt = buildNamedCharacterPrompt(template, name);
    const store = useCharacterSheetStore.getState();
    store.setSlot(source, { status: 'loading', error: undefined });
    store.registerSources([source], name);
    try {
      const images = await generate(buildRequest(prompt, {
        imageOverride: source,
        size: provider === 'seedream' ? '2848x1600' : YINGHUA_SIZE,
      }));
      if (!images.length) throw new Error('未返回角色拆解图，请重试');
      store.addImages(source, images.map((url) => ({ url, characterName: name.trim(), prompt, provider })));
      store.setSlot(source, { status: 'done', images });
    } catch (error) {
      const message = error instanceof Error ? error.message : '拆解图生成失败';
      store.setSlot(source, { status: 'error', error: message });
      useToast.getState().show(message);
    }
  };
  return <section className="glass p-6 character-breakdown-panel" aria-label="角色拆解图工作台">
    <SectionHeader title="角色拆解图" />
    <p className="character-breakdown-hint">先选择三视图，再生成带中文注释的角色概念分解图。每张三视图分别保存自己的拆解图，切换角色时自动配对。</p>
    <div className="character-breakdown-grid">
      <div>
        <label className="character-breakdown-source-label">选中的角色三视图
          <select className="glass-input" aria-label="拆解图对应的三视图" value={source ? String(sources.indexOf(source)) : ''}
            onChange={(event) => {
              const selected = sources[Number(event.target.value)];
              if (!selected) return;
              useUploadStore.getState().setUpload(selected, 'three-view.png');
              void refreshUploadPalette(selected);
            }}>
            {!source && <option value="">请选择三视图</option>}
            {sources.map((url, index) => <option key={url} value={index}>{names[url] || '角色三视图'} · {index + 1}{url === source ? '（当前主图）' : ''}</option>)}
          </select>
        </label>
        {source && <img className="character-breakdown-source" src={source} alt="拆解图使用的角色三视图" data-no-inpaint />}
      </div>
      <div>
        <details><summary>编辑拆解图提示词</summary><textarea className="glass-input" aria-label="角色拆解图提示词" value={template} rows={12}
          onChange={(event) => useCharacterSheetStore.getState().setPromptTemplate(event.target.value)} /></details>
        <p className="character-breakdown-hint">{name.trim() ? `生成时自动加入角色名字：${name.trim()}` : '请先在上方填写角色名字。'} 中文注释，白色背景。</p>
        <button type="button" className="glass-btn character-breakdown-generate" disabled={!source || !name.trim() || loading || sheet?.uploading || !template.trim()} onClick={() => void run()}>
          {loading ? '生成角色拆解图中…' : '生成角色拆解图'}
        </button>
        {sheet?.slot.error && <p role="alert" className="text-zzz-magenta">{sheet.slot.error}</p>}
      </div>
    </div>
    <CharacterBreakdownReference />
  </section>;
}
