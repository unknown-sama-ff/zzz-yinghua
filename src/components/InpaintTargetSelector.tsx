import { useEffect } from 'react';
import { useInpaintStore } from '../store/useInpaintStore';
import { FloatingInpaintButton } from './FloatingInpaintButton';

export function InpaintTargetSelector({ children }: { children: React.ReactNode }) {
  const isSelecting = useInpaintStore((s) => s.isSelecting);
  const setIsSelecting = useInpaintStore((s) => s.setIsSelecting);
  const openWorkspace = useInpaintStore((s) => s.openWorkspace);

  // Toggle body class for CSS-driven glow/particle animations
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
      const zone = img.closest('[data-inpaint-zone]') as HTMLElement | null;
      if (!zone) return; // not in an inpaintable zone (e.g. gallery)

      e.preventDefault();
      e.stopPropagation();

      const zoneType = zone.getAttribute('data-inpaint-zone') || 'unknown';
      const src = img.src || '';
      if (src) {
        openWorkspace({ url: src, type: zoneType });
      }
    };

    // Use capture phase to intercept before overlay dismiss handler
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

      {/* Dark overlay is now handled by body::before in CSS (z-index: 49).
          Inpaintable images float above at z-index: 100, so they stay clear
          while everything else is blurred. */}
      {isSelecting && (
        <div className="fixed inset-0 z-[60] pointer-events-none">
          {/* Tooltip */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-auto">
            <div className="flex items-center gap-3 rounded-full border border-[var(--zzz-primary)]/40 bg-[var(--zzz-primary)]/15 px-5 py-2.5 backdrop-blur-md">
              <span className="font-mono text-sm text-[var(--zzz-text)]">
                🖌 点击发光图片进入重绘 · 再次点击按钮或 Esc 取消
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Floating button always on top */}
      <FloatingInpaintButton />
    </div>
  );
}
