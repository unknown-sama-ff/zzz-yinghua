import type { Palette } from '../types';
import { DEFAULT_PALETTE } from './colorExtract';

/**
 * Apply an extracted palette to the document by overriding the runtime CSS
 * variables. The 300ms transition lives in CSS (:root has a transition on
 * these custom properties), so swapping values animates smoothly.
 */
export function applyTheme(palette: Palette | null): void {
  const p = palette ?? DEFAULT_PALETTE;
  const root = document.documentElement.style;
  root.setProperty('--zzz-primary', p.dominant);
  root.setProperty('--zzz-magenta', p.accent);
  root.setProperty('--zzz-accent', p.accent);
  root.setProperty('--zzz-muted', p.muted);
  root.setProperty('--zzz-text-on', p.textOn);
}

/** Reset to the default ZZZ theme (used when the upload is cleared). */
export function resetTheme(): void {
  applyTheme(DEFAULT_PALETTE);
}
