import { useInpaintStore } from '../../store/useInpaintStore';
import { memo } from 'react';

const TOOLS = [
  { key: 'brush' as const, icon: '🖌', label: '画笔 (B)', shortcut: 'B' },
  { key: 'eraser' as const, icon: '🧽', label: '橡皮 (E)', shortcut: 'E' },
  { key: 'shape' as const, icon: '📐', label: '形状 (U)', shortcut: 'U' },
] as const;

const SHAPE_TYPES = [
  { key: 'rect' as const, icon: '▭', label: '矩形' },
  { key: 'ellipse' as const, icon: '⬭', label: '椭圆' },
  { key: 'circle' as const, icon: '◯', label: '圆形' },
] as const;

export const ToolPanel = memo(function ToolPanel() {
  const mode = useInpaintStore((s) => s.mode);
  const tool = useInpaintStore((s) => s.tool);
  const shapeType = useInpaintStore((s) => s.shapeType);
  const setTool = useInpaintStore((s) => s.setTool);
  const setShapeType = useInpaintStore((s) => s.setShapeType);
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

      {tool === 'shape' && (
        <>
          <div className="h-px w-8 bg-[var(--zzz-text)]/10" />
          {SHAPE_TYPES.map((st) => (
            <button
              key={st.key}
              onClick={() => setShapeType(st.key)}
              className={`
                flex h-10 w-10 items-center justify-center rounded-xl text-base
                transition-all duration-200
                ${shapeType === st.key
                  ? 'bg-[var(--zzz-primary)]/20 border border-[var(--zzz-primary)]/60 text-[var(--zzz-primary)] shadow-[0_0_12px_var(--zzz-primary)]/30'
                  : 'border border-transparent text-[var(--zzz-text)]/60 hover:border-[var(--zzz-text)]/20 hover:text-[var(--zzz-text)]'
                }
              `}
              title={st.label}
            >
              {st.icon}
            </button>
          ))}
        </>
      )}

      <div className="h-px w-8 bg-[var(--zzz-text)]/10 my-1" />

      <button
        onClick={() => {
          const canvas = window.__inpaintCanvas;
          if (canvas?.undo) canvas.undo();
        }}
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
});
