import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { ROUTE_HASHES } from '../lib/navigation';
import { createPuzzlePieces, puzzlePiecePath, type PuzzleLayout } from '../lib/puzzle';
import '../styles/home-features.css';

const modes = ['原画 2D', '悬浮相片', '2.5D视觉'] as const;
const layers = [
  { name: '背景', src: '/作品示例/mermaid-demo-background.webp' },
  { name: '角色与配饰', src: '/作品示例/mermaid-demo-subject.webp' },
];
const original = '/作品示例/mermaid-demo-original.webp';
const pieceLayout: PuzzleLayout = { width: 941, height: 1672, image: { width: 941, height: 1672 }, cellWidth: 941 / 3, cellHeight: 1672 / 5, padding: 64, margin: 0 };
const pieces = createPuzzlePieces({ rows: 5, columns: 3 }, () => .7);
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function PuzzleFragments() {
  const id = useId();
  const { cellWidth, cellHeight, padding } = pieceLayout;
  return <div className="feature-puzzle-pieces" aria-hidden="true">
    {pieces.map((piece) => {
      const path = puzzlePiecePath(piece, pieceLayout);
      const clip = `${id}-piece-${piece.id}`;
      const style = {
        left: `${(piece.col * cellWidth - padding) / 941 * 100}%`, top: `${(piece.row * cellHeight - padding) / 1672 * 100}%`,
        width: `${(cellWidth + padding * 2) / 941 * 100}%`, height: `${(cellHeight + padding * 2) / 1672 * 100}%`,
        '--piece-x': `${(piece.col - 1) * 60 + Math.sin(piece.id * 7) * 24}%`,
        '--piece-y': `${(piece.row - 2) * 20 + Math.cos(piece.id * 5) * 18}%`,
        '--piece-z': `${35 + piece.id % 4 * 18}px`, '--piece-turn': `${Math.sin(piece.id * 3 + 1) * 19}deg`,
      } as CSSProperties;
      return <svg key={piece.id} className="feature-puzzle-piece" style={style} viewBox={`0 0 ${cellWidth + padding * 2} ${cellHeight + padding * 2}`}>
        <defs><clipPath id={clip}><path d={path} /></clipPath></defs>
        <g clipPath={`url(#${clip})`}><image href={original} x={padding - piece.col * cellWidth} y={padding - piece.row * cellHeight} width="941" height="1672" /></g>
        <path className="feature-piece-seam" d={path} />
      </svg>;
    })}
  </div>;
}

export function HomeFeatures() {
  const [mode, setMode] = useState<(typeof modes)[number]>('2.5D视觉');
  const [showPieces, setShowPieces] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let request = 0;
    let visible = false;
    const update = () => {
      request = 0;
      const bounds = node.getBoundingClientRect();
      // The track stays in normal document flow; only the artwork pauses while pieces settle.
      const progress = reduced.matches ? 1 : clamp((window.innerHeight * .68 - bounds.top) / (window.innerHeight * 1.03));
      const settling = clamp(progress / .88);
      const eased = settling * settling * (3 - 2 * settling);
      node.style.setProperty('--scatter', String(1 - eased));
      node.style.setProperty('--art-opacity', String(clamp((progress - .84) / .13)));
      node.style.setProperty('--pieces-opacity', String(1 - clamp((progress - .93) / .07)));
      node.style.setProperty('--scroll-depth', `${reduced.matches ? 0 : (clamp((window.innerHeight - bounds.top) / (bounds.height + window.innerHeight)) - .5) * 36}px`);
      node.dataset.assembly = progress >= .99 ? 'complete' : progress <= .01 ? 'scattered' : 'assembling';
      node.style.setProperty('--assembly-progress', `${Math.round(progress * 100)}%`);
    };
    const schedule = () => { if (!request && visible) request = window.requestAnimationFrame(update); };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) { setShowPieces(true); schedule(); }
    }, { rootMargin: '150px' });
    observer.observe(node);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    reduced.addEventListener('change', update);
    update();
    return () => { observer.disconnect(); window.cancelAnimationFrame(request); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); reduced.removeEventListener('change', update); };
  }, []);
  const resetMotion = () => {
    for (const name of ['--demo-x', '--demo-y', '--demo-tilt-x', '--demo-tilt-y', '--demo-focus-x', '--demo-focus-y']) frame.current?.style.removeProperty(name);
  };

  return <section className="home-features" aria-labelledby="home-features-title">
    <div className="exhibition-section-heading">
      <div><p className="studio-eyebrow">WORKSHOP / PUZZLE</p><h2 id="home-features-title">美图拼图<span>.</span></h2></div>
      <p>向下滑动，把散落的美图拼完整</p>
    </div>
    <div className="feature-exhibit">
      <div ref={track} className="feature-scroll-track">
      <div className="feature-stage">
        <div className={`feature-portrait ${mode === '2.5D视觉' ? 'is-layered' : mode === '悬浮相片' ? 'is-floating' : 'is-flat'}`}
          onPointerMove={(event) => {
            if (mode === '原画 2D' || event.pointerType === 'touch' || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !frame.current) return;
            const bounds = frame.current.getBoundingClientRect();
            const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
            const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
            const style = frame.current.style;
            style.setProperty('--demo-x', `${x * 14}px`); style.setProperty('--demo-y', `${y * 14}px`);
            style.setProperty('--demo-tilt-x', `${-y * 6}deg`); style.setProperty('--demo-tilt-y', `${x * 9}deg`);
            style.setProperty('--demo-focus-x', `${50 + x * 30}%`); style.setProperty('--demo-focus-y', `${50 + y * 30}%`);
          }}
          onPointerLeave={resetMotion} onPointerCancel={resetMotion}>
          <div ref={frame} className="feature-portrait-frame">
            <div className="feature-portrait-art" role="img" aria-label="晶莹海境中的人鱼乐章，完整呈现长发、鱼尾、薄纱鳍和配饰">
              {mode === '2.5D视觉' ? layers.map((layer) => <img key={layer.name} src={layer.src} alt="" width="941" height="1672" loading="lazy" decoding="async" />)
                : <img src={original} alt="" width="941" height="1672" loading="lazy" decoding="async" />}
            </div>
            {showPieces && <PuzzleFragments />}
          </div>
        </div>
        <div className="feature-assembly-caption"><span>散落成片</span><span className="feature-assembly-line" aria-hidden="true" /><span>拼成一幅</span></div>
        <p className="feature-caption"><span className="feature-caption-pending">继续下滑，拼合后欣赏完整画面与分层视差。</span><span className="feature-caption-complete">已拼合 · 移动鼠标或继续滑动，欣赏画面层次。</span></p>
        <button type="button" className="feature-skip-assembly" onClick={() => {
          if (!track.current) return;
          window.scrollTo({ top: track.current.getBoundingClientRect().top + window.scrollY + window.innerHeight * .36, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        }}>直接看完整画面 <span aria-hidden="true">↓</span></button>
      </div>
      </div>
      <div className="feature-copy">
        <p className="feature-kicker">MERMAID / LAYER STUDY</p>
        <h3>晶莹海境中的<br />人鱼乐章</h3>
        <p>从画廊轮换挑选美图，选择大、中、小拼块，用鼠标、触屏或键盘自由拼接。完成后放大欣赏，在三种展示模式间切换。</p>
        <div className="feature-mode-block">
          <p className="feature-mode-label">切换展示模式</p>
          <div className="feature-demo-controls" role="group" aria-label="拼图展示模式">
            {modes.map((item) => <button type="button" key={item} aria-pressed={mode === item} onClick={() => { resetMotion(); setMode(item); }}>{item}</button>)}
          </div>
          <p className="feature-mode-description">{mode === '2.5D视觉' ? '人鱼、长发、鱼尾、薄纱鳍与配饰整体留在主体层。移动鼠标时，背景与角色差速移动，呈现空间层次。' : mode === '悬浮相片' ? '移动鼠标，让整张相片随指针倾斜、浮动，查看相片边框、反光与投影的变化。' : '平面呈现完整原画。'}</p>
        </div>
        <dl className="feature-layer-guide">
          <div><dt>背景</dt><dd>位于角色后方的海水、光线与环境。</dd></div>
          <div><dt>主体</dt><dd>完整角色、身体部件、随身配饰和角色附带特效。</dd></div>
          <div><dt>前景</dt><dd>仅在存在明显位于角色前方的独立物体时分出。本图展示主体与背景两层。</dd></div>
        </dl>
        <a className="studio-text-link" href={ROUTE_HASHES.puzzle}>打开美图拼图 <span aria-hidden="true">↗</span></a>
      </div>
    </div>
  </section>;
}
