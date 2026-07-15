import { useInpaintStore } from '../store/useInpaintStore';

export function FloatingInpaintButton() {
  const isSelecting = useInpaintStore((s) => s.isSelecting);
  const setIsSelecting = useInpaintStore((s) => s.setIsSelecting);

  return (
    <button
      onClick={() => setIsSelecting(!isSelecting)}
      className={`
        fixed bottom-6 left-6 z-50
        flex h-14 w-14 items-center justify-center
        rounded-full text-2xl
        backdrop-blur-md
        transition-all duration-300
        ${isSelecting
          ? 'bg-[var(--zzz-primary)] text-white shadow-[0_0_32px_var(--zzz-primary)] scale-110'
          : 'bg-[var(--zzz-ink)]/80 text-[var(--zzz-primary)] border border-[var(--zzz-text)]/20 hover:border-[var(--zzz-primary)]/60 hover:shadow-[0_0_20px_var(--zzz-primary)]'
        }
      `}
      title={isSelecting ? '取消选择' : '局部重绘'}
    >
      {isSelecting ? '✕' : '🎨'}
    </button>
  );
}
