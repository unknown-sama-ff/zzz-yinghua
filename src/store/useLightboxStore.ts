import { create } from 'zustand';

interface LightboxState {
  src: string | null;
  alt: string;
  /** Tried once if `src` fails to load (e.g. gallery images behind the proxy). */
  fallbackSrc: string | null;
  open: (src: string, alt?: string, fallbackSrc?: string) => void;
  close: () => void;
}

/**
 * Global single-slot image lightbox. One store (rather than per-component
 * state) because the overlay portals into document.body and locks body
 * scrolling — two live instances would fight over both.
 */
export const useLightboxStore = create<LightboxState>((set) => ({
  src: null,
  alt: '',
  fallbackSrc: null,
  open: (src, alt = '放大图片', fallbackSrc) =>
    set({ src, alt, fallbackSrc: fallbackSrc ?? null }),
  close: () => set({ src: null, alt: '', fallbackSrc: null }),
}));
