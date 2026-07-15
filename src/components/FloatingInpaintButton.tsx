import { memo } from 'react';
import { useInpaintStore } from '../store/useInpaintStore';

export const FloatingInpaintButton = memo(function FloatingInpaintButton() {
  const isSelecting = useInpaintStore((s) => s.isSelecting);
  const setIsSelecting = useInpaintStore((s) => s.setIsSelecting);

  return (
    <button
      onClick={() => setIsSelecting(!isSelecting)}
      className={`
        fixed bottom-6 left-6 z-50
        flex h-10 items-center gap-2 rounded-full px-4
        font-mono text-xs font-medium tracking-wide
        backdrop-blur-md
        transition-all duration-300
        ${isSelecting
          ? 'bg-[var(--zzz-primary)] text-white shadow-[0_0_32px_var(--zzz-primary)] scale-110'
          : 'bg-[var(--zzz-ink)]/80 text-[var(--zzz-primary)] border border-[var(--zzz-text)]/20 hover:border-[var(--zzz-primary)]/60 hover:shadow-[0_0_20px_var(--zzz-primary)]'
        }
      `}
      title={isSelecting ? '取消选择' : '局部重绘'}
    >
      {isSelecting ? (
        <>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          <span>取消选择</span>
        </>
      ) : (
        <>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19l7-7 3 3-7 7-3-3z" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
            <path d="M2 2l7.586 7.586" />
            <circle cx="11" cy="11" r="2" />
          </svg>
          <span>局部重绘</span>
        </>
      )}
    </button>
  );
});
