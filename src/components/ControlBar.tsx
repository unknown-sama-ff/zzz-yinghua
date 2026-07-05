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
  const allOn = parts.every((p) => p.visible);

  return (
    <div className="flex w-full flex-shrink-0 flex-row flex-wrap items-center justify-center gap-2 py-2 md:w-20 md:flex-col md:flex-nowrap md:justify-start md:gap-3 md:py-4 sm:md:w-24">
      {/* Single toggle: flips all six parts on/off based on current state. */}
      <button
        onClick={() => setAllParts(!allOn)}
        aria-pressed={allOn}
        className="glass-btn w-full py-1.5 font-mono text-[10px] tracking-widest text-zzz-text"
      >
        {allOn ? 'ALL OFF' : 'ALL ON'}
      </button>

      <StageGroup
        parts={stage1}
        onToggle={onToggle}
        onStage={() => setStageVisible(1, !stage1.every((p) => p.visible))}
      />

      <div className="flex w-full items-center gap-1 py-1">
        <div className="h-px flex-1 bg-zzz-primary/50" />
        <span className="font-mono text-[10px] tracking-[0.3em] text-zzz-primary">STAGE</span>
        <div className="h-px flex-1 bg-zzz-primary/50" />
      </div>

      <StageGroup
        parts={stage2}
        onToggle={onToggle}
        onStage={() => setStageVisible(2, !stage2.every((p) => p.visible))}
      />
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
  const allVisible = parts.every((p) => p.visible);
  return (
    <div className="flex w-full flex-col gap-2">
      {parts.map((p) => (
        <PartButton key={p.code} part={p} onToggle={onToggle} />
      ))}
      {/* Same glass style as the part buttons, just smaller. */}
      <button
        onClick={onStage}
        aria-pressed={allVisible}
        data-active={allVisible}
        className="glass-btn h-7 w-full font-mono text-[10px] tracking-widest text-zzz-text"
      >
        STAGE
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
      data-active={active}
      className="glass-btn group relative h-12 w-full font-mono text-sm font-bold text-zzz-text"
    >
      <span className={active ? 'text-zzz-text' : 'text-zzz-text/50'}>{part.code}</span>
      {active && (
        <span
          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full"
          style={{ background: 'var(--zzz-cyan)', boxShadow: '0 0 6px var(--zzz-cyan)' }}
        />
      )}
    </button>
  );
}
