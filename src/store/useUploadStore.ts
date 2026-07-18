import { create } from 'zustand';
import type { Palette } from '../types';

interface UploadState {
  uploadedImage: string | null;
  uploadedName: string | null;
  palette: Palette | null;
  setUpload: (dataUrl: string, fileName: string) => void;
  setPalette: (p: Palette | null) => void;
  clearUpload: () => void;
}

export const useUploadStore = create<UploadState>((set) => ({
  uploadedImage: null,
  uploadedName: null,
  palette: null,
  setUpload: (dataUrl, fileName) =>
    set({ uploadedImage: dataUrl, uploadedName: fileName }),
  setPalette: (p) => set({ palette: p }),
  clearUpload: () => set({ uploadedImage: null, uploadedName: null, palette: null }),
}));
