import { create } from 'zustand';
import type { YinghuaStyleId } from '../types';

type ActiveGeneration = {
  id: YinghuaStyleId;
  idempotencyKey: string;
};

interface YinghuaState {
  yinghuaPrompts: Record<YinghuaStyleId, string>;
  setYinghuaPrompt: (id: YinghuaStyleId, p: string) => void;
  yinghuaSlots: Record<YinghuaStyleId, GenSlotLike>;
  setYinghuaSlot: (id: YinghuaStyleId, patch: Partial<GenSlotLike>) => void;
  setSlotManual: (id: YinghuaStyleId, dataUrl: string) => void;
  activeGeneration: ActiveGeneration | null;
  beginYinghuaGeneration: (id: YinghuaStyleId) => ActiveGeneration | null;
  endYinghuaGeneration: (idempotencyKey: string) => void;

  yinghuaShowText: boolean;
  setYinghuaShowText: (show: boolean) => void;
  yinghuaLang: 'zh' | 'en';
  setYinghuaLang: (lang: 'zh' | 'en') => void;
  yinghuaCharacterDynamic: string;
  setYinghuaCharacterDynamic: (v: string) => void;
  yinghuaMicroDynamic: string;
  setYinghuaMicroDynamic: (v: string) => void;
  yinghuaCharacterTraits: string;
  setYinghuaCharacterTraits: (t: string) => void;
  yinghuaAddonImage: string | null;
  setYinghuaAddonImage: (dataUrl: string | null) => void;
  style3Face: 'front' | 'back';
  setStyle3Face: (face: 'front' | 'back') => void;
}

interface GenSlotLike {
  status: 'idle' | 'loading' | 'done' | 'error';
  images: string[];
  error?: string;
}

export const useYinghuaStore = create<YinghuaState>((set) => ({
  yinghuaPrompts: { 1: '', 2: '', 3: '' },
  setYinghuaPrompt: (id, p) =>
    set((s) => ({ yinghuaPrompts: { ...s.yinghuaPrompts, [id]: p } })),
  yinghuaSlots: { 1: { status: 'idle', images: [] }, 2: { status: 'idle', images: [] }, 3: { status: 'idle', images: [] } },
  setYinghuaSlot: (id, patch) =>
    set((s) => ({
      yinghuaSlots: { ...s.yinghuaSlots, [id]: { ...s.yinghuaSlots[id], ...patch } },
    })),
  setSlotManual: (id, dataUrl) =>
    set((s) => ({
      yinghuaSlots: { ...s.yinghuaSlots, [id]: { status: 'done', images: [dataUrl] } },
    })),
  activeGeneration: null,
  beginYinghuaGeneration: (id) => {
    let generation: ActiveGeneration | null = null;
    set((s) => {
      if (s.activeGeneration) return s;
      generation = { id, idempotencyKey: crypto.randomUUID() };
      return {
        activeGeneration: generation,
        yinghuaSlots: {
          ...s.yinghuaSlots,
          [id]: { ...s.yinghuaSlots[id], status: 'loading', error: undefined },
        },
      };
    });
    return generation;
  },
  endYinghuaGeneration: (idempotencyKey) =>
    set((s) => (
      s.activeGeneration?.idempotencyKey === idempotencyKey
        ? { activeGeneration: null }
        : s
    )),

  yinghuaShowText: true,
  setYinghuaShowText: (show) => set({ yinghuaShowText: show }),

  yinghuaLang: 'zh',
  setYinghuaLang: (lang) => set({ yinghuaLang: lang }),

  yinghuaCharacterDynamic: '低重心姿态（侧躺/蜷缩/趴卧/瘫坐/倚靠），身体大面积接触支撑面',
  setYinghuaCharacterDynamic: (v) => set({ yinghuaCharacterDynamic: v }),

  yinghuaMicroDynamic: '微动态细节（打哈欠/wink/半睁眼/比耶/拉领带/抱玩偶）',
  setYinghuaMicroDynamic: (v) => set({ yinghuaMicroDynamic: v }),

  yinghuaCharacterTraits: '',
  setYinghuaCharacterTraits: (t) => set({ yinghuaCharacterTraits: t }),

  yinghuaAddonImage: null,
  setYinghuaAddonImage: (dataUrl) => set({ yinghuaAddonImage: dataUrl }),

  style3Face: 'front' as 'front' | 'back',
  setStyle3Face: (face: 'front' | 'back') => set({ style3Face: face }),
}));
