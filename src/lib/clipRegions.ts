export interface ClipRegions {
  r0: string;
  r1: string;
  r2: string;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/**
 * Compute three clip-path polygons from face bounds (0–1 fractions of image dimensions).
 * Auto-selects cut orientation based on body axis angle:
 *
 *   |bodyAxisAngle| >= 45° → HORIZONTAL cuts (standing/leaning characters)
 *     Bands are top/bottom strips; slope = x-drift per unit y going left→right.
 *     r0 = face band, r1 = above face (hair), r2 = below face (torso).
 *
 *   |bodyAxisAngle| < 45° → VERTICAL cuts (lying characters)
 *     Bands are left/right columns; slope = x-drift per unit y going top→bottom.
 *     r0 = face band, r1 = left of face (hair side), r2 = right of face (body side).
 *
 * Extreme angles naturally produce near-triangular trapezoids (one edge clamped to
 * the image boundary), which is the intended aesthetic.
 */
export function computeClipRegions(
  faceTop: number,
  faceBottom: number,
  bodyAxisAngle?: number,
  faceLeft?: number,
  faceRight?: number,
): ClipRegions {
  const angle = bodyAxisAngle ?? 8;
  const angleRad = angle * Math.PI / 180;
  const OVERLAP = 0.003;

  // ── VERTICAL MODE: lying / near-horizontal body ─────────────────────────────
  if (Math.abs(angle) < 45) {
    // SLOPE_Y: x-drift per unit y, follows the body's diagonal direction.
    const SLOPE_Y = Math.tan(angleRad);

    // Clamp face horizontal bounds.
    const fl = Math.max(0.02, Math.min(0.80, faceLeft ?? 0.25));
    const fr = Math.max(0.10, Math.min(0.98, faceRight ?? 0.65));

    // Left cut line: face band left edge at top/bottom of image.
    const l0t = Math.max(0, Math.min(1, fl - 0.04));
    const l0b = Math.max(0, Math.min(1, l0t + SLOPE_Y));

    // Right cut line: minimum band width of 0.22 so the face is never squeezed out.
    const r0t = Math.max(0, Math.min(1, Math.max(fr + 0.04, l0t + 0.22)));
    const r0b = Math.max(0, Math.min(1, r0t + SLOPE_Y));

    return {
      r0: `polygon(${pct(l0t)} 0, ${pct(r0t)} 0, ${pct(r0b)} 100%, ${pct(l0b)} 100%)`,
      r1: `polygon(0 0, ${pct(l0t + OVERLAP)} 0, ${pct(l0b + OVERLAP)} 100%, 0 100%)`,
      r2: `polygon(${pct(r0t - OVERLAP)} 0, 100% 0, 100% 100%, ${pct(r0b - OVERLAP)} 100%)`,
    };
  }

  // ── HORIZONTAL MODE: standing / leaning body ─────────────────────────────────
  // SLOPE: y-drift per unit x, going left→right.
  const SLOPE = Math.tan(angleRad);

  // Clamp face vertical bounds.
  const ft = Math.max(0.05, Math.min(0.85, faceTop));
  const fb = Math.max(0.10, Math.min(0.95, faceBottom));

  // Top cut line: just above eyebrows.
  const t0r = Math.max(ft - 0.04, 0.04);
  const t0l = Math.max(0, Math.min(1, t0r + SLOPE));

  // Bottom cut line: just below chin, minimum band height 0.22.
  const b0r = Math.min(Math.max(fb + 0.04, t0r + 0.22), 0.85);
  const b0l = Math.max(0, Math.min(1, b0r + SLOPE));

  return {
    r0: `polygon(0 ${pct(t0l)}, 100% ${pct(t0r)}, 100% ${pct(b0r)}, 0 ${pct(b0l)})`,
    r1: `polygon(0 0, 100% 0, 100% ${pct(t0r + OVERLAP)}, 0 ${pct(t0l + OVERLAP)})`,
    r2: `polygon(0 ${pct(b0l - OVERLAP)}, 100% ${pct(b0r - OVERLAP)}, 100% 100%, 0 100%)`,
  };
}
