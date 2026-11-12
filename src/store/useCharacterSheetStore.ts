import { create } from 'zustand';
import type { GenSlot, ProviderName } from '../types';
import { CHARACTER_BREAKDOWN_PROMPT } from '../lib/characterBreakdown';

export interface CharacterBreakdownImage {
  url: string;
  characterName: string;
  prompt: string;
  provider: ProviderName;
}

export interface CharacterSheet {
  images: CharacterBreakdownImage[];
  selectedImage: string | null;
  slot: GenSlot;
  uploading: boolean;
}

const emptySheet = (): CharacterSheet => ({ images: [], selectedImage: null, slot: { status: 'idle', images: [] }, uploading: false });

interface CharacterSheetState {
  namesBySource: Record<string, string>;
  originalsBySource: Record<string, string[]>;
  sheets: Record<string, CharacterSheet>;
  promptTemplate: string;
  setPromptTemplate: (prompt: string) => void;
  registerSources: (sources: string[], name: string) => void;
  setOriginals: (sources: string[], originals: string[]) => void;
  setSlot: (source: string, slot: Partial<GenSlot>) => void;
  setUploading: (source: string, uploading: boolean) => void;
  addImages: (source: string, images: CharacterBreakdownImage[]) => void;
  selectImage: (source: string, image: string | null) => void;
}

export const useCharacterSheetStore = create<CharacterSheetState>((set) => ({
  namesBySource: {},
  originalsBySource: {},
  sheets: {},
  promptTemplate: CHARACTER_BREAKDOWN_PROMPT,
  setPromptTemplate: (promptTemplate) => set({ promptTemplate }),
  registerSources: (sources, name) => set((state) => ({
    namesBySource: { ...state.namesBySource, ...Object.fromEntries(sources.map((source) => [source, name.trim()])) },
  })),
  setOriginals: (sources, originals) => set((state) => ({
    originalsBySource: { ...state.originalsBySource, ...Object.fromEntries(sources.map((source) => [source, [...new Set(originals)]])) },
  })),
  setSlot: (source, patch) => set((state) => {
    const sheet = state.sheets[source] ?? emptySheet();
    return { sheets: { ...state.sheets, [source]: { ...sheet, slot: { ...sheet.slot, ...patch } } } };
  }),
  setUploading: (source, uploading) => set((state) => ({
    sheets: { ...state.sheets, [source]: { ...(state.sheets[source] ?? emptySheet()), uploading } },
  })),
  addImages: (source, images) => set((state) => {
    if (!images.length) return state;
    const sheet = state.sheets[source] ?? emptySheet();
    const incoming = images.filter((image, index) => images.findIndex((other) => other.url === image.url) === index);
    return { sheets: { ...state.sheets, [source]: {
      ...sheet,
      images: [...incoming, ...sheet.images.filter((image) => !incoming.some((other) => other.url === image.url))],
      selectedImage: incoming[0].url,
    } } };
  }),
  selectImage: (source, selectedImage) => set((state) => {
    const sheet = state.sheets[source] ?? emptySheet();
    if (selectedImage && !sheet.images.some((image) => image.url === selectedImage)) return state;
    return { sheets: { ...state.sheets, [source]: { ...sheet, selectedImage } } };
  }),
}));
