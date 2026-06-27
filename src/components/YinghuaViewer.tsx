import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { ControlBar } from './ControlBar';
import { LayerSlots } from './LayerSlots';
import '../styles/viewer.css';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Section 3 — the ZZZ yinghua viewer. Stacked image layers controlled by the
 * 6-button bar; each toggle fires a programmatic transition (scanline sweep +
 * glitch + glow) over the stage. Honors prefers-reduced-motion.
 */
export function YinghuaViewer() {
  const { parts, togglePart, characterName } = useStore();
  const [sweeping, setSweeping] = useState(false);
  const [glitch, setGlitch] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    return () => timers.current.forEach((t) => clearTimeout(t));
  }, []);

  const handleToggle = useCallback(
    (code: string) => {
      togglePart(code);
      if (prefersReducedMotion()) return; // plain fade via CSS only

      // Fire the sweep + brief glitch shake, then clear.
      setSweeping(true);
      setGlitch(true);
      timers.current.push(
        window.setTimeout(() => setGlitch(false), 220),
        window.setTimeout(() => setSweeping(false), 440),
      );
    },
    [togglePart],
  );

  const name = (characterName || 'YINGHUA').toUpperCase();
  const hasAnySrc = parts.some((p) => p.src);

  return (
    <section className="zzz-panel zzz-clip overflow-hidden">
      <h2 className="zzz-heading border-b border-zzz-primary/20 p-4 text-lg text-zzz-primary">
        05 · 影画查看器
      </h2>

      <div className="flex">
        <ControlBar onToggle={handleToggle} />

        {/* Main stage */}
        <div
          ref={stageRef}
          className={`relative aspect-[4/5] flex-1 overflow-hidden bg-zzz-bg sm:aspect-video ${glitch ? 'fx-glitch' : ''}`}
        >
          {/* Oversized background name typography */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
            <span
              className="select-none whitespace-nowrap font-display font-bold leading-none text-zzz-primary/20"
              style={{ fontSize: 'clamp(4rem, 18vw, 14rem)', letterSpacing: '-0.02em' }}
            >
              {name}
            </span>
          </div>

          {/* Diagonal accent block */}
          <div
            className="pointer-events-none absolute -right-10 top-0 h-full w-1/3"
            style={{
              background: 'linear-gradient(135deg, transparent 40%, color-mix(in srgb, var(--zzz-magenta) 35%, transparent) 60%)',
              clipPath: 'polygon(30% 0, 100% 0, 100% 100%, 0 100%)',
            }}
          />

          {/* Stacked layers */}
          {parts.map((p) =>
            p.src ? (
              <img
                key={p.code}
                src={p.src}
                alt={`图层 ${p.code}`}
                data-visible={p.visible}
                className={`layer-part ${p.visible ? 'fx-enter' : 'fx-exit'}`}
                loading="lazy"
              />
            ) : null,
          )}

          {/* Transition sweep overlay */}
          {sweeping && <div className="fx-sweep" />}

          {/* Empty-state hint */}
          {!hasAnySrc && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="zzz-clip border border-zzz-primary/40 bg-zzz-ink/80 px-4 py-2 text-center font-mono text-xs text-zzz-muted">
                尚未分配图层 // 在下方为 6 个部分指定图片，
                <br />或在影画结果中点击「→ 查看器」
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Per-part source assignment */}
      <LayerSlots />
    </section>
  );
}
