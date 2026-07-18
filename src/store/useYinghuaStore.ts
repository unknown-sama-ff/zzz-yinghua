import { create } from 'zustand';
import type { YinghuaStyleId } from '../types';

interface YinghuaState {
  yinghuaPrompts: Record<YinghuaStyleId, string>;
  setYinghuaPrompt: (id: YinghuaStyleId, p: string) => void;
  yinghuaSlots: Record<YinghuaStyleId, GenSlotLike>;
  setYinghuaSlot: (id: YinghuaStyleId, patch: Partial<GenSlotLike>) => void;
  setSlotManual: (id: YinghuaStyleId, dataUrl: string) => void;

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
}));
