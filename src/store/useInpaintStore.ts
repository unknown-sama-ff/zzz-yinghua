import { create } from 'zustand';

interface InpaintState {
  // --- Selection ---
  isSelecting: boolean;
  targetImage: { url: string; type: string; slotId?: string; index?: number } | null;
  isWorkspaceOpen: boolean;
  setIsSelecting: (v: boolean) => void;
  setTargetImage: (t: { url: string; type: string; slotId?: string; index?: number } | null) => void;
  openWorkspace: (t: { url: string; type: string; slotId?: string; index?: number }) => void;
  closeWorkspace: () => void;

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
  tool: 'brush' | 'eraser' | 'rect';
  setTool: (t: 'brush' | 'eraser' | 'rect') => void;
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

const MAX_HISTORY = 20;

const LS_KEY = 'inpaint-state';

function loadPersisted(): { targetImageUrl: string; maskDataUrl: string | null; prompt: string; mode: 'smart' | 'precise' } | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.targetImage?.url) {
      return { targetImageUrl: data.targetImage.url, maskDataUrl: data.maskDataUrl ?? null, prompt: data.prompt ?? '', mode: data.mode ?? 'smart' };
    }
  } catch { /* ignore */ }
  return null;
}

function persistState(state: Partial<InpaintState> & { targetImage: { url: string } | null }) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      targetImage: state.targetImage,
      maskDataUrl: state.maskDataUrl,
      prompt: state.prompt,
      mode: state.mode,
    }));
  } catch { /* ignore quota errors */ }
}

const persisted = loadPersisted();

const initialState = {
  isSelecting: false,
  targetImage: null,
  isWorkspaceOpen: false,
  mode: (persisted?.mode ?? 'smart') as 'smart' | 'precise',
  maskDataUrl: persisted?.maskDataUrl ?? null,
  prompt: persisted?.prompt ?? '',
  brushSize: 24,
  featherRadius: 12,
  tool: 'brush' as const,
  history: [] as string[],
  isGenerating: false,
};

export const useInpaintStore = create<InpaintState>((set, get) => ({
  ...initialState,

  setIsSelecting: (v) => set({ isSelecting: v }),
  setTargetImage: (t) => set({ targetImage: t }),
  openWorkspace: (t) => {
    // Try to restore persisted state for the same image
    const saved = loadPersisted();
    const restored = (saved && saved.targetImageUrl === t.url)
      ? { maskDataUrl: saved.maskDataUrl, prompt: saved.prompt, mode: saved.mode }
      : { maskDataUrl: null as string | null, prompt: '', mode: 'smart' as const };
    set({ ...restored, targetImage: t, isWorkspaceOpen: true, isSelecting: false });
    persistState({ ...restored, targetImage: t });
  },

  closeWorkspace: () => {
    const { targetImage, maskDataUrl, prompt, mode } = get();
    persistState({ targetImage, maskDataUrl, prompt, mode });
    set({
      isWorkspaceOpen: false,
      isSelecting: false,
      targetImage: null,
      maskDataUrl: null,
      history: [],
      isGenerating: false,
    });
  },

  setMode: (m) => { set({ mode: m }); persistState(get()); },

  setMaskDataUrl: (d) => { set({ maskDataUrl: d }); persistState(get()); },
  setBrushSize: (s) => set({ brushSize: Math.max(5, Math.min(80, s)) }),
  setFeatherRadius: (r) => set({ featherRadius: Math.max(0, Math.min(30, r)) }),
  setTool: (t) => set({ tool: t }),

  pushHistory: () => {
    const { maskDataUrl, history } = get();
    if (!maskDataUrl) return;
    const next = [...history, maskDataUrl];
    if (next.length > MAX_HISTORY) next.shift();
    set({ history: next });
  },

  undo: () => {
    const { history } = get();
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    const rest = history.slice(0, -1);
    set({ maskDataUrl: prev, history: rest });
  },

  clearMask: () => set({ maskDataUrl: null, history: [] }),

  setPrompt: (p) => set({ prompt: p }),
  setIsGenerating: (v) => set({ isGenerating: v }),

  reset: () => set(initialState),
}));
