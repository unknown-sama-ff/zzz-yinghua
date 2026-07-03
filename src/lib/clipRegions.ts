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
 * image height). Three bands tile the full image with a tiny intentional overlap
 * so that independent clip-path rasterisation doesn't leave visible seams.
 *   region-0 (01/04) = face band  — both eyes, minimal, no background
 *   region-1 (02/05) = above face — head, hair
 *   region-2 (03/06) = below face — torso, lower body
 * Cut lines are parallel (same slope) so bands tile seamlessly.
 */
export function computeClipRegions(faceTop: number, faceBottom: number): ClipRegions {
  const SLOPE = 0.14;

  // r0 top edge: just above the eyebrows
  const t0r = Math.max(faceTop - 0.04, 0.04);
  const t0l = t0r + SLOPE;

  // r0 bottom edge: just below the chin, with a minimum band height of ~0.22
  const b0r = Math.min(Math.max(faceBottom + 0.04, t0r + 0.22), 0.50);
  const b0l = b0r + SLOPE;

  // Tiny overlap (~0.3% of image height) between adjacent regions eliminates
  // visible sub-pixel seams caused by independent clip-path rasterisation.
  const OVERLAP = 0.003;

  return {
    r0: `polygon(0 ${pct(t0l)}, 100% ${pct(t0r)}, 100% ${pct(b0r)}, 0 ${pct(b0l)})`,
    r1: `polygon(0 0, 100% 0, 100% ${pct(t0r + OVERLAP)}, 0 ${pct(t0l + OVERLAP)})`,
    r2: `polygon(0 ${pct(b0l - OVERLAP)}, 100% ${pct(b0r - OVERLAP)}, 100% 100%, 0 100%)`,
  };
}
