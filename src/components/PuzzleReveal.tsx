import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

const MODES = [
  { id: 'flat', label: '原画 2D' },
  { id: 'float', label: '悬浮相片' },
  { id: 'layers', label: '景深层叠' },
  { id: 'lens', label: '弧面透镜' },
] as const;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Props {
  src: string; width: number; height: number; matWidth: number;
  roundId: string; active: boolean; disabled: boolean; onReady: (roundId: string) => void;
}

/** A single-image depth treatment: no extra image generation or network requests. */
export function PuzzleReveal({ src, width, height, matWidth, roundId, active, disabled, onReady }: Props) {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState(1);
  const [flipping, setFlipping] = useState(false);
  const [turn, setTurn] = useState({ key: 0, direction: 1 });
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLButtonElement>(null);
  const timers = useRef<number[]>([]);
  const viewed = useRef(false);
  const focused = useRef(false);
  const turning = useRef(false);
  const extent = Math.min(matWidth * (matWidth < 600 ? 0.6 : 0.68), 820);
  const scale = extent / Math.max(width, height);

  useEffect(() => {
    const timer = window.setTimeout(() => { setReady(true); onReady(roundId); }, reducedMotion() ? 0 : 950);
    return () => window.clearTimeout(timer);
  }, [roundId, onReady]);

  useEffect(() => {
    if (!active || viewed.current) return;
    const timer = window.setTimeout(() => {
      viewed.current = true;
      card.current?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'instant' : 'smooth' });
    }, reducedMotion() ? 0 : 150);
    return () => window.clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    if (ready && active && !focused.current) { focused.current = true; card.current?.focus({ preventScroll: true }); }
  }, [ready, active]);

  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);

  const resetPointer = useCallback(() => {
    const style = root.current?.style;
    for (const name of ['--tilt-x', '--tilt-y']) style?.setProperty(name, '0deg');
    for (const name of ['--pan-x', '--pan-y']) style?.setProperty(name, '0px');
    style?.setProperty('--focus-x', '50%'); style?.setProperty('--focus-y', '50%');
  }, []);

  const updatePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!ready || event.pointerType === 'touch' || reducedMotion() || !card.current) return;
    const bounds = card.current.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
    const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
    const style = root.current!.style;
    style.setProperty('--tilt-x', `${-y * 7}deg`); style.setProperty('--tilt-y', `${x * 11}deg`);
    style.setProperty('--pan-x', `${x * 8}px`); style.setProperty('--pan-y', `${y * 8}px`);
    style.setProperty('--focus-x', `${50 + x * 28}%`); style.setProperty('--focus-y', `${50 + y * 28}%`);
  };

  const flip = (next: number, direction = 1) => {
    if (!ready || disabled || turning.current || next === mode) return;
    resetPointer();
    if (reducedMotion()) { setMode(next); return; }
    turning.current = true; setFlipping(true); setTurn((previous) => ({ key: previous.key + 1, direction }));
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [
      window.setTimeout(() => setMode(next), 320),
      window.setTimeout(() => { turning.current = false; setFlipping(false); }, 680),
    ];
  };

  return <div ref={root} className='puzzle-reveal' data-phase={ready ? 'ready' : 'centering'} data-mode={MODES[mode].id} data-flipping={flipping} onPointerMove={updatePointer} onPointerLeave={resetPointer} style={{ '--reveal-scale': scale, '--flip-direction': turn.direction } as CSSProperties}>
    <div className='puzzle-reveal-aura' aria-hidden='true' />
    <div className='puzzle-reveal-presentation' style={{ width, height }}>
      <button ref={card} type='button' className='puzzle-reveal-card' disabled={disabled || !ready} aria-label={`切换视差效果，当前：${MODES[mode].label}`} aria-describedby={`${roundId}-reveal-help`} onClick={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); flip((mode + 1) % MODES.length, event.detail && event.clientX < bounds.left + bounds.width / 2 ? -1 : 1); }} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); flip((mode + (event.key === 'ArrowLeft' ? 3 : 1)) % MODES.length, event.key === 'ArrowLeft' ? -1 : 1); } }}>
        <span key={turn.key} className='puzzle-reveal-page' data-turning={flipping}>
          <span className='puzzle-reveal-tilt'>
            <span className='puzzle-reveal-edge puzzle-reveal-edge-back' aria-hidden='true' />
            <span className='puzzle-reveal-edge puzzle-reveal-edge-front' aria-hidden='true' />
            <span className='puzzle-reveal-layer puzzle-reveal-layer-base'><img src={src} alt='拼图完成作品' draggable={false} /></span>
            <span className='puzzle-reveal-layer puzzle-reveal-layer-middle' aria-hidden='true'><img src={src} alt='' draggable={false} /></span>
            <span className='puzzle-reveal-layer puzzle-reveal-layer-front' aria-hidden='true'><img src={src} alt='' draggable={false} /></span>
            <span className='puzzle-reveal-layer puzzle-reveal-layer-lens' aria-hidden='true'><img src={src} alt='' draggable={false} /></span>
            <span className='puzzle-reveal-gloss' aria-hidden='true' />
          </span>
          <span className='puzzle-reveal-turn-light' aria-hidden='true' />
        </span>
      </button>
    </div>
    <div className='puzzle-reveal-caption'>
      <div className='puzzle-reveal-mode'><span>{mode ? '2.5D' : '2D'}</span><strong aria-live='polite'>{MODES[mode].label}</strong><small>{mode + 1} / {MODES.length}</small><button type='button' className='puzzle-reveal-toggle' disabled={!ready || disabled || flipping} onClick={() => flip(mode ? 0 : 1)}>{mode ? '切回 2D' : '开启 2.5D'}</button></div>
      <p id={`${roundId}-reveal-help`}>{mode ? '移动鼠标查看视差 · 左键翻页切换效果' : '欣赏完整原画 · 左键翻页开启视差'}</p>
    </div>
  </div>;
}
