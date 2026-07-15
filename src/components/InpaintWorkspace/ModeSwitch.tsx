import { useInpaintStore } from '../../store/useInpaintStore';

export function ModeSwitch() {
  const mode = useInpaintStore((s) => s.mode);
  const setMode = useInpaintStore((s) => s.setMode);
  const maskDataUrl = useInpaintStore((s) => s.maskDataUrl);

  const switchToPrecise = () => {
    if (!maskDataUrl) {
      // Show a hint but allow switching - the CanvasEditor will show the empty state
      setMode('precise');
    } else {
      setMode('precise');
    }
  };

  return (
    <div className="flex items-center gap-1 rounded-xl border border-[var(--zzz-text)]/10 bg-[var(--zzz-ink)]/50 p-1">
      <button
        onClick={() => setMode('smart')}
        className={`
          flex items-center gap-2 rounded-lg px-4 py-2 font-mono text-xs transition-all duration-200
          ${mode === 'smart'
            ? 'bg-[var(--zzz-primary)]/20 text-[var(--zzz-primary)] shadow-[0_0_8px_var(--zzz-primary)]/20'
            : 'text-[var(--zzz-text)]/50 hover:text-[var(--zzz-text)]/80'
          }
        `}
      >
        📝 智能重绘
      </button>
      <button
        onClick={switchToPrecise}
        className={`
          flex items-center gap-2 rounded-lg px-4 py-2 font-mono text-xs transition-all duration-200
          ${mode === 'precise'
            ? 'bg-[var(--zzz-primary)]/20 text-[var(--zzz-primary)] shadow-[0_0_8px_var(--zzz-primary)]/20'
            : 'text-[var(--zzz-text)]/50 hover:text-[var(--zzz-text)]/80'
          }
        `}
      >
        🎯 精准重绘
        {!maskDataUrl && mode === 'precise' && (
          <span className="text-[var(--zzz-magenta)]/80">· 请先涂抹</span>
        )}
      </button>
    </div>
  );
}
