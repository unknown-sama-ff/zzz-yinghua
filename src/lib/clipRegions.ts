export interface ClipRegions {
  r0: string;
  r1: string;
  r2: string;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/**
 * Compute three diagonal clip-path polygons from face bounds (0–1 fractions of
 * image height). r0 covers the face, r1/r2 split the remainder.
 */
export function computeClipRegions(_faceTop: number, faceBottom: number): ClipRegions {
  const r0bot_l = Math.min(faceBottom + 0.12, 0.75);
  const r0bot_r = Math.min(faceBottom - 0.02, r0bot_l - 0.08);
  const mid_l = Math.min(r0bot_l + 0.22, 0.92);
  const mid_r = Math.min(r0bot_r + 0.22, 0.88);

  return {
    r0: `polygon(0 0, 100% 0, 100% ${pct(r0bot_r)}, 0 ${pct(r0bot_l)})`,
    r1: `polygon(0 ${pct(r0bot_l)}, 100% ${pct(r0bot_r)}, 100% ${pct(mid_r)}, 0 ${pct(mid_l)})`,
    r2: `polygon(0 ${pct(mid_l)}, 100% ${pct(mid_r)}, 100% 100%, 0 100%)`,
  };
}
