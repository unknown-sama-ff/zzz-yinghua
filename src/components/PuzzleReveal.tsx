import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { forgetPuzzleLayers, getPuzzleLayers, type PuzzleLayers } from '../lib/puzzleLayers';

const MODES = [
  { id: 'flat', label: '原画 2D' },
  { id: 'float', label: '悬浮相片' },
  { id: 'layers', label: '主体分层' },
] as const;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Props {
  src: string; galleryId: string | number; width: number; height: number; matWidth: number; matHeight: number;
  roundId: string; active: boolean; disabled: boolean; onReady: (roundId: string) => void;
}

/** Real subject/background assets are prepared on the server and reused across rounds. */
export function PuzzleReveal({ src, galleryId, width, height, matWidth, matHeight, roundId, active, disabled, onReady }: Props) {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState(2);
  const [layers, setLayers] = useState<PuzzleLayers | null>(null);
  const [layerError, setLayerError] = useState('');
  const [layerLoading, setLayerLoading] = useState(false);
  const [layerAttempt, setLayerAttempt] = useState(0);
  const [flipping, setFlipping] = useState(false);
  const [turn, setTurn] = useState({ key: 0, direction: 1 });
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLButtonElement>(null);
  const timers = useRef<number[]>([]);
  const viewed = useRef(false);
  const focused = useRef(false);
  const turning = useRef(false);
  const scale = Math.min(Math.min(matWidth * 0.72, 820) / width, Math.max(80, matHeight - 160) / height);

  useEffect(() => {
    if (!ready || !active) return;
    let cancelled = false;
    setLayerLoading(true); setLayerError('');
    getPuzzleLayers(galleryId).then((result) => { if (!cancelled) setLayers(result); })
      .catch((error) => { if (!cancelled) { setLayers(null); setLayerError(error instanceof Error ? error.message : '这张图片暂时无法分层'); } })
      .finally(() => { if (!cancelled) setLayerLoading(false); });
    return () => { cancelled = true; };
  }, [ready, active, galleryId, layerAttempt]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setReady(true); onReady(roundId); }, reducedMotion() ? 0 : 950);
    return () => window.clearTimeout(timer);
  }, [roundId, onReady]);

  useEffect(() => {
    if (!active || viewed.current) return;
    const timer = window.setTimeout(() => {
      viewed.current = true;
      const bounds = card.current?.getBoundingClientRect();
      const headerBottom = document.querySelector('.studio-header')?.getBoundingClientRect().bottom ?? 0;
      if (bounds && (bounds.top < headerBottom || bounds.bottom > window.innerHeight)) card.current?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'instant' : 'smooth' });
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

  const layered = mode === 2 && Boolean(layers);
  const layerStatus = layers?.hasForeground
    ? '背景 · 主角 · 前景已分离，移动鼠标查看视差'
    : '背景与主角已分离，未检测到独立前景';
  const imageFailed = () => { setLayers(null); setLayerError('分层图片读取失败，原图仍可正常查看'); };
  return <div ref={root} className='puzzle-reveal' data-phase={ready ? 'ready' : 'centering'} data-mode={MODES[mode].id} data-layered={layered} data-depth-state={layers ? 'ready' : layerLoading ? 'loading' : layerError ? 'error' : 'idle'} data-flipping={flipping} onPointerMove={updatePointer} onPointerLeave={resetPointer} style={{ '--reveal-scale': scale, '--flip-direction': turn.direction } as CSSProperties}>
    <div className='puzzle-reveal-aura' aria-hidden='true' />
    <div className='puzzle-reveal-presentation' style={{ width, height }}>
      <button ref={card} type='button' className='puzzle-reveal-card' disabled={disabled || !ready} aria-label={`切换视差效果，当前：${MODES[mode].label}`} aria-describedby={`${roundId}-reveal-help`} onClick={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); flip((mode + 1) % MODES.length, event.detail && event.clientX < bounds.left + bounds.width / 2 ? -1 : 1); }} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); flip((mode + (event.key === 'ArrowLeft' ? MODES.length - 1 : 1)) % MODES.length, event.key === 'ArrowLeft' ? -1 : 1); } }}>
        <span key={turn.key} className='puzzle-reveal-page' data-turning={flipping}>
          <span className='puzzle-reveal-tilt'>
            <span className='puzzle-reveal-edge puzzle-reveal-edge-back' aria-hidden='true' />
            <span className='puzzle-reveal-edge puzzle-reveal-edge-front' aria-hidden='true' />
            <span className='puzzle-reveal-layer puzzle-reveal-layer-base'><img src={layered ? layers!.background : src} alt={layered ? '补全后的背景' : '拼图完成作品'} draggable={false} onError={layered ? imageFailed : undefined} /></span>
            {layered && <>
              <span className='puzzle-reveal-layer puzzle-reveal-layer-subject'><img src={layers!.subject} alt='分离出的主角' draggable={false} onError={imageFailed} /></span>
              <span className='puzzle-reveal-layer puzzle-reveal-layer-foreground'><img src={layers!.foreground} alt='分离出的近景' draggable={false} onError={imageFailed} /></span>
            </>}
            <span className='puzzle-reveal-gloss' aria-hidden='true' />
          </span>
          <span className='puzzle-reveal-turn-light' aria-hidden='true' />
        </span>
      </button>
    </div>
    {mode === 2 && ready && <div className='puzzle-layer-status' role='status'>
      {layerLoading ? '正在分析背景、主角与前景，先显示原图…' : layerError ? <>{layerError}<button type='button' disabled={disabled} onClick={() => { forgetPuzzleLayers(galleryId); setLayerAttempt((value) => value + 1); }}>重试分层</button></> : layers ? layerStatus : ''}
    </div>}
    <div className='puzzle-reveal-caption'>
      <div className='puzzle-reveal-mode'><span>{mode && (mode !== 2 || layers) ? '2.5D' : '2D'}</span><strong aria-live='polite'>{MODES[mode].label}</strong><small>{mode + 1} / {MODES.length}</small><button type='button' className='puzzle-reveal-toggle' disabled={!ready || disabled || flipping} onClick={() => flip(mode ? 0 : 2)}>{mode ? '切回 2D' : '开启 2.5D'}</button></div>
      <p id={`${roundId}-reveal-help`}>{mode ? '移动鼠标查看视差 · 左键翻页切换效果' : '欣赏完整原画 · 左键翻页开启视差'}</p>
    </div>
  </div>;
}
