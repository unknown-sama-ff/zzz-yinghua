import { useViewerStore } from '../store/useViewerStore';
import type { LayerPart } from '../types';
import { memo } from 'react';

interface ControlBarProps {
  onToggle: (code: string) => void;
  fullscreen?: boolean;
}

/**
 * Left vertical control bar — 6 cartridge-style buttons (01..06) split into two
 * STAGE groups of three. Mirrors the 六种样式 reference layout.
 */
export const ControlBar = memo(function ControlBar({ onToggle, fullscreen }: ControlBarProps) {
  const parts = useViewerStore((s) => s.parts);
  const setAllParts = useViewerStore((s) => s.setAllParts);
  const setStageVisible = useViewerStore((s) => s.setStageVisible);
  const stage1 = parts.filter((p) => p.stage === 1);
  const stage2 = parts.filter((p) => p.stage === 2);
  const allOn = parts.every((p) => p.visible);
  // Only mobile fullscreen shrinks the control bar (narrow landscape screen);
  // desktop fullscreen keeps full-size buttons.
  const isMobile = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const compact = Boolean(fullscreen && isMobile);

  return (
    <div className={`flex flex-shrink-0 items-center ${compact ? 'w-12 flex-col justify-start gap-0.5 px-0.5 py-1' : 'w-full flex-row flex-wrap justify-center gap-2 py-2 md:w-20 md:flex-col md:flex-nowrap md:justify-start md:gap-3 md:py-4 sm:md:w-24'}`}>
      {/* Single toggle: flips all six parts on/off based on current state. */}
      <button
        onClick={() => setAllParts(!allOn)}
        aria-pressed={allOn}
        className={`glass-btn w-full font-mono tracking-widest text-zzz-text ${compact ? 'py-0.5 text-[7px]' : 'py-1.5 text-[10px]'}`}
      >
        {allOn ? 'ALL OFF' : 'ALL ON'}
      </button>

      <StageGroup
        parts={stage1}
        onToggle={onToggle}
        onStage={() => setStageVisible(1, !stage1.every((p) => p.visible))}
        compact={compact}
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
        compact={compact}
      />
    </div>
  );
});

const StageGroup = memo(function StageGroup({
  parts,
  onToggle,
  onStage,
  compact,
}: {
  parts: LayerPart[];
  onToggle: (code: string) => void;
  onStage: () => void;
  compact?: boolean;
}) {
  const allVisible = parts.every((p) => p.visible);
  return (
    <div className="flex w-full flex-col gap-2">
      {parts.map((p) => (
        <PartButton key={p.code} part={p} onToggle={onToggle} compact={compact} />
      ))}
      <button
        onClick={onStage}
        aria-pressed={allVisible}
        data-active={allVisible}
        className={`glass-btn w-full font-mono tracking-widest text-zzz-text ${compact ? 'h-4 text-[7px]' : 'h-7 text-[10px]'}`}
      >
        STAGE
      </button>
    </div>
  );
});

const PartButton = memo(function PartButton({ part, onToggle, compact }: { part: LayerPart; onToggle: (code: string) => void; compact?: boolean }) {
  const active = part.visible;
  return (
    <button
      onClick={() => onToggle(part.code)}
      aria-pressed={active}
      aria-label={`部分 ${part.code} ${active ? '已显示' : '已隐藏'}`}
      data-active={active}
      className={`glass-btn group relative w-full font-bold text-zzz-text ${compact ? 'h-6 text-[9px]' : 'h-12 font-mono text-sm'}`}
    >
      <span className={active ? 'text-zzz-text' : 'text-zzz-text/50'}>{part.code}</span>
      {active && (
        <span
          className={`absolute rounded-full ${compact ? 'right-1 top-1 h-1 w-1' : 'right-1.5 top-1.5 h-1.5 w-1.5'}`}
          style={{ background: 'var(--zzz-cyan)', boxShadow: '0 0 6px var(--zzz-cyan)' }}
        />
      )}
    </button>
  );
});
