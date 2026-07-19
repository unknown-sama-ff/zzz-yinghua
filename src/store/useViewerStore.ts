import { create } from 'zustand';
import type { ClipRegions } from '../lib/clipRegions';
import type { FaceBounds } from '../lib/detectFace';
import type { LayerPart, NamePlacement } from '../types';

interface ViewerState {
  parts: LayerPart[];
  togglePart: (code: string) => void;
  setAllParts: (visible: boolean) => void;
  setStageVisible: (stage: 1 | 2, visible: boolean) => void;
  viewerClipRegions: ClipRegions | null;
  setViewerClipRegions: (r: ClipRegions | null) => void;
  detectFaceError: string | null;
  setDetectFaceError: (msg: string | null) => void;
  namePlacement: NamePlacement;
  setNamePlacement: (p: NamePlacement) => void;
  faceBounds: FaceBounds | null;
  setFaceBounds: (b: FaceBounds | null) => void;
  viewerFullscreen: boolean;
  setViewerFullscreen: (v: boolean) => void;
}

const initialParts = (): LayerPart[] =>
  Array.from({ length: 6 }, (_, i) => ({
    code: String(i + 1).padStart(2, '0'),
    stage: (i < 3 ? 1 : 2) as 1 | 2,
    styleId: (i < 3 ? 2 : 3) as 2 | 3,
    region: (i % 3) as 0 | 1 | 2,
    visible: false,
  }));

export const useViewerStore = create<ViewerState>((set) => ({
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

  viewerClipRegions: null,
  setViewerClipRegions: (r) => set({ viewerClipRegions: r }),
  detectFaceError: null,
  setDetectFaceError: (msg) => set({ detectFaceError: msg }),

  namePlacement: 'auto',
  setNamePlacement: (p) => set({ namePlacement: p }),
  faceBounds: null,
  setFaceBounds: (b) => set({ faceBounds: b }),

  viewerFullscreen: false,
  setViewerFullscreen: (v) => set({ viewerFullscreen: v }),
}));
