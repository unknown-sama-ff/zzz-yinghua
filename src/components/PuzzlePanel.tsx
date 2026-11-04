import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { GALLERY_SAVED_EVENT, type GalleryRow } from '../lib/galleryClient';
import { ROUTE_HASHES } from '../lib/navigation';
import { loadPuzzleGallery, loadPuzzleImage, pickPuzzleImage } from '../lib/puzzleGallery';
import { centerPuzzleGroup, createPuzzleGroups, createPuzzlePieces, piecePosition, positionPuzzleGroup, PUZZLE_DIFFICULTIES, puzzleGrid, puzzleLayout, puzzlePiecePath, reflowPuzzleGroups, snapPuzzleGroup, type PuzzleDifficulty, type PuzzleGrid, type PuzzleGroup, type PuzzleLayout, type PuzzlePiece } from '../lib/puzzle';
import { PuzzleReveal } from './PuzzleReveal';

interface Game {
  row: GalleryRow; src: string; width: number; height: number; layoutWidth: number; roundId: string;
  grid: PuzzleGrid; pieces: PuzzlePiece[]; groups: PuzzleGroup[];
}
interface Drag { groupId: number; pointerId: number; offsetX: number; offsetY: number; startX: number; startY: number; clientX: number; clientY: number; moved: boolean }
interface SnapEffect { key: number; pieceIds: number[]; point: { x: number; y: number } }

function freshGame(row: GalleryRow, image: { src: string; width: number; height: number }, difficulty: PuzzleDifficulty, width: number): Game {
  const grid = puzzleGrid(image.width, image.height, difficulty);
  const layout = puzzleLayout(width, image.width, image.height, grid);
  const pieces = createPuzzlePieces(grid);
  return { row, ...image, roundId: crypto.randomUUID(), layoutWidth: width, grid, pieces, groups: createPuzzleGroups(pieces, layout) };
}

export function PuzzlePanel({ active }: { active: boolean }) {
  const [game, setGame] = useState<Game | null>(null);
  const [difficulty, setDifficulty] = useState<PuzzleDifficulty>('easy');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [snapping, setSnapping] = useState<SnapEffect | null>(null);
  const [showcaseRound, setShowcaseRound] = useState<string | null>(null);
  const [width, setWidth] = useState(800);
  const mat = useRef<HTMLDivElement>(null);
  const gameRef = useRef(game);
  const widthRef = useRef(width);
  const difficultyRef = useRef(difficulty);
  const pool = useRef<Promise<GalleryRow[]> | null>(null);
  const request = useRef(0);
  const z = useRef(100);
  const snapKey = useRef(0);
  const drag = useRef<Drag | null>(null);
  const clipPrefix = useId().replace(/:/g, '');
  gameRef.current = game; widthRef.current = width;
  const layout = game ? puzzleLayout(width, game.width, game.height, game.grid) : null;
  const layoutRef = useRef<PuzzleLayout | null>(layout);
  layoutRef.current = layout;
  const complete = game?.groups.length === 1;
  const showcase = Boolean(game && showcaseRound === game.roundId);
  const connections = game ? game.pieces.length - game.groups.length : 0;
  const maxConnections = Math.max(1, (game?.pieces.length ?? 2) - 1);
  const membership = new Map(game?.groups.flatMap((group) => group.pieceIds.map((id) => [id, group] as const)));
  const groupCells = new Map(game?.groups.map((group) => [group.id, new Set(game.pieces.filter((piece) => group.pieceIds.includes(piece.id)).map((piece) => `${piece.row}:${piece.col}`))]));

  const commitGame = useCallback((next: Game) => { gameRef.current = next; setGame(next); }, []);
  const revealReady = useCallback((roundId: string) => setShowcaseRound(roundId), []);
  const draw = useCallback(async () => {
    const current = ++request.current;
    setLoading(true); setError(''); setNotice(''); setSnapping(null);
    drag.current = null; setDragging(null); setSelected(null);
    try {
      pool.current ??= loadPuzzleGallery();
      const rows = await pool.current;
      if (current !== request.current) return;
      const row = pickPuzzleImage(rows, gameRef.current?.row.image_url);
      if (!row) {
        pool.current = null;
        setError('图库里还没有可用的自由创作、动作底稿或海报版图片。先保存一幅作品，再来试试。');
        return;
      }
      const image = await loadPuzzleImage(row.image_url);
      if (current !== request.current) return;
      commitGame(freshGame(row, image, difficultyRef.current, widthRef.current));
      setShowGuide(false); z.current = 100;
      if (rows.length === 1) setNotice('图库目前只有一张符合条件的图片；换一张会重新打乱这幅拼图。');
    } catch (err) {
      if (current === request.current) { pool.current = null; setError(err instanceof Error ? err.message : '抽取图片失败，请重试。'); }
    } finally { if (current === request.current) setLoading(false); }
  }, [commitGame]);

  useEffect(() => {
    void draw();
    const invalidate = () => { pool.current = null; };
    window.addEventListener(GALLERY_SAVED_EVENT, invalidate);
    return () => { ++request.current; window.removeEventListener(GALLERY_SAVED_EVENT, invalidate); };
  }, [draw]);

  useEffect(() => {
    const element = mat.current;
    if (!element || !active) return;
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0) setWidth(entry.contentRect.width); });
    observer.observe(element);
    return () => { observer.disconnect(); drag.current = null; setDragging(null); };
  }, [active]);

  useEffect(() => {
    drag.current = null; setDragging(null); setSnapping(null);
    const previous = gameRef.current;
    if (!previous || previous.layoutWidth === width) return;
    const nextLayout = puzzleLayout(width, previous.width, previous.height, previous.grid);
    const reflowed = reflowPuzzleGroups(previous.groups, previous.pieces, nextLayout);
    commitGame({ ...previous, layoutWidth: width, groups: reflowed.groups });
  }, [width, commitGame]);

  useEffect(() => {
    if (!snapping) return;
    const timer = window.setTimeout(() => setSnapping(null), 650);
    return () => window.clearTimeout(timer);
  }, [snapping]);

  const moveDrag = useCallback((clientX: number, clientY: number) => {
    const moving = drag.current;
    const bounds = mat.current?.getBoundingClientRect();
    const currentLayout = layoutRef.current;
    const current = gameRef.current;
    if (!moving || !bounds || !currentLayout || !current) return;
    moving.clientX = clientX; moving.clientY = clientY;
    moving.moved ||= Math.hypot(clientX - moving.startX, clientY - moving.startY) > 4;
    commitGame({ ...current, groups: positionPuzzleGroup(current.groups, moving.groupId, clientX - bounds.left - mat.current!.clientLeft - moving.offsetX, clientY - bounds.top - mat.current!.clientTop - moving.offsetY, current.pieces, currentLayout) });
  }, [commitGame]);

  useEffect(() => {
    if (dragging === null || !active) return;
    let frame = 0;
    const scroll = () => {
      const moving = drag.current;
      if (moving?.moved) {
        const speed = moving.clientY < 120 ? -10 : moving.clientY > window.innerHeight - 60 ? 10 : 0;
        if (speed) { window.scrollBy(0, speed); moveDrag(moving.clientX, moving.clientY); }
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [dragging, active, moveDrag]);

  const settleGroup = (groupId: number) => {
    const current = gameRef.current;
    const currentLayout = layoutRef.current;
    if (!current || !currentLayout) return;
    const result = snapPuzzleGroup(current.groups, groupId, current.pieces, currentLayout);
    if (!result.point) return;
    const top = ++z.current;
    let groups = result.groups.map((group) => group.id === groupId ? { ...group, z: top } : group);
    if (groups.length === 1) groups = [centerPuzzleGroup(groups[0], current.pieces, currentLayout)];
    commitGame({ ...current, groups });
    setSnapping({ key: ++snapKey.current, pieceIds: result.joinedIds, point: result.point });
    setSelected(groupId); setNotice(`吸附成功，已拼成 ${result.joinedIds.length} 块的整体。按住其中任意一块可整组拖动。`);
  };

  const startDrag = (event: PointerEvent<HTMLButtonElement>, group: PuzzleGroup) => {
    if (loading || complete || event.button !== 0 || drag.current || !mat.current) return;
    const bounds = mat.current.getBoundingClientRect();
    drag.current = { groupId: group.id, pointerId: event.pointerId, offsetX: event.clientX - bounds.left - mat.current.clientLeft - group.x, offsetY: event.clientY - bounds.top - mat.current.clientTop - group.y, startX: event.clientX, startY: event.clientY, clientX: event.clientX, clientY: event.clientY, moved: false };
    setDragging(group.id); setSelected(group.id); setNotice(''); setSnapping(null);
    const current = gameRef.current; const top = ++z.current;
    if (current) commitGame({ ...current, groups: current.groups.map((item) => item.id === group.id ? { ...item, z: top } : item) });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const finishDrag = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const moving = drag.current;
    if (!moving || moving.pointerId !== event.pointerId) return;
    if (!cancelled) moveDrag(event.clientX, event.clientY);
    drag.current = null; setDragging(null);
    if (!cancelled && moving.moved) settleGroup(moving.groupId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const moveWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, group: PuzzleGroup) => {
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (!direction || loading || complete || drag.current || !gameRef.current || !layout) return;
    event.preventDefault(); setSnapping(null); setSelected(group.id);
    const current = gameRef.current; const step = event.shiftKey ? 1 : 10;
    commitGame({ ...current, groups: positionPuzzleGroup(current.groups, group.id, group.x + direction[0] * step, group.y + direction[1] * step, current.pieces, layout) });
  };

  const restart = (level = difficulty) => {
    difficultyRef.current = level; setDifficulty(level);
    drag.current = null; setDragging(null); setSelected(null); setNotice(''); setSnapping(null); z.current = 100;
    const previous = gameRef.current;
    if (previous) commitGame(freshGame(previous.row, previous, level, widthRef.current));
  };

  return <div className='puzzle-page'>
    <header className='puzzle-intro'>
      <div><p className='studio-eyebrow'>A LITTLE BREAK / IMAGE PUZZLE</p><h1>美图拼图<span>.</span></h1><p>把喜欢的画面，一片片拼回来。生图还在继续，你可以先玩一局。</p></div>
      <a href={ROUTE_HASHES.gallery} className='studio-text-link'>图片来自画廊 <span aria-hidden='true'>↗</span></a>
    </header>
    <div className='puzzle-toolbar'>
      <fieldset className='puzzle-levels' disabled={loading}><legend>拼图难度</legend>{PUZZLE_DIFFICULTIES.map((level) => <button key={level.id} type='button' aria-pressed={difficulty === level.id} onClick={() => restart(level.id)}>{level.label}<small>约 {level.target} 块</small></button>)}</fieldset>
      <div className='puzzle-tools'>
        <button type='button' className='puzzle-tool' disabled={!game || loading} aria-pressed={showGuide} onClick={() => setShowGuide((show) => !show)}>{showGuide ? '隐藏原图' : '查看原图'}</button>
        <button type='button' className='puzzle-tool' disabled={!game || loading} onClick={() => restart()}>重新打乱</button>
        <button type='button' className='studio-action studio-action-primary puzzle-refresh' disabled={loading} onClick={() => void draw()}><span aria-hidden='true'>↻</span>{loading ? '抽图中…' : '换一张'}</button>
      </div>
    </div>
    {error && <div className='puzzle-feedback' role='alert'><p>{error}</p><button type='button' onClick={() => void draw()} disabled={loading}>重新抽取</button></div>}
    <div className='puzzle-game-meta'>
      <span>{game ? `${game.row.style}${game.row.character_name ? ' / ' + game.row.character_name : ''} · ${game.grid.columns} 列 × ${game.grid.rows} 行 · 共 ${game.pieces.length} 块` : '随机抽取自由创作、动作底稿、海报版图片'}</span>
      <strong aria-live='polite'>{game ? `还剩 ${game.groups.length} 组` : ''}</strong>
    </div>
    <div className='puzzle-progress' role='progressbar' aria-label='拼图完成度' aria-valuenow={connections} aria-valuemin={0} aria-valuemax={maxConnections}><span style={{ width: `${connections / maxConnections * 100}%` }} /></div>
    {showGuide && game && <figure className='puzzle-reference'><img src={game.src} alt='拼图原图提示' draggable={false} /><figcaption>原图参考 · 可以在桌面任意位置拼接</figcaption></figure>}
    <p id='puzzle-help' className='puzzle-help'>按住碎片拖动，靠近正确的相邻边时松开即可吸附。拼好的部分可以整组拖动，拼完后自动归中开启视差。键盘可用方向键移动，Shift 加方向键微调。</p>
    <p className='puzzle-status' role='status'>{complete ? showcase ? '拼好了！移动鼠标查看视差，左键翻页切换效果，也可以切回原画 2D。' : '拼好了！画面正在归中，即将开启视差展示。' : notice || (loading ? '正在从图库抽取图片…' : '自由拼接，没有固定落点。站内切换页面会保留进度，生图任务继续运行。')}</p>
    <div ref={mat} className='puzzle-mat' data-complete={complete} data-showcase={showcase} data-group-count={game?.groups.length} aria-label='拼图区域' aria-describedby='puzzle-help' aria-busy={loading}>
      {game && layout ? <>
        {game.pieces.map((piece) => {
          const group = membership.get(piece.id)!;
          const position = piecePosition(piece, group, game.pieces, layout);
          const path = puzzlePiecePath(piece, layout);
          const outline = puzzlePiecePath(piece, layout, groupCells.get(group.id));
          const clip = `${clipPrefix}-${piece.id}`;
          const w = layout.cellWidth + layout.padding * 2; const h = layout.cellHeight + layout.padding * 2;
          const snappingPiece = snapping?.pieceIds.includes(piece.id);
          return <button key={piece.id} type='button' className='puzzle-piece' data-piece={piece.id} data-group={group.id} data-group-size={group.pieceIds.length} data-connected={group.pieceIds.length > 1} data-active={selected === group.id} data-snapping={Boolean(snappingPiece)} data-centering={complete} data-dragging={dragging === group.id} aria-label={`拼图碎片 ${piece.id + 1}${group.pieceIds.length > 1 ? `，${group.pieceIds.length} 块的整体` : ''}`} tabIndex={piece.id === group.pieceIds[0] ? 0 : -1} disabled={loading || complete} style={{ transform: `translate(${position.x - layout.padding}px, ${position.y - layout.padding}px)`, width: w, height: h, zIndex: group.z }} onPointerDown={(event) => startDrag(event, group)} onPointerMove={(event) => { if (drag.current?.pointerId === event.pointerId) { event.preventDefault(); moveDrag(event.clientX, event.clientY); } }} onPointerUp={(event) => finishDrag(event)} onPointerCancel={(event) => finishDrag(event, true)} onLostPointerCapture={(event) => finishDrag(event, true)} onFocus={() => setSelected(group.id)} onKeyDown={(event) => moveWithKeyboard(event, group)} onKeyUp={(event) => { if (event.key.startsWith('Arrow')) { event.preventDefault(); settleGroup(group.id); } }}>
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden='true'>
              <defs><clipPath id={clip}><path d={path} /></clipPath></defs>
              <image href={game.src} x={layout.padding - piece.col * layout.cellWidth} y={layout.padding - piece.row * layout.cellHeight} width={layout.image.width} height={layout.image.height} preserveAspectRatio='none' clipPath={`url(#${clip})`} />
              <path d={path} className='puzzle-piece-hit' />
              <path key={snappingPiece ? snapping!.key : 'outline'} d={outline} className='puzzle-piece-outline' />
            </svg>
          </button>;
        })}
        {snapping && <span key={snapping.key} className='puzzle-snap-burst' aria-hidden='true' style={{ left: snapping.point.x, top: snapping.point.y }} />}
        {complete && <PuzzleReveal key={game.roundId} src={game.src} width={layout.image.width} height={layout.image.height} matWidth={layout.width} roundId={game.roundId} active={active} disabled={loading} onReady={revealReady} />}
      </> : <div className='puzzle-empty'><span aria-hidden='true'>◇</span><p>{loading ? '把美图变成一桌拼图…' : '保存喜欢的作品，就能在这里拼起来。'}</p>{!loading && <a href={ROUTE_HASHES.gallery} className='studio-text-link'>去画廊看看 ↗</a>}</div>}
    </div>
  </div>;
}
