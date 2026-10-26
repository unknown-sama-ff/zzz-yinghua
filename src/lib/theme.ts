import type { Palette } from '../types';
import { DEFAULT_PALETTE } from './colorExtract';

function luminance(hex: string): number {
  const rgb = hex.match(/[a-f\d]{2}/gi)?.map((part) => parseInt(part, 16) / 255) ?? [0, 0, 0];
  const linear = rgb.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

/** UI contrast is derived separately; the original palette still feeds prompts. */
export function themeTextOn(primary: string): string {
  return luminance(primary) > 0.179 ? '#000000' : '#ffffff';
}

export function themeHighlight(primary: string): string {
  const rgb = primary.match(/[a-f\d]{2}/gi)?.map((part) => parseInt(part, 16)) ?? [176, 38, 255];
  for (let amount = 0; amount <= 1; amount += 0.05) {
    const result = '#' + rgb.map((channel) => Math.round(channel + (255 - channel) * amount).toString(16).padStart(2, '0')).join('');
    if ((luminance(result) + 0.05) / (luminance('#191d25') + 0.05) >= 4.5) return result;
  }
  return '#ffffff';
}

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
  root.setProperty('--zzz-text-on', themeTextOn(p.dominant));
  root.setProperty('--studio-highlight', themeHighlight(p.dominant));
}

/** Reset to the default ZZZ theme (used when the upload is cleared). */
export function resetTheme(): void {
  applyTheme(DEFAULT_PALETTE);
}
