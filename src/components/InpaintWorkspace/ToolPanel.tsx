import { useInpaintStore } from '../../store/useInpaintStore';

const TOOLS = [
  { key: 'brush' as const, icon: '🖌', label: '画笔 (B)', shortcut: 'B' },
  { key: 'eraser' as const, icon: '🧹', label: '橡皮 (E)', shortcut: 'E' },
  { key: 'rect' as const, icon: '⬜', label: '矩形 (R)', shortcut: 'R' },
] as const;

export function ToolPanel() {
  const mode = useInpaintStore((s) => s.mode);
  const tool = useInpaintStore((s) => s.tool);
  const setTool = useInpaintStore((s) => s.setTool);
  const undo = useInpaintStore((s) => s.undo);
  const clearMask = useInpaintStore((s) => s.clearMask);

  if (mode === 'smart') {
    return (
      <div className="flex w-16 flex-col items-center gap-3 py-4">
        <div className="font-mono text-[10px] text-[var(--zzz-text)]/40 text-center leading-tight">
          智能模式<br />无需涂抹
        </div>
        <div className="h-px w-8 bg-[var(--zzz-text)]/10" />
        <div className="font-mono text-[10px] text-[var(--zzz-text)]/30 text-center">
          切换到精准<br />模式后可用
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-16 flex-col items-center gap-2 py-4">
      {TOOLS.map((t) => (
        <button
          key={t.key}
          onClick={() => setTool(t.key)}
          className={`
            flex h-12 w-12 items-center justify-center rounded-xl text-xl
            transition-all duration-200
            ${tool === t.key
              ? 'bg-[var(--zzz-primary)]/20 border border-[var(--zzz-primary)]/60 text-[var(--zzz-primary)] shadow-[0_0_12px_var(--zzz-primary)]/30'
              : 'border border-transparent text-[var(--zzz-text)]/60 hover:border-[var(--zzz-text)]/20 hover:text-[var(--zzz-text)]'
            }
          `}
          title={`${t.label}`}
        >
          {t.icon}
        </button>
      ))}

      <div className="h-px w-8 bg-[var(--zzz-text)]/10 my-1" />

      <button
        onClick={undo}
        className="flex h-10 w-10 items-center justify-center rounded-xl text-sm text-[var(--zzz-text)]/60 border border-transparent hover:border-[var(--zzz-text)]/20 hover:text-[var(--zzz-text)] transition-all"
        title="撤销 (Ctrl+Z)"
      >
        ↩
      </button>

      <button
        onClick={clearMask}
        className="flex h-10 w-10 items-center justify-center rounded-xl text-sm text-[var(--zzz-magenta)]/70 border border-transparent hover:border-[var(--zzz-magenta)]/30 hover:text-[var(--zzz-magenta)] transition-all"
        title="清空涂抹"
      >
        🗑
      </button>
    </div>
  );
}
