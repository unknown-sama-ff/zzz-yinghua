import { create } from 'zustand';
import { THREE_VIEW_PROMPT, COSTUME_CHANGE_PROMPT } from '../lib/prompts';
import type { GenSlot } from '../types';

const emptySlot = (): GenSlot => ({ status: 'idle', images: [] });

interface WorkbenchState {
  // --- Three-view step ---
  threeViewUploads: { front: string | null; side: string | null; back: string | null };
  setThreeViewUpload: (view: 'front' | 'side' | 'back', dataUrl: string | null) => void;
  threeViewPrompt: string;
  setThreeViewPrompt: (p: string) => void;
  threeViewSlot: GenSlot;
  setThreeViewSlot: (patch: Partial<GenSlot>) => void;

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
}

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  threeViewUploads: { front: null, side: null, back: null },
  setThreeViewUpload: (view, dataUrl) =>
    set((s) => ({ threeViewUploads: { ...s.threeViewUploads, [view]: dataUrl } })),
  threeViewPrompt: THREE_VIEW_PROMPT,
  setThreeViewPrompt: (p) => set({ threeViewPrompt: p }),
  threeViewSlot: emptySlot(),
  setThreeViewSlot: (patch) =>
    set((s) => ({ threeViewSlot: { ...s.threeViewSlot, ...patch } })),

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
}));
