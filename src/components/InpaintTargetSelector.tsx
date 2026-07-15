import { useCallback, useEffect, useLayoutEffect, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import { useInpaintStore } from '../store/useInpaintStore';
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
  // Throttle scroll-triggered clone updates: during active scrolling we skip
  // expensive getBoundingClientRect + React re-renders. Updates only fire
  // after scrolling has been idle for 120ms, which is imperceptible for glow
  // clones but eliminates layout-thrash on dense pages like module 02.
  const scrollDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  const updateClones = useCallback(() => {
    // Query each zone's descendant images directly, avoiding the per-image
    // closest() DOM traversal. Module 02's deep costume history nesting
    // makes closest() expensive on every scroll tick.
    const zones = document.querySelectorAll('[data-inpaint-zone]');
    const newClones: { id: string; src: string; rect: DOMRect; zone: string }[] = [];

    zones.forEach((zone) => {
      const zoneType = zone.getAttribute('data-inpaint-zone') || 'unknown';
      const imgs = zone.querySelectorAll('img');
      imgs.forEach((img, i) => {
        const imageEl = img as HTMLImageElement;
        if (imageEl.hasAttribute('data-no-inpaint')) return;
        const rect = imageEl.getBoundingClientRect();
        if (rect.width <= 10 || rect.height <= 10) return;
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        if (rect.right < 0 || rect.left > window.innerWidth) return;
        if (!imageEl.src) return;
        newClones.push({
          id: `${zoneType}-${i}-${imageEl.src.slice(-20)}`,
          src: imageEl.src,
          rect,
          zone: zoneType,
        });
      });
    });

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

  // Sync clone positions on scroll/resize. Scroll updates are debounced
  // to avoid layout thrash on dense pages (module 02's scrollable costume
  // history fires many scroll ticks, each forcing synchronous layout via
  // getBoundingClientRect).
  useLayoutEffect(() => {
    updateClones();
    const onScroll = () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(scrollDebounceRef.current);
      scrollDebounceRef.current = setTimeout(() => {
        rafRef.current = requestAnimationFrame(updateClones);
      }, 120);
    };
    const onResize = () => updateClones();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      clearTimeout(scrollDebounceRef.current);
      cancelAnimationFrame(rafRef.current);
    };
  }, [updateClones]);

  if (clones.length === 0) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] pointer-events-none">
      {clones.map((clone) => (
        <div
          key={clone.id}
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
        openWorkspace({ url: src, type: zoneType });
      }
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [isSelecting, openWorkspace]);

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
        <InpaintPortal onSelect={openWorkspace} />
      )}

      {/* Tooltip + floating button: z-70 */}
      {isSelecting && (
        <div className="fixed inset-0 z-[70] pointer-events-none">
          <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-auto">
            <div className="flex items-center gap-3 rounded-full border border-[var(--zzz-primary)]/40 bg-[var(--zzz-primary)]/15 px-5 py-2.5 backdrop-blur-md">
              <span className="font-mono text-sm text-[var(--zzz-text)]">
                🖌 点击发光图片进入重绘 · 再次点击按钮或 Esc 取消
              </span>
            </div>
          </div>
        </div>
      )}

      <FloatingInpaintButton />
    </div>
  );
});
