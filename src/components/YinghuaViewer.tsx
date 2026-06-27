import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { ControlBar } from './ControlBar';
import '../styles/viewer.css';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Section 3 — the ZZZ yinghua viewer. Mirrors 六种样式/0~6.png:
 *  - 零命 (yinghua style 1) is the always-on base layer filling the stage.
 *  - 三命 (style 2) overlays on top, diagonally split into 3 regions → 01-03.
 *  - 六命 (style 3) overlays above that, split into 3 regions → 04-06.
 * Toggling a button reveals that diagonal region of the higher-tier image, so
 * the picture builds progressively from 零命 up to a full 六命, with a
 * programmatic transition (scanline sweep + glitch). Honors reduced-motion.
 */
export function YinghuaViewer() {
  const { parts, togglePart, characterName, yinghuaSlots } = useStore();
  const [sweeping, setSweeping] = useState(false);
  const [glitch, setGlitch] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    return () => timers.current.forEach((t) => clearTimeout(t));
  }, []);

  const handleToggle = useCallback(
    (code: string) => {
      togglePart(code);
      if (prefersReducedMotion()) return; // plain fade via CSS only
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

  // The three generated tiers; first image of each yinghua style slot.
  const tierImage = (id: 1 | 2 | 3): string | undefined => yinghuaSlots[id].images[0];
  const baseImg = tierImage(1); // 零命
  const hasBase = Boolean(baseImg);

  return (
    <section className="glass overflow-hidden">
      <h2 className="zzz-heading flex items-center gap-3 border-b border-zzz-text/10 p-4 text-lg text-zzz-text">
        <span className="step-badge">05</span>
        影画查看器
      </h2>

      <div className="flex">
        <ControlBar onToggle={handleToggle} />

        {/* Main stage */}
        <div
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

          {/* 零命 base layer — always visible when generated */}
          {baseImg && (
            <img src={baseImg} alt="零命 底图" className="layer-part" data-visible="true" loading="lazy" />
          )}

          {/* 三命 / 六命 diagonal regions, revealed per toggled button */}
          {parts.map((p) => {
            const src = tierImage(p.styleId);
            if (!src || !p.visible) return null;
            return (
              <img
                key={p.code}
                src={src}
                alt={`${p.styleId === 2 ? '三命' : '六命'} 区域 ${p.code}`}
                data-visible="true"
                className={`layer-part region-${p.region} fx-enter`}
                loading="lazy"
              />
            );
          })}

          {/* Transition sweep overlay */}
          {sweeping && <div className="fx-sweep" />}

          {/* Empty-state hint */}
          {!hasBase && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="glass px-4 py-2 text-center font-mono text-xs text-zzz-text/70">
                尚未生成影画 // 先在上方 04 模块生成三种风格
                <br />（零命=底图，三命/六命=按钮揭示的对角区域）
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-zzz-text/10 p-3 font-mono text-[11px] text-zzz-text/55">
        <span>零命 = 底图（始终显示）</span>
        <span>01–03 = 三命的三块对角区域</span>
        <span>04–06 = 六命的三块对角区域</span>
      </div>
    </section>
  );
}
