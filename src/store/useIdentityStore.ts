import { create } from 'zustand';

interface IdentityState {
  characterName: string;
  setCharacterName: (name: string) => void;
}

export const useIdentityStore = create<IdentityState>((set) => ({
  characterName: '',
  setCharacterName: (name) => set({ characterName: name }),
}));
