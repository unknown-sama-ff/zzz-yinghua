import { useCallback, useEffect, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import { useLightboxStore } from '../store/useLightboxStore';

const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.12;

/**
 * Global image lightbox. Mounted once in App; driven by useLightboxStore.
 *
 * The picture sits centred at ~3/4 of the viewport, everything around it is a
 * translucent charcoal scrim. The wheel zooms further in/out anchored at the
 * cursor, and once zoomed past 1x the image can be dragged to pan.
 */
export const ImageLightbox = memo(function ImageLightbox() {
  const src = useLightboxStore((s) => s.src);
  const alt = useLightboxStore((s) => s.alt);
  const fallbackSrc = useLightboxStore((s) => s.fallbackSrc);
  const close = useLightboxStore((s) => s.close);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [useFallback, setUseFallback] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  // Live mirrors of scale/offset so the native wheel handler (bound once) always
  // reads current values without being re-attached on every zoom tick.
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; originX: number; originY: number }>(
    { active: false, startX: 0, startY: 0, originX: 0, originY: 0 },
  );

  const applyScale = useCallback((next: number, cursorX: number, cursorY: number) => {
    const current = scaleRef.current;
    let clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
    // Snap near-1 back to exactly 1: repeated multiply/divide by ZOOM_STEP never
    // returns to 1.0 exactly, so without this the recentre below never fires.
    if (Math.abs(clamped - 1) < 0.02) clamped = 1;
    if (clamped === current) return;
    if (clamped === 1) {
      // Back to the natural fit — recentre so the image can't be left stranded.
      scaleRef.current = 1;
      offsetRef.current = { x: 0, y: 0 };
      setScale(1);
      setOffset({ x: 0, y: 0 });
      return;
    }
    // Keep the pixel under the cursor fixed: the point's untransformed position
    // is (cursor - offset) / scale, so the new offset must satisfy
    // cursor = offset' + point * scale'.
    const ratio = clamped / current;
    const { x, y } = offsetRef.current;
    const nextOffset = {
      x: cursorX - (cursorX - x) * ratio,
      y: cursorY - (cursorY - y) * ratio,
    };
    scaleRef.current = clamped;
    offsetRef.current = nextOffset;
    setScale(clamped);
    setOffset(nextOffset);
  }, []);

  // Reset the view whenever a different image is opened.
  useEffect(() => {
    scaleRef.current = 1;
    offsetRef.current = { x: 0, y: 0 };
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setUseFallback(false);
  }, [src]);

  // Wheel zoom. Registered natively with { passive: false } because React 18
  // attaches its own wheel listener passively at the root, which silently drops
  // preventDefault() and lets the page scroll behind the overlay.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el || !src) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left - rect.width / 2;
      const cursorY = e.clientY - rect.top - rect.height / 2;
      applyScale(scaleRef.current * (e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP), cursorX, cursorY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [src, applyScale]);

  // Esc to dismiss.
  useEffect(() => {
    if (!src) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [src, close]);

  // Lock background scrolling while open, restoring whatever was there before.
  useEffect(() => {
    if (!src) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [src]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    if (e.button !== 0 || scaleRef.current <= 1) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      originX: offsetRef.current.x,
      originY: offsetRef.current.y,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const next = { x: drag.originX + (e.clientX - drag.startX), y: drag.originY + (e.clientY - drag.startY) };
    offsetRef.current = next;
    setOffset(next);
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }, []);

  if (!src) return null;

  const displaySrc = useFallback && fallbackSrc ? fallbackSrc : src;

  return createPortal(
    <div
      ref={overlayRef}
      // Above every other floating layer: the free-create window sits at
      // z-[10002] and the cursor-effect overlays at z-[10000]/z-[10001].
      className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      // Only a click that landed on the scrim itself dismisses. A pan gesture
      // that happens to end over the scrim still reports the image as its
      // target (pointer capture), so dragging never closes by accident.
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <img
        src={displaySrc}
        alt={alt}
        draggable={false}
        onError={() => setUseFallback(true)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="max-h-[75vh] max-w-[75vw] select-none object-contain"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          cursor: scale > 1 ? 'grab' : 'default',
          touchAction: 'none',
        }}
      />

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); close(); }}
        aria-label="关闭大图"
        className="glass-btn absolute right-4 top-4 px-3 py-1.5 font-mono text-sm text-zzz-text"
      >
        ✕
      </button>

      <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-[11px] text-zzz-text/45">
        滚轮缩放 · {Math.round(scale * 100)}%{scale > 1 ? ' · 可拖动' : ''} · Esc 关闭
      </p>
    </div>,
    document.body,
  );
});

/**
 * The single entry point for opening the lightbox. Sits absolutely positioned
 * inside an image's container (which needs `relative`).
 *
 * Deliberately always visible rather than tucked into a `group-hover` toolbar —
 * hover toolbars never appear on touch devices, which would leave phone users
 * with no way to enlarge anything. Top-left because several containers already
 * put a clear/remove ✕ at top-right.
 */
export const ZoomButton = memo(function ZoomButton({
  src,
  alt,
  fallbackSrc,
  compact = false,
  className = 'left-1 top-1',
}: {
  src: string;
  alt?: string;
  fallbackSrc?: string;
  /** Icon-only styling for thumbnails too small for a text label. */
  compact?: boolean;
  /** Positioning overrides; defaults to the container's top-left corner. */
  className?: string;
}) {
  const open = useLightboxStore((s) => s.open);
  return (
    <button
      type="button"
      title="点击放大查看"
      aria-label="放大查看"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        open(src, alt, fallbackSrc);
      }}
      className={`glass-btn absolute z-10 font-mono opacity-60 transition-opacity hover:opacity-100 ${
        compact ? 'px-1 py-0 text-[10px]' : 'px-2 py-0.5 text-[10px]'
      } text-zzz-text ${className}`}
    >
      {compact ? '⤢' : '⤢ 放大'}
    </button>
  );
});
