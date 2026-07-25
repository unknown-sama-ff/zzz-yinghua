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

const pairedCode: Record<string, string> = {
  '01': '04',
  '02': '05',
  '03': '06',
  '04': '01',
  '05': '02',
  '06': '03',
};

const setPartsWithPairExclusivity = (parts: LayerPart[], visibleCodes: ReadonlySet<string>): LayerPart[] =>
  parts.map((p) => ({ ...p, visible: visibleCodes.has(p.code) }));

export const useViewerStore = create<ViewerState>((set) => ({
  parts: initialParts(),
  togglePart: (code) =>
    set((s) => {
      const current = s.parts.find((p) => p.code === code);
      if (!current) return s;
      const visibleCodes = new Set(s.parts.filter((p) => p.visible).map((p) => p.code));
      if (current.visible) {
        visibleCodes.delete(code);
      } else {
        visibleCodes.add(code);
        visibleCodes.delete(pairedCode[code]);
      }
      return { parts: setPartsWithPairExclusivity(s.parts, visibleCodes) };
    }),
  setAllParts: (visible) =>
    set((s) => {
      if (!visible) return { parts: s.parts.map((p) => ({ ...p, visible: false })) };
      return {
        parts: setPartsWithPairExclusivity(
          s.parts,
          new Set(['04', '05', '06']),
        ),
      };
    }),
  setStageVisible: (stage, visible) =>
    set((s) => {
      const visibleCodes = new Set(s.parts.filter((p) => p.visible).map((p) => p.code));
      const stageCodes = s.parts.filter((p) => p.stage === stage).map((p) => p.code);
      for (const code of stageCodes) {
        if (visible) {
          visibleCodes.add(code);
          visibleCodes.delete(pairedCode[code]);
        } else {
          visibleCodes.delete(code);
        }
      }
      return { parts: setPartsWithPairExclusivity(s.parts, visibleCodes) };
    }),

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
