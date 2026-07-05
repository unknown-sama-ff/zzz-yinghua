import { create } from 'zustand';
import type {
  GenSlot,
  LayerPart,
  NamePlacement,
  Palette,
  ProviderName,
  YinghuaStyleId,
} from '../types';
import { THREE_VIEW_PROMPT, COSTUME_CHANGE_PROMPT } from '../lib/prompts';
import type { ClipRegions } from '../lib/clipRegions';
import type { FaceBounds } from '../lib/detectFace';

const emptySlot = (): GenSlot => ({ status: 'idle', images: [] });

/**
 * The six viewer parts. Stage 1 (buttons 01-03) reveals the three diagonal
 * regions of the 三命 image (styleId 2); stage 2 (04-06) reveals the regions of
 * the 六命 image (styleId 3). Start hidden so the viewer opens on the 零命 base.
 */
const initialParts = (): LayerPart[] =>
  Array.from({ length: 6 }, (_, i) => ({
    code: String(i + 1).padStart(2, '0'),
    stage: (i < 3 ? 1 : 2) as 1 | 2,
    styleId: (i < 3 ? 2 : 3) as 2 | 3,
    region: (i % 3) as 0 | 1 | 2,
    visible: false,
  }));

export interface CustomProviderConfig {
  endpoint: string;
  headers: string; // raw "Key: Value" lines, parsed before send
  bodyTemplate: string;
}

interface WorkshopState {
  // --- Upload ---
  uploadedImage: string | null; // data URL
  uploadedName: string | null;
  palette: Palette | null;
  setUpload: (dataUrl: string, fileName: string) => void;
  setPalette: (p: Palette | null) => void;
  clearUpload: () => void;

  // --- Character identity ---
  characterName: string;
  setCharacterName: (name: string) => void;

  // --- Provider ---
  provider: ProviderName;
  setProvider: (p: ProviderName) => void;
  freeloadEnabled: boolean;
  setFreeloadEnabled: (enabled: boolean) => void;
  custom: CustomProviderConfig;
  setCustom: (patch: Partial<CustomProviderConfig>) => void;
  // Per-provider credentials, kept in memory only (never persisted to disk).
  creds: Record<'seedance' | 'gpt-image', { apiKey: string; baseUrl: string; model: string }>;
  setCred: (
    provider: 'seedance' | 'gpt-image',
    patch: Partial<{ apiKey: string; baseUrl: string; model: string }>,
  ) => void;

  // --- Three-view step ---
  threeViewUploads: { front: string | null; side: string | null; back: string | null };
  setThreeViewUpload: (view: 'front' | 'side' | 'back', dataUrl: string | null) => void;
  threeViewPrompt: string;
  setThreeViewPrompt: (p: string) => void;
  threeViewSlot: GenSlot;
  setThreeViewSlot: (patch: Partial<GenSlot>) => void;

  // --- Yinghua action step (3 styles) ---
  yinghuaPrompts: Record<YinghuaStyleId, string>;
  setYinghuaPrompt: (id: YinghuaStyleId, p: string) => void;
  yinghuaSlots: Record<YinghuaStyleId, GenSlot>;
  setYinghuaSlot: (id: YinghuaStyleId, patch: Partial<GenSlot>) => void;
  setSlotManual: (id: YinghuaStyleId, dataUrl: string) => void;

  // --- Costume change three-view ---
  costumeChangePrompt: string;
  setCostumeChangePrompt: (p: string) => void;
  costumeChangeSlot: GenSlot;
  setCostumeChangeSlot: (patch: Partial<GenSlot>) => void;
  costumeChangeHistory: string[];
  addCostumeChangeImages: (urls: string[]) => void;
  clearCostumeChangeHistory: () => void;
  costumeChangeRefImage: string | null;
  setCostumeChangeRefImage: (dataUrl: string | null) => void;

  // --- Poster (module 06) ---
  posterSlot: GenSlot;
  setPosterSlot: (patch: Partial<GenSlot>) => void;

  // --- Vision model credentials (in-memory only) ---
  visionCred: { apiKey: string; baseUrl: string; model: string };
  setVisionCred: (patch: Partial<{ apiKey: string; baseUrl: string; model: string }>) => void;

  // --- Viewer ---
  parts: LayerPart[];
  togglePart: (code: string) => void;
  setAllParts: (visible: boolean) => void;
  setStageVisible: (stage: 1 | 2, visible: boolean) => void;
  viewerClipRegions: ClipRegions | null;
  setViewerClipRegions: (r: ClipRegions | null) => void;
  detectFaceError: string | null;
  setDetectFaceError: (msg: string | null) => void;

  // --- Yinghua text toggle ---
  yinghuaShowText: boolean;
  setYinghuaShowText: (show: boolean) => void;

  // --- Yinghua language toggle ---
  yinghuaLang: 'zh' | 'en';
  setYinghuaLang: (lang: 'zh' | 'en') => void;

  // --- Yinghua character dynamic & micro-dynamic ---
  yinghuaCharacterDynamic: string;
  setYinghuaCharacterDynamic: (v: string) => void;
  yinghuaMicroDynamic: string;
  setYinghuaMicroDynamic: (v: string) => void;

  // --- Yinghua character traits ---
  yinghuaCharacterTraits: string;
  setYinghuaCharacterTraits: (t: string) => void;

  // --- Yinghua addon image ---
  yinghuaAddonImage: string | null;
  setYinghuaAddonImage: (dataUrl: string | null) => void;

  // --- Name placement ---
  namePlacement: NamePlacement;
  setNamePlacement: (p: NamePlacement) => void;
  faceBounds: FaceBounds | null;
  setFaceBounds: (b: FaceBounds | null) => void;
}

export const useStore = create<WorkshopState>((set) => ({
  uploadedImage: null,
  uploadedName: null,
  palette: null,
  setUpload: (dataUrl, fileName) =>
    set({ uploadedImage: dataUrl, uploadedName: fileName }),
  setPalette: (p) => set({ palette: p }),
  clearUpload: () => set({ uploadedImage: null, uploadedName: null, palette: null }),

  characterName: '',
  setCharacterName: (name) => set({ characterName: name }),

  provider: 'seedance',
  setProvider: (p) => set({ provider: p }),
  freeloadEnabled: false,
  setFreeloadEnabled: (enabled) => set({ freeloadEnabled: enabled, ...(enabled ? { provider: 'gpt-image' as const } : {}) }),
  custom: { endpoint: '', headers: '', bodyTemplate: '' },
  setCustom: (patch) => set((s) => ({ custom: { ...s.custom, ...patch } })),
  creds: {
    seedance: { apiKey: '', baseUrl: '', model: '' },
    'gpt-image': { apiKey: '', baseUrl: '', model: '' },
  },
  setCred: (provider, patch) =>
    set((s) => ({
      creds: { ...s.creds, [provider]: { ...s.creds[provider], ...patch } },
    })),

  threeViewUploads: { front: null, side: null, back: null },
  setThreeViewUpload: (view, dataUrl) =>
    set((s) => ({ threeViewUploads: { ...s.threeViewUploads, [view]: dataUrl } })),
  threeViewPrompt: THREE_VIEW_PROMPT,
  setThreeViewPrompt: (p) => set({ threeViewPrompt: p }),
  threeViewSlot: emptySlot(),
  setThreeViewSlot: (patch) =>
    set((s) => ({ threeViewSlot: { ...s.threeViewSlot, ...patch } })),

  yinghuaPrompts: { 1: '', 2: '', 3: '' },
  setYinghuaPrompt: (id, p) =>
    set((s) => ({ yinghuaPrompts: { ...s.yinghuaPrompts, [id]: p } })),
  yinghuaSlots: { 1: emptySlot(), 2: emptySlot(), 3: emptySlot() },
  setYinghuaSlot: (id, patch) =>
    set((s) => ({
      yinghuaSlots: { ...s.yinghuaSlots, [id]: { ...s.yinghuaSlots[id], ...patch } },
    })),
  setSlotManual: (id, dataUrl) =>
    set((s) => ({
      yinghuaSlots: { ...s.yinghuaSlots, [id]: { status: 'done', images: [dataUrl] } },
    })),

  costumeChangePrompt: COSTUME_CHANGE_PROMPT,
  setCostumeChangePrompt: (p) => set({ costumeChangePrompt: p }),
  costumeChangeSlot: emptySlot(),
  setCostumeChangeSlot: (patch) =>
    set((s) => ({ costumeChangeSlot: { ...s.costumeChangeSlot, ...patch } })),
  costumeChangeHistory: [],
  addCostumeChangeImages: (urls) =>
    set((s) => ({ costumeChangeHistory: [...urls, ...s.costumeChangeHistory] })),
  clearCostumeChangeHistory: () => set({ costumeChangeHistory: [] }),
  costumeChangeRefImage: null,
  setCostumeChangeRefImage: (dataUrl) => set({ costumeChangeRefImage: dataUrl }),

  posterSlot: emptySlot(),
  setPosterSlot: (patch) =>
    set((s) => ({ posterSlot: { ...s.posterSlot, ...patch } })),

  parts: initialParts(),
  togglePart: (code) =>
    set((s) => ({
      parts: s.parts.map((p) =>
        p.code === code ? { ...p, visible: !p.visible } : p,
      ),
    })),
  setAllParts: (visible) =>
    set((s) => ({ parts: s.parts.map((p) => ({ ...p, visible })) })),
  setStageVisible: (stage, visible) =>
    set((s) => ({
      parts: s.parts.map((p) => (p.stage === stage ? { ...p, visible } : p)),
    })),

  visionCred: { apiKey: '', baseUrl: '', model: '' },
  setVisionCred: (patch) =>
    set((s) => ({ visionCred: { ...s.visionCred, ...patch } })),
  viewerClipRegions: null,
  setViewerClipRegions: (r) => set({ viewerClipRegions: r }),
  detectFaceError: null,
  setDetectFaceError: (msg) => set({ detectFaceError: msg }),

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

  namePlacement: 'auto',
  setNamePlacement: (p) => set({ namePlacement: p }),
  faceBounds: null,
  setFaceBounds: (b) => set({ faceBounds: b }),
}));
