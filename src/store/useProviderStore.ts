import { create } from 'zustand';
import type { GptImageQuality, ProviderName } from '../types';
import { fetchPresetImageCapabilities, gptImageQualityOptionsForModel, supportsGptImageGif } from '../lib/gptImageCapabilities';
import { useToast } from './useToast';

export interface CustomProviderConfig {
  endpoint: string;
  headers: string;
  bodyTemplate: string;
}

interface ProviderState {
  provider: ProviderName;
  setProvider: (p: ProviderName) => void;
  denoiseEnabled: boolean;
  setDenoiseEnabled: (enabled: boolean) => void;
  gptImageQuality: GptImageQuality;
  setGptImageQuality: (quality: GptImageQuality) => void;
  presetQualityOptions: readonly GptImageQuality[] | null;
  presetGifSupported: boolean | null;
  presetQualityStatus: 'idle' | 'loading' | 'ready' | 'error';
  loadPresetQualityOptions: () => Promise<void>;
  freeloadEnabled: boolean;
  setFreeloadEnabled: (enabled: boolean) => void;
  custom: CustomProviderConfig;
  setCustom: (patch: Partial<CustomProviderConfig>) => void;
  creds: Record<'seedream' | 'gpt-image' | 'custom-url', { apiKey: string; baseUrl: string; model: string }>;
  setCred: (
    provider: 'seedream' | 'gpt-image' | 'custom-url',
    patch: Partial<{ apiKey: string; baseUrl: string; model: string }>,
  ) => void;
  visionCred: { apiKey: string; baseUrl: string; model: string };
  setVisionCred: (patch: Partial<{ apiKey: string; baseUrl: string; model: string }>) => void;
}

export function gptImageQualityOptions(state: ProviderState): readonly GptImageQuality[] | null {
  return state.freeloadEnabled
    ? state.presetQualityOptions
    : gptImageQualityOptionsForModel(state.creds['gpt-image'].model);
}

export function gptImageGifSupported(state: ProviderState): boolean {
  return state.freeloadEnabled ? state.presetGifSupported === true : supportsGptImageGif(state.creds['gpt-image'].model);
}

/** During preset discovery/failure, omit quality to retain the old server behavior. */
export function gptImageQualityForRequest(state: ProviderState): GptImageQuality | undefined {
  const options = gptImageQualityOptions(state);
  return options ? (options.includes(state.gptImageQuality) ? state.gptImageQuality : 'auto') : undefined;
}

function resetUnsupportedQuality(state: ProviderState): Partial<ProviderState> {
  const options = gptImageQualityOptions(state);
  if (options && !options.includes(state.gptImageQuality)) {
    useToast.getState().show('当前模型不支持所选生成精细度，已重置为自动');
    return { gptImageQuality: 'auto' };
  }
  return {};
}

// Ignore stale discovery responses after a mode switch or a newer request.
let presetRequestId = 0;
export const useProviderStore = create<ProviderState>((set, get) => ({
  provider: 'seedream',
  setProvider: (p) => set({ provider: p }),
  denoiseEnabled: false,
  setDenoiseEnabled: (enabled) => set({ denoiseEnabled: enabled }),
  gptImageQuality: 'auto',
  setGptImageQuality: (quality) => {
    if (gptImageQualityOptions(get())?.includes(quality)) set({ gptImageQuality: quality });
  },
  presetQualityOptions: null,
  presetGifSupported: null,
  presetQualityStatus: 'idle',
  loadPresetQualityOptions: async () => {
    const requestId = ++presetRequestId;
    set({ presetQualityOptions: null, presetGifSupported: null, presetQualityStatus: 'loading' });
    try {
      const { qualityOptions: options, gifSupported } = await fetchPresetImageCapabilities();
      if (requestId !== presetRequestId || !get().freeloadEnabled) return;
      const state = { ...get(), presetQualityOptions: options };
      set({ presetQualityOptions: options, presetGifSupported: gifSupported, presetQualityStatus: 'ready', ...resetUnsupportedQuality(state) });
    } catch {
      if (requestId !== presetRequestId || !get().freeloadEnabled) return;
      set({ presetQualityOptions: null, presetGifSupported: null, presetQualityStatus: 'error' });
    }
  },
  freeloadEnabled: false,
  setFreeloadEnabled: (enabled) => {
    ++presetRequestId;
    const state = { ...get(), freeloadEnabled: enabled };
    set({ freeloadEnabled: enabled, ...(enabled ? { provider: 'gpt-image' as const } : resetUnsupportedQuality(state)) });
    if (enabled) void get().loadPresetQualityOptions();
    else set({ presetQualityOptions: null, presetGifSupported: null, presetQualityStatus: 'idle' });
  },
  custom: { endpoint: '', headers: '', bodyTemplate: '' },
  setCustom: (patch) => set((s) => ({ custom: { ...s.custom, ...patch } })),
  creds: {
    seedream: { apiKey: '', baseUrl: '', model: '' },
    'gpt-image': { apiKey: '', baseUrl: '', model: '' },
    'custom-url': { apiKey: '', baseUrl: '', model: '' },
  },
  setCred: (provider, patch) => set((state) => {
    const creds = { ...state.creds, [provider]: { ...state.creds[provider], ...patch } };
    return { creds, ...resetUnsupportedQuality({ ...state, creds }) };
  }),
  visionCred: { apiKey: '', baseUrl: '', model: '' },
  setVisionCred: (patch) =>
    set((s) => ({ visionCred: { ...s.visionCred, ...patch } })),
}));
