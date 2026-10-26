import { create } from 'zustand';
import type { Palette } from '../types';

interface UploadState {
  uploadedImage: string | null;
  uploadedName: string | null;
  palette: Palette | null;
  uploadRevision: number;
  setUpload: (dataUrl: string, fileName: string) => void;
  setPalette: (p: Palette | null) => void;
  setPaletteForUpload: (p: Palette, revision: number) => boolean;
  clearUpload: () => void;
}

export const useUploadStore = create<UploadState>((set, get) => ({
  uploadedImage: null,
  uploadedName: null,
  palette: null,
  uploadRevision: 0,
  setUpload: (dataUrl, fileName) =>
    set((s) => ({ uploadedImage: dataUrl, uploadedName: fileName, uploadRevision: s.uploadRevision + 1 })),
  setPalette: (p) => set({ palette: p }),
  setPaletteForUpload: (palette, revision) => {
    if (get().uploadRevision !== revision || !get().uploadedImage) return false;
    set({ palette });
    return true;
  },
  clearUpload: () => set((s) => ({ uploadedImage: null, uploadedName: null, palette: null, uploadRevision: s.uploadRevision + 1 })),
}));
