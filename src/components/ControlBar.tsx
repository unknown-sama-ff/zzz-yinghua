import { useStore } from '../store/useStore';
import type { LayerPart } from '../types';

interface ControlBarProps {
  onToggle: (code: string) => void;
}

/**
 * Left vertical control bar — 6 cartridge-style buttons (01..06) split into two
 * STAGE groups of three. Mirrors the 六种样式 reference layout.
 */
export function ControlBar({ onToggle }: ControlBarProps) {
  const { parts, setAllParts, setStageVisible } = useStore();
  const stage1 = parts.filter((p) => p.stage === 1);
  const stage2 = parts.filter((p) => p.stage === 2);

  return (
    <div className="flex w-20 flex-shrink-0 flex-col items-center gap-3 py-4 sm:w-24">
      <button
        onClick={() => setAllParts(true)}
        className="font-mono text-[10px] tracking-widest text-zzz-cyan hover:text-zzz-text"
      >
        ALL ON
      </button>

      <StageGroup parts={stage1} onToggle={onToggle} onStage={() => setStageVisible(1, !stage1.every((p) => p.visible))} />

      <div className="flex w-full items-center gap-1 py-1">
        <div className="h-px flex-1 bg-zzz-primary/50" />
        <span className="font-mono text-[10px] tracking-[0.3em] text-zzz-primary">STAGE</span>
        <div className="h-px flex-1 bg-zzz-primary/50" />
      </div>

      <StageGroup parts={stage2} onToggle={onToggle} onStage={() => setStageVisible(2, !stage2.every((p) => p.visible))} />

      <button
        onClick={() => setAllParts(false)}
        className="font-mono text-[10px] tracking-widest text-zzz-muted hover:text-zzz-text"
      >
        ALL OFF
      </button>
    </div>
  );
}

function StageGroup({
  parts,
  onToggle,
  onStage,
}: {
  parts: LayerPart[];
  onToggle: (code: string) => void;
  onStage: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-2">
      {parts.map((p) => (
        <PartButton key={p.code} part={p} onToggle={onToggle} />
      ))}
      <button
        onClick={onStage}
        className="mt-0.5 font-mono text-[9px] tracking-widest text-zzz-muted hover:text-zzz-cyan"
      >
        STAGE ▢
      </button>
    </div>
  );
}

function PartButton({ part, onToggle }: { part: LayerPart; onToggle: (code: string) => void }) {
  const active = part.visible;
  return (
    <button
      onClick={() => onToggle(part.code)}
      aria-pressed={active}
      aria-label={`部分 ${part.code} ${active ? '已显示' : '已隐藏'}`}
      className="group relative h-12 w-full font-mono text-sm font-bold transition-all duration-200"
      style={{
        clipPath: 'polygon(0 0, 100% 0, 100% 70%, 85% 100%, 0 100%)',
        background: active ? 'color-mix(in srgb, var(--zzz-primary) 30%, var(--zzz-ink))' : 'var(--zzz-ink)',
        border: `1px solid ${active ? 'var(--zzz-primary)' : 'color-mix(in srgb, var(--zzz-muted) 60%, transparent)'}`,
        boxShadow: active ? 'var(--zzz-shadow)' : 'none',
        color: active ? 'var(--zzz-text)' : 'var(--zzz-muted)',
      }}
    >
      {part.code}
      {active && (
        <span
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full"
          style={{ background: 'var(--zzz-cyan)', boxShadow: '0 0 6px var(--zzz-cyan)' }}
        />
      )}
    </button>
  );
}
