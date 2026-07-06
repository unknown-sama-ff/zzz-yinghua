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
 *
 * WEDGE MODE: when the face occupies a large fraction of the frame (close-up/compact
 * composition), region-0's two cut lines are no longer parallel — the far edge
 * converges toward the near edge on one side, tapering the band from full width
 * down to a narrow point instead of a constant-width parallelogram.
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
  const WEDGE_THRESHOLD = 0.30;
  const WEDGE_GAP = 0.05;

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
    // Close-up composition (wide face) converges the right line's bottom point
    // toward the left line's bottom point, tapering region-0 into a wedge.
    const r0b = (fr - fl) > WEDGE_THRESHOLD
      ? Math.max(0, Math.min(1, l0b + WEDGE_GAP))
      : Math.max(0, Math.min(1, r0t + SLOPE_Y));

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
  // Close-up composition (tall face) converges the bottom line's left point
  // toward the top line's left point, tapering region-0 into a wedge.
  const b0l = (fb - ft) > WEDGE_THRESHOLD
    ? Math.max(0, Math.min(1, t0l + WEDGE_GAP))
    : Math.max(0, Math.min(1, b0r + SLOPE));

  return {
    r0: `polygon(0 ${pct(t0l)}, 100% ${pct(t0r)}, 100% ${pct(b0r)}, 0 ${pct(b0l)})`,
    r1: `polygon(0 0, 100% 0, 100% ${pct(t0r + OVERLAP)}, 0 ${pct(t0l + OVERLAP)})`,
    r2: `polygon(0 ${pct(b0l - OVERLAP)}, 100% ${pct(b0r - OVERLAP)}, 100% 100%, 0 100%)`,
  };
}
