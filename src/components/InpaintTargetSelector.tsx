import { useCallback, useEffect, useLayoutEffect, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import { useInpaintStore } from '../store/useInpaintStore';
import { resolveInpaintTarget } from '../lib/inpaintTarget';
import { FloatingInpaintButton } from './FloatingInpaintButton';

/** Portal clones of inpaintable images, positioned exactly over the originals,
 *  floating above the blur overlay so they stay crystal clear. */
const InpaintPortal = memo(function InpaintPortal({ onSelect }: { onSelect: (t: { url: string; type: string }) => void }) {
  const [clones, setClones] = useState<{ id: string; src: string; rect: DOMRect; zone: string }[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const rafRef = useRef<number>(0);
  // Cache the last serialized clone state so we can skip React updates when
  // nothing actually moved (cheap string compare vs. re-rendering portal).
  const lastSnapshotRef = useRef<string>('');
  // Settle timer: after active scrolling stops, one full reconcile re-measures
  // positions, mounts clones for images that entered the viewport, and updates
  // React state. During the scroll itself a cheap direct-DOM hot path
  // (moveClones) follows every frame, so no 120ms idle wait is needed.
  const settleRef = useRef<ReturnType<typeof setTimeout>>();
  // Periodic re-scan catches images added after selection began (e.g. a
  // generation finishing while selection mode is active).
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  // Cache of the source <img> elements for the hot path. Building it once per
  // reconcile (not per scroll tick) avoids the expensive querySelectorAll
  // traversal of module 02's deep costume-history DOM on every frame.
  const imgCacheRef = useRef<{ id: string; src: string; zone: string; img: HTMLImageElement }[]>([]);
  // id -> mounted clone div, so the hot loop is a pure Map.get (no per-frame
  // querySelector or attribute lookup). Refilled by the clone ref-callbacks.
  const cloneDivsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  const updateClones = useCallback(() => {
    // Query each zone's descendant images directly, avoiding the per-image
    // closest() DOM traversal. Module 02's deep costume history nesting
    // makes closest() expensive on every scroll tick.
    const zones = document.querySelectorAll('[data-inpaint-zone]');
    const newClones: { id: string; src: string; rect: DOMRect; zone: string }[] = [];
    // Full (pre-cap) list of scanned images, cached for the scroll hot path.
    const nextCache: { id: string; src: string; zone: string; img: HTMLImageElement }[] = [];

    zones.forEach((zone) => {
      const zoneType = zone.getAttribute('data-inpaint-zone') || 'unknown';
      const imgs = zone.querySelectorAll('img');
      imgs.forEach((img, i) => {
        const imageEl = img as HTMLImageElement;
        if (imageEl.hasAttribute('data-no-inpaint')) return;
        // Nested zones (module 02 contains its costume submodule) belong only
        // to their nearest owner; otherwise the portal would clone them twice.
        if (imageEl.closest('[data-inpaint-zone]') !== zone) return;
        const rect = imageEl.getBoundingClientRect();
        if (rect.width <= 10 || rect.height <= 10) return;
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        if (rect.right < 0 || rect.left > window.innerWidth) return;
        if (!imageEl.src) return;
        const id = `${zoneType}-${i}-${imageEl.src.slice(-20)}`;
        nextCache.push({ id, src: imageEl.src, zone: zoneType, img: imageEl });
        newClones.push({
          id,
          src: imageEl.src,
          rect,
          zone: zoneType,
        });
      });
    });

    // Cache every scanned image (including ones the cap drops) so the hot path
    // can position any mounted clone, and dropped images can be tracked too.
    imgCacheRef.current = nextCache;

    // Hard cap visible glow clones to avoid compositing overload on pages
    // with many inpaintable images (e.g. module 02's costume history list).
    // 6 is enough to show the selection affordance without killing perf.
    if (newClones.length > 6) {
      // Sort by area (largest first) so the most prominent images get glow.
      newClones.sort((a, b) =>
        (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height)
      );
      newClones.length = 6;
    }

    // Only trigger a React update if the visible set actually changed.
    // Serializing rects to a string is cheap; skipping setState avoids
    // re-rendering the portal (and its CSS animations) for no reason.
    const snapshot = newClones.map(c =>
      `${c.id}|${c.src.length}|${Math.round(c.rect.left)}:${Math.round(c.rect.top)}:${Math.round(c.rect.width)}:${Math.round(c.rect.height)}|${c.zone}`
    ).join(';');
    if (snapshot !== lastSnapshotRef.current) {
      lastSnapshotRef.current = snapshot;
      setClones(newClones);
    }
  }, []);

  // Real-time scroll following: on every animation frame while scrolling, read
  // the cached source-image rects and write positions DIRECTLY onto the
  // already-mounted clone divs (no React state, no DOM re-query, no
  // reconciliation of the animated clones). getBoundingClientRect is cheap on
  // the shallow cached set; writing left/top does not collide with the
  // transform-only glow-pulse animation. The 150ms settle reconcile then does
  // one corrective measure after the scroll stops.
  const moveClones = useCallback(() => {
    rafRef.current = 0;
    for (const { id, img } of imgCacheRef.current) {
      const div = cloneDivsRef.current.get(id);
      if (!div) continue;             // not mounted (cap/offscreen) — reconciled below
      if (!img.isConnected) continue; // stale node — skip until reconcile
      const r = img.getBoundingClientRect();
      if (r.width <= 10 || r.height <= 10) { div.style.display = 'none'; continue; }
      div.style.display = '';
      div.style.left   = `${r.left}px`;
      div.style.top    = `${r.top}px`;
      div.style.width  = `${r.width}px`;
      div.style.height = `${r.height}px`;
    }
  }, []);

  // Sync clone positions on scroll/resize. Scroll events are captured on
  // window so BOTH the document scroll and module 02's nested costume
  // history scroller are heard. Positions follow every animation frame via
  // moveClones (cheap, direct DOM), then a short settle reconciles: re-measures
  // exact rects, mounts clones for images that entered the viewport, and
  // updates React state once — instead of every tick.
  useLayoutEffect(() => {
    updateClones();
    const onScroll = () => {
      // Real-time follow on the very next frame.
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(moveClones);
      // One corrective reconcile after scrolling has been idle for 150ms.
      clearTimeout(settleRef.current);
      settleRef.current = setTimeout(updateClones, 150);
    };
    const onResize = () => updateClones();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    // Re-scan periodically so images generated after selection began get glow.
    intervalRef.current = setInterval(updateClones, 2000);

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      clearTimeout(settleRef.current);
      clearInterval(intervalRef.current);
      cancelAnimationFrame(rafRef.current);
    };
  }, [updateClones, moveClones]);

  // Reposition newly mounted clones (e.g. after a reconcile swap or resize
  // re-render) even when the user isn't mid-scroll. No-op if all ids are
  // already mounted, so this stays cheap on every combination change.
  useLayoutEffect(() => {
    requestAnimationFrame(moveClones);
  }, [clones, moveClones]);

  if (clones.length === 0) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] pointer-events-none">
      {clones.map((clone) => (
        <div
          key={clone.id}
          ref={(el) => (el ? cloneDivsRef.current.set(clone.id, el) : cloneDivsRef.current.delete(clone.id))}
          data-inpaint-portal={clone.id}
          className={`absolute rounded-xl overflow-hidden ${clone.id === hoveredId ? 'inpaint-portal-clone-hovered' : ''}`}
          style={{
            left: clone.rect.left,
            top: clone.rect.top,
            width: clone.rect.width,
            height: clone.rect.height,
            // Static glow shadow (painted once, no animation cost) using the
            // peak (50%) state of the former animated shadow.
            boxShadow: '0 16px 40px rgba(0,0,0,0.7), 0 4px 14px rgba(0,0,0,0.4), 0 0 20px var(--zzz-primary), 0 0 40px color-mix(in srgb, var(--zzz-primary) 90%, transparent), 0 0 72px color-mix(in srgb, var(--zzz-primary) 55%, transparent)',
            border: '2px solid color-mix(in srgb, var(--zzz-primary) 60%, transparent)',
            cursor: 'pointer',
            pointerEvents: 'auto',
            willChange: 'transform',
            animation: 'inpaint-glow-pulse 2s ease-in-out infinite',
            // Hovered clones pause the pulse and lock at the lifted state.
            ...(clone.id === hoveredId ? {
              animationPlayState: 'paused',
              zIndex: 110,
            } : {}),
          }}
          onMouseEnter={() => setHoveredId(clone.id)}
          onMouseLeave={() => setHoveredId(null)}
          onClick={(e) => {
            e.stopPropagation();
            onSelect({ url: clone.src, type: clone.zone });
          }}
        >
          <img
            src={clone.src}
            alt=""
            className="w-full h-full object-contain"
            draggable={false}
          />
          {/* Corner particles */}
          <span
            className="absolute -top-1 -right-1 text-xs pointer-events-none"
            style={{
              color: 'var(--zzz-primary)',
              textShadow: '0 0 6px var(--zzz-primary)',
              animation: 'inpaint-particle-1 2s ease-in-out infinite',
            }}
          >
            ✦
          </span>
          <span
            className="absolute -bottom-1 -left-1 text-[10px] pointer-events-none"
            style={{
              color: 'var(--zzz-primary)',
              textShadow: '0 0 6px var(--zzz-primary)',
              animation: 'inpaint-particle-2 2.3s ease-in-out infinite 0.5s',
            }}
          >
            ✦
          </span>
        </div>
      ))}
    </div>,
    document.body,
  );
});

export const InpaintTargetSelector = memo(function InpaintTargetSelector({ children }: { children: React.ReactNode }) {
  const isSelecting = useInpaintStore((s) => s.isSelecting);
  const setIsSelecting = useInpaintStore((s) => s.setIsSelecting);
  const openWorkspace = useInpaintStore((s) => s.openWorkspace);
  const handleSelect = useCallback(
    (selection: { url: string; type: string }) => {
      openWorkspace(resolveInpaintTarget(selection.url, selection.type));
    },
    [openWorkspace],
  );

  // Toggle body class for CSS-driven effects during selection mode.
  // Disables backdrop-filter on background glass panels so the overlay's
  // backdrop-blur only composites simple flat colors (cheap), not recursively
  // blurred glass (extremely expensive on complex pages like module 02).
  useEffect(() => {
    document.body.classList.toggle('inpaint-select-active', isSelecting);
    return () => document.body.classList.remove('inpaint-select-active');
  }, [isSelecting]);

  // Intercept clicks on inpaintable images during selection mode
  useEffect(() => {
    if (!isSelecting) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const img = target.closest('img');
      if (!img) return;
      if ((img as HTMLElement).hasAttribute('data-no-inpaint')) return;
      const zone = img.closest('[data-inpaint-zone]') as HTMLElement | null;
      if (!zone) return;

      e.preventDefault();
      e.stopPropagation();

      const zoneType = zone.getAttribute('data-inpaint-zone') || 'unknown';
      const src = img.src || '';
      if (src) {
        handleSelect({ url: src, type: zoneType });
      }
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [isSelecting, handleSelect]);

  // Escape key to cancel
  useEffect(() => {
    if (!isSelecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSelecting(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isSelecting, setIsSelecting]);

  return (
    <div className="relative">
      {children}

      {/* Blur overlay: z-49, dims + blurs background. Using backdrop-blur (8px)
          instead of backdrop-blur-md (12px) to reduce Gaussian blur computation
          cost on dense pages like module 02, while keeping the selection-mode
          visual affordance. */}
      {isSelecting && (
        <div className="fixed inset-0 z-[49] bg-black/40 backdrop-blur pointer-events-none" />
      )}

      {/* Portal layer: z-100, clones of glowing images float above blur */}
      {isSelecting && (
        <InpaintPortal onSelect={handleSelect} />
      )}

      {/* Tooltip + floating button: z-70 */}
      {isSelecting && (
        <div className="fixed inset-0 z-[70] pointer-events-none">
          <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-auto">
            <div className="flex items-center gap-3 rounded-full border border-[var(--zzz-primary)]/40 bg-[var(--zzz-primary)]/15 px-5 py-2.5 backdrop-blur-md">
              <span className="font-mono text-sm text-[var(--zzz-text)]">
                ✨ 点击发光图片进入连续编辑 · 再次点击按钮或 Esc 取消
              </span>
            </div>
          </div>
        </div>
      )}

      <FloatingInpaintButton />
    </div>
  );
});
