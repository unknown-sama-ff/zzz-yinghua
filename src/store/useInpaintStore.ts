import { create } from 'zustand';
import type { ImageEditVersion, InpaintTarget } from '../types';
import { MAX_UNDO_HISTORY } from '../lib/constants';

interface InpaintState {
  // --- Selection / source ownership ---
  isSelecting: boolean;
  /** The original module image that an approved draft may replace. */
  targetImage: InpaintTarget | null;
  isWorkspaceOpen: boolean;
  setIsSelecting: (v: boolean) => void;
  setTargetImage: (t: InpaintTarget | null) => void;
  openWorkspace: (t: InpaintTarget) => void;
  closeWorkspace: () => void;

  // --- In-memory editing session ---
  versions: ImageEditVersion[];
  currentVersionId: string | null;
  currentVersionUrl: string | null;
  selectVersion: (id: string) => void;
  appendVersion: (url: string, instruction: string, parentId?: string) => ImageEditVersion | null;

  // --- Mode ---
  mode: 'smart' | 'precise';
  setMode: (m: 'smart' | 'precise') => void;

  // --- Mask ---
  maskDataUrl: string | null;
  setMaskDataUrl: (d: string | null) => void;
  brushSize: number;
  setBrushSize: (s: number) => void;
  featherRadius: number;
  setFeatherRadius: (r: number) => void;
  tool: 'brush' | 'eraser' | 'rect' | 'shape';
  setTool: (t: 'brush' | 'eraser' | 'rect' | 'shape') => void;
  shapeType: 'rect' | 'ellipse' | 'circle';
  setShapeType: (t: 'rect' | 'ellipse' | 'circle') => void;
  history: string[];
  pushHistory: () => void;
  undo: () => void;
  clearMask: () => void;

  // --- Generation ---
  prompt: string;
  setPrompt: (p: string) => void;
  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;

  // --- Reset ---
  reset: () => void;
}

function createVersionId(): string {
  return crypto.randomUUID();
}

function createInitialState() {
  return {
    isSelecting: false,
    targetImage: null as InpaintTarget | null,
    isWorkspaceOpen: false,
    versions: [] as ImageEditVersion[],
    currentVersionId: null as string | null,
    currentVersionUrl: null as string | null,
    mode: 'smart' as const,
    maskDataUrl: null as string | null,
    prompt: '',
    brushSize: 24,
    featherRadius: 12,
    tool: 'brush' as const,
    shapeType: 'rect' as const,
    history: [] as string[],
    isGenerating: false,
  };
}

export const useInpaintStore = create<InpaintState>((set, get) => ({
  ...createInitialState(),

  setIsSelecting: (v) => set({ isSelecting: v }),
  setTargetImage: (t) => set({ targetImage: t }),
  openWorkspace: (targetImage) => {
    const root: ImageEditVersion = {
      id: createVersionId(),
      parentId: null,
      url: targetImage.url,
      instruction: null,
      createdAt: Date.now(),
    };
    set({
      targetImage,
      isWorkspaceOpen: true,
      isSelecting: false,
      versions: [root],
      currentVersionId: root.id,
      currentVersionUrl: root.url,
      mode: 'smart',
      maskDataUrl: null,
      history: [],
      prompt: '',
      isGenerating: false,
    });
  },

  closeWorkspace: () => {
    set({
      targetImage: null,
      isWorkspaceOpen: false,
      isSelecting: false,
      versions: [],
      currentVersionId: null,
      currentVersionUrl: null,
      maskDataUrl: null,
      history: [],
      prompt: '',
      isGenerating: false,
    });
  },

  selectVersion: (id) => {
    const version = get().versions.find((candidate) => candidate.id === id);
    if (!version) return;
    set({
      currentVersionId: version.id,
      currentVersionUrl: version.url,
      maskDataUrl: null,
      history: [],
    });
  },

  appendVersion: (url, instruction, parentId) => {
    const selectedParentId = parentId ?? get().currentVersionId;
    if (!selectedParentId || !get().versions.some((version) => version.id === selectedParentId)) return null;
    const version: ImageEditVersion = {
      id: createVersionId(),
      parentId: selectedParentId,
      url,
      instruction,
      createdAt: Date.now(),
    };
    set((state) => ({
      versions: [...state.versions, version],
      currentVersionId: version.id,
      currentVersionUrl: version.url,
      maskDataUrl: null,
      history: [],
      prompt: '',
    }));
    return version;
  },

  setMode: (mode) => set({ mode }),

  setMaskDataUrl: (maskDataUrl) => set({ maskDataUrl }),
  setBrushSize: (brushSize) => set({ brushSize: Math.max(5, Math.min(80, brushSize)) }),
  setFeatherRadius: (featherRadius) => set({ featherRadius: Math.max(0, Math.min(30, featherRadius)) }),
  setTool: (tool) => set({ tool }),
  setShapeType: (shapeType) => set({ shapeType }),

  pushHistory: () => {
    const { maskDataUrl, history } = get();
    if (!maskDataUrl) return;
    const next = [...history, maskDataUrl];
    if (next.length > MAX_UNDO_HISTORY) next.shift();
    set({ history: next });
  },

  undo: () => {
    const { history } = get();
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    set({ maskDataUrl: previous, history: history.slice(0, -1) });
  },

  clearMask: () => set({ maskDataUrl: null, history: [] }),

  setPrompt: (prompt) => set({ prompt }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),

  reset: () => set(createInitialState()),
}));
