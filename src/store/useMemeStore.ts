import { create } from 'zustand';
import type { GenRequest } from '../types';
import { generate, ApiError } from '../lib/apiClient';
import { buildMemeRequest, createMemeDraft, snapshotMemeDraft, type MemeDraft, type MemeGenerationOptions, type MemeTileDraft } from '../lib/meme';
import { composeMemeSheet, defaultMemeCuts, readMemeImage, splitMemeSheet, validateMemeCuts, type MemeCuts, type MemeImage } from '../lib/memeImages';
import { maxInputImagesForModel, supportsGptImageTransparency } from '../lib/gptImageCapabilities';
import { gptImageQualityForRequest, useProviderStore } from './useProviderStore';

export interface MemeResult {
  id: string;
  snapshot: MemeDraft;
  original: MemeImage;
  composite: MemeImage;
  tiles: MemeImage[];
  cuts: MemeCuts;
  revised: number[];
  version: number;
  tileVersions: number[];
  prompt: string;
}
interface MemeAttempt { snapshot: MemeDraft; request: GenRequest; tileIndex?: number; resultId?: string }
interface MemeState {
  draft: MemeDraft;
  result: MemeResult | null;
  busy: boolean;
  uploads: number;
  busyTile: number | null;
  phase: string;
  error: string;
  warning: string;
  rawOutput: string | null;
  uncertain: MemeAttempt | null;
  pendingOutput: { url: string; attempt: MemeAttempt } | null;
  patchDraft: (patch: Partial<MemeDraft>) => void;
  patchTile: (index: number, patch: Partial<MemeTileDraft>) => void;
  generateSet: () => Promise<void>;
  redoTile: (index: number) => Promise<void>;
  recheck: () => Promise<void>;
  retryProcessing: () => Promise<void>;
  dismissUncertain: () => void;
  dismissProcessing: () => void;
  recut: (cuts: MemeCuts) => Promise<void>;
  clearError: () => void;
  trackUpload: (delta: 1 | -1) => void;
}

export function memeGenerationOptions(): MemeGenerationOptions {
  const settings = useProviderStore.getState();
  const creds = settings.creds['gpt-image'];
  if (settings.freeloadEnabled && settings.presetQualityStatus !== 'ready') {
    throw new Error('尚未读取免费通道的透明与多图能力，请稍后重试，或重新读取通道能力。');
  }
  return { provider: settings.provider, useServerPreset: settings.freeloadEnabled,
    ...creds, quality: gptImageQualityForRequest(settings), denoiseEnabled: settings.denoiseEnabled,
    maxInputImages: settings.freeloadEnabled ? settings.presetMaxInputImages ?? 1 : maxInputImagesForModel('gpt-image', creds.model),
    transparencySupported: settings.freeloadEnabled ? settings.presetTransparencySupported === true : supportsGptImageTransparency(creds.model) };
}

const message = (error: unknown) => error instanceof Error ? error.message : '处理失败，请重试。';

export const useMemeStore = create<MemeState>((set, get) => {
  const processOutput = async (url: string, attempt: MemeAttempt) => {
    set({ phase: '正在检查透明背景并拆图…', rawOutput: url });
    try {
      const image = await readMemeImage(url);
      if (attempt.tileIndex !== undefined) {
        const previous = get().result;
        if (!previous || previous.id !== attempt.resultId) throw new Error('这套结果已经变更，无法替换单张。原始生成结果仍可下载。');
        if (!image.hasTransparency) {
          set({ warning: '本次单张没有有效透明背景，已保留原来的单张。可查看或下载本次原始结果；不会自动再次生成。', pendingOutput: null });
          return;
        }
        const tiles = previous.tiles.map((tile, index) => index === attempt.tileIndex ? image : tile);
        const composite = await composeMemeSheet(tiles, previous.cuts);
        set({ result: { ...previous, snapshot: attempt.snapshot, tiles, composite, version: previous.version + 1,
          tileVersions: previous.tileVersions.map((version, index) => index === attempt.tileIndex ? version + 1 : version),
          revised: [...new Set([...previous.revised, attempt.tileIndex])],
          prompt: `${previous.prompt}\n\n【第${attempt.tileIndex + 1}格更新，以此为准】${attempt.snapshot.tiles[attempt.tileIndex].expression}；文案：${JSON.stringify(attempt.snapshot.tiles[attempt.tileIndex].caption)}` },
          warning: composite.hasTransparency ? '' : '部分单张没有透明背景，请检查后再导出。', pendingOutput: null });
      } else {
        const cuts = defaultMemeCuts(image.width, image.height, attempt.snapshot.count === 9 ? 3 : 5, 3);
        const tiles = await splitMemeSheet(image, cuts);
        set({ result: { id: crypto.randomUUID(), snapshot: attempt.snapshot, original: image, composite: image,
          tiles, cuts, revised: [], version: 0, tileVersions: tiles.map(() => 0), prompt: attempt.request.prompt }, pendingOutput: null,
          warning: image.hasTransparency ? '' : '上游返回了不透明图片。已保留原图和拆图，但尚未获得透明表情包；请确认当前接口支持透明 PNG。不会自动再次生成。' });
      }
    } catch (error) {
      set({ pendingOutput: { url, attempt }, error: `图片已经生成，但本地处理未完成：${message(error)} 可重试图片处理，不会重新生图。` });
    }
  };

  const run = async (attempt: MemeAttempt) => {
    if (get().busy) return;
    set({ busy: true, busyTile: attempt.tileIndex ?? null, phase: attempt.tileIndex === undefined ? '正在生成整套表情包…' : `正在重做第${attempt.tileIndex + 1}张…`, error: '', warning: '', uncertain: null, pendingOutput: null, rawOutput: null });
    try {
      const images = await generate(attempt.request);
      if (!images[0]) throw new ApiError('UNKNOWN', '接口未返回可用图片，生成结果暂时无法确认。');
      await processOutput(images[0], attempt);
    } catch (error) {
      const uncertain = error instanceof ApiError && (error.code === 'UPSTREAM_TIMEOUT' || error.code === 'UNKNOWN' || error.status === 200);
      set({ error: message(error), uncertain: uncertain ? attempt : null });
    } finally { set({ busy: false, busyTile: null, phase: '' }); }
  };

  return {
    draft: createMemeDraft(), result: null, busy: false, uploads: 0, busyTile: null, phase: '', error: '', warning: '', rawOutput: null, uncertain: null, pendingOutput: null,
    patchDraft: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
    patchTile: (index, patch) => set((state) => ({ draft: { ...state.draft,
      tiles: state.draft.tiles.map((tile, i) => i === index ? { ...tile, ...patch } : tile) } })),
    clearError: () => set({ error: '' }),
    trackUpload: (delta) => set((state) => ({ uploads: Math.max(0, state.uploads + delta) })),
    generateSet: async () => {
      if (get().busy || get().uploads || get().uncertain || get().pendingOutput) return;
      try {
        const snapshot = snapshotMemeDraft(get().draft);
        const request = buildMemeRequest(snapshot, memeGenerationOptions());
        await run({ snapshot, request });
      } catch (error) { set({ error: message(error) }); }
    },
    redoTile: async (index) => {
      const state = get();
      if (state.busy || state.uploads || state.uncertain || state.pendingOutput || !state.result) return;
      try {
        const previous = state.result.tiles[index];
        if (!previous) throw new Error('没有找到要重做的表情。');
        const snapshot = snapshotMemeDraft(state.result.snapshot);
        // Keep this set's identity/style; use the visible cell's edited action and caption.
        snapshot.tiles[index] = { ...state.draft.tiles[index] };
        const request = buildMemeRequest(snapshot, memeGenerationOptions(), { index, previousDataUrl: previous.dataUrl });
        await run({ snapshot, request, tileIndex: index, resultId: state.result.id });
      } catch (error) { set({ error: message(error) }); }
    },
    recheck: async () => { const attempt = get().uncertain; if (attempt) await run(attempt); },
    dismissUncertain: () => { if (!get().busy) set({ uncertain: null, error: '已放弃等待原请求。再次生成属于新请求，可能再次消耗额度。' }); },
    dismissProcessing: () => { if (!get().busy) set({ pendingOutput: null, error: '' }); },
    retryProcessing: async () => {
      const pending = get().pendingOutput;
      if (!pending || get().busy) return;
      set({ busy: true, error: '' });
      try { await processOutput(pending.url, pending.attempt); }
      finally { set({ busy: false, busyTile: null, phase: '' }); }
    },
    recut: async (cuts) => {
      const previous = get().result;
      if (!previous || get().busy || get().uncertain || get().pendingOutput) return;
      set({ busy: true, phase: '正在重新拆图…', error: '' });
      try {
        validateMemeCuts(cuts, previous.original.width, previous.original.height);
        if (cuts.x.length !== previous.cuts.x.length || cuts.y.length !== previous.cuts.y.length) throw new Error('切线数量必须与原网格一致。');
        const originalTiles = await splitMemeSheet(previous.original, cuts);
        const tiles = originalTiles.map((tile, index) => previous.revised.includes(index) ? previous.tiles[index] : tile);
        const composite = await composeMemeSheet(tiles, cuts);
        set({ result: { ...previous, cuts: { x: [...cuts.x], y: [...cuts.y] }, tiles, composite, version: previous.version + 1,
          tileVersions: previous.tileVersions.map((version, index) => previous.revised.includes(index) ? version : version + 1) } });
      } catch (error) { set({ error: message(error) }); }
      finally { set({ busy: false, phase: '' }); }
    },
  };
});
