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
export function computeClipRegions(faceTop: number, faceBottom: number, bodyAxisAngle?: number): ClipRegions {
  const angleRad = (bodyAxisAngle ?? 8) * Math.PI / 180;
  // Cap slope at ±2.0 (≈±63°) to prevent polygon degeneration on extreme angles.
  const SLOPE = Math.max(-2.0, Math.min(2.0, Math.tan(angleRad)));

  // Safety clamp on face bounds so a failed detection (faceTop ≈ 0)
  // doesn't collapse the face band to zero height.
  const ft = Math.max(0.05, Math.min(0.85, faceTop));
  const fb = Math.max(0.10, Math.min(0.95, faceBottom));

  // r0 top edge: just above the eyebrows
  const t0r = Math.max(ft - 0.04, 0.04);
  const t0l = Math.max(0, Math.min(1, t0r + SLOPE));

  // r0 bottom edge: just below the chin, with a minimum band height of ~0.22
  const b0r = Math.min(Math.max(fb + 0.04, t0r + 0.22), 0.85);
  const b0l = Math.max(0, Math.min(1, b0r + SLOPE));

  // Tiny overlap (~0.3% of image height) between adjacent regions eliminates
  // visible sub-pixel seams caused by independent clip-path rasterisation.
  const OVERLAP = 0.003;

  return {
    r0: `polygon(0 ${pct(t0l)}, 100% ${pct(t0r)}, 100% ${pct(b0r)}, 0 ${pct(b0l)})`,
    r1: `polygon(0 0, 100% 0, 100% ${pct(t0r + OVERLAP)}, 0 ${pct(t0l + OVERLAP)})`,
    r2: `polygon(0 ${pct(b0l - OVERLAP)}, 100% ${pct(b0r - OVERLAP)}, 100% 100%, 0 100%)`,
  };
}
