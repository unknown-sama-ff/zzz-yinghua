import { create } from 'zustand';
import type {
  GenSlot,
  LayerPart,
  Palette,
  ProviderName,
  YinghuaStyleId,
} from '../types';
import { THREE_VIEW_PROMPT } from '../lib/prompts';

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
  custom: CustomProviderConfig;
  setCustom: (patch: Partial<CustomProviderConfig>) => void;
  // Per-provider credentials, kept in memory only (never persisted to disk).
  creds: Record<'seedance' | 'gpt-image', { apiKey: string; baseUrl: string; model: string }>;
  setCred: (
    provider: 'seedance' | 'gpt-image',
    patch: Partial<{ apiKey: string; baseUrl: string; model: string }>,
  ) => void;

  // --- Three-view step ---
  threeViewEnabled: boolean;
  setThreeViewEnabled: (v: boolean) => void;
  threeViewPrompt: string;
  setThreeViewPrompt: (p: string) => void;
  threeViewSlot: GenSlot;
  setThreeViewSlot: (patch: Partial<GenSlot>) => void;

  // --- Yinghua action step (3 styles) ---
  yinghuaPrompts: Record<YinghuaStyleId, string>;
  setYinghuaPrompt: (id: YinghuaStyleId, p: string) => void;
  yinghuaSlots: Record<YinghuaStyleId, GenSlot>;
  setYinghuaSlot: (id: YinghuaStyleId, patch: Partial<GenSlot>) => void;

  // --- Viewer ---
  parts: LayerPart[];
  togglePart: (code: string) => void;
  setAllParts: (visible: boolean) => void;
  setStageVisible: (stage: 1 | 2, visible: boolean) => void;
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

  threeViewEnabled: true,
  setThreeViewEnabled: (v) => set({ threeViewEnabled: v }),
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
}));
