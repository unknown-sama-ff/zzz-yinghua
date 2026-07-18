import { create } from 'zustand';
import type { ProviderName } from '../types';

export interface CustomProviderConfig {
  endpoint: string;
  headers: string;
  bodyTemplate: string;
}

interface ProviderState {
  provider: ProviderName;
  setProvider: (p: ProviderName) => void;
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

export const useProviderStore = create<ProviderState>((set) => ({
  provider: 'seedream',
  setProvider: (p) => set({ provider: p }),
  freeloadEnabled: false,
  setFreeloadEnabled: (enabled) => set({ freeloadEnabled: enabled, ...(enabled ? { provider: 'gpt-image' as const } : {}) }),
  custom: { endpoint: '', headers: '', bodyTemplate: '' },
  setCustom: (patch) => set((s) => ({ custom: { ...s.custom, ...patch } })),
  creds: {
    seedream: { apiKey: '', baseUrl: '', model: '' },
    'gpt-image': { apiKey: '', baseUrl: '', model: '' },
    'custom-url': { apiKey: '', baseUrl: '', model: '' },
  },
  setCred: (provider, patch) =>
    set((s) => ({
      creds: { ...s.creds, [provider]: { ...s.creds[provider], ...patch } },
    })),
  visionCred: { apiKey: '', baseUrl: '', model: '' },
  setVisionCred: (patch) =>
    set((s) => ({ visionCred: { ...s.visionCred, ...patch } })),
}));
