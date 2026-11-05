export const PUZZLE_DIFFICULTIES = [
  { id: 'easy', label: '简单', target: 12, pieceSize: 104, pieceLabel: '大块' },
  { id: 'normal', label: '普通', target: 24, pieceSize: 80, pieceLabel: '中块' },
  { id: 'hard', label: '困难', target: 48, pieceSize: 56, pieceLabel: '小块' },
] as const;

export type PuzzleDifficulty = typeof PUZZLE_DIFFICULTIES[number]['id'];
export interface PuzzleGrid { rows: number; columns: number; difficulty?: PuzzleDifficulty }

function targetPieceSize(width: number, height: number, size: number): number {
  return size * Math.min(1, width / 560, height / 400);
}

function puzzleImageSize(width: number, height: number, ratio: number, count: number, cellSize: number) {
  const imageWidth = cellSize * Math.sqrt(count * ratio);
  const imageHeight = imageWidth / ratio;
  // Leave enough space to scatter pieces and to keep assembled groups inside the mat.
  const scale = Math.min(
    1, width * 0.86 / imageWidth, height * 0.8 / imageHeight,
    Math.sqrt(width * height * 0.38 / (imageWidth * imageHeight)),
  );
  return { width: imageWidth * scale, height: imageHeight * scale };
}

export function puzzleGrid(imageWidth: number, imageHeight: number, difficulty: PuzzleDifficulty, viewport?: { width: number; height: number }): PuzzleGrid {
  const level = PUZZLE_DIFFICULTIES.find((item) => item.id === difficulty)!;
  const ratio = imageWidth / imageHeight;
  let rows = Math.sqrt(level.target / ratio);
  let columns = Math.sqrt(level.target * ratio);
  if (viewport) {
    const width = Math.max(240, viewport.width); const height = Math.max(180, viewport.height);
    const cellSize = targetPieceSize(width, height, level.pieceSize);
    const image = puzzleImageSize(width, height, ratio, level.target, cellSize);
    rows = image.height / cellSize; columns = image.width / cellSize;
  }
  return {
    rows: Math.max(1, Math.min(16, Math.round(rows))),
    columns: Math.max(1, Math.min(16, Math.round(columns))),
    difficulty,
  };
}
type Edge = -1 | 0 | 1;
export interface PuzzlePiece {
  id: number; row: number; col: number;
  edges: { top: Edge; right: Edge; bottom: Edge; left: Edge };
}
export interface PuzzleGroup { id: number; pieceIds: number[]; x: number; y: number; z: number }
export interface PuzzleLayout {
  width: number; height: number;
  image: { width: number; height: number };
  cellWidth: number; cellHeight: number; padding: number;
  margin: number;
}

export function puzzleLayout(width: number, imageWidth: number, imageHeight: number, grid: PuzzleGrid, height = Math.round(width * 0.65)): PuzzleLayout {
  width = Math.max(240, width);
  height = Math.max(180, height);
  const ratio = imageWidth / imageHeight;
  const level = PUZZLE_DIFFICULTIES.find((item) => item.id === (grid.difficulty ?? 'easy'))!;
  const image = puzzleImageSize(width, height, ratio, grid.rows * grid.columns, targetPieceSize(width, height, level.pieceSize));
  const cellWidth = image.width / grid.columns;
  const cellHeight = image.height / grid.rows;
  const padding = Math.min(cellWidth, cellHeight) * 0.2;
  const margin = 16 + padding;
  return {
    width, height,
    image,
    cellWidth, cellHeight, padding, margin,
  };
}

export function createPuzzlePieces(grid: PuzzleGrid, random = Math.random): PuzzlePiece[] {
  const { rows, columns } = grid;
  const pieces: PuzzlePiece[] = [];
  const edge = (): Edge => random() < 0.5 ? -1 : 1;
  for (let id = 0; id < rows * columns; id++) {
    const row = Math.floor(id / columns);
    const col = id % columns;
    pieces.push({
      id, row, col,
      edges: {
        top: row === 0 ? 0 : -pieces[id - columns].edges.bottom as Edge,
        right: col === columns - 1 ? 0 : edge(),
        bottom: row === rows - 1 ? 0 : edge(),
        left: col === 0 ? 0 : -pieces[id - 1].edges.right as Edge,
      },
    });
  }
  return pieces;
}

export function createPuzzleGroups(pieces: PuzzlePiece[], layout: PuzzleLayout, random = Math.random): PuzzleGroup[] {
  return scatterPuzzleGroups(pieces.map((piece, index) => ({ id: piece.id, pieceIds: [piece.id], z: index + 1, x: 0, y: 0 })), pieces, layout, random);
}

// Groups retain their pieceIds array while moving; only a merge creates new
// membership. Weak keys let finished rounds disappear without cache cleanup.
const groupGeometry = new WeakMap<PuzzlePiece[], { pieces: Map<number, PuzzlePiece>; groups: WeakMap<number[], { minCol: number; minRow: number; columns: number; rows: number; cells: ReadonlySet<string> }> }>();
export function puzzleGroupGeometry(group: PuzzleGroup, pieces: PuzzlePiece[]) {
  let round = groupGeometry.get(pieces);
  if (!round) {
    round = { pieces: new Map(pieces.map((piece) => [piece.id, piece])), groups: new WeakMap() };
    groupGeometry.set(pieces, round);
  }
  let geometry = round.groups.get(group.pieceIds);
  if (!geometry) {
    let minCol = Infinity; let minRow = Infinity; let maxCol = -Infinity; let maxRow = -Infinity;
    const cells = new Set<string>();
    for (const id of group.pieceIds) {
      const piece = round.pieces.get(id);
      if (!piece) continue;
      minCol = Math.min(minCol, piece.col); maxCol = Math.max(maxCol, piece.col);
      minRow = Math.min(minRow, piece.row); maxRow = Math.max(maxRow, piece.row);
      cells.add(`${piece.row}:${piece.col}`);
    }
    geometry = { minCol, minRow, columns: maxCol - minCol + 1, rows: maxRow - minRow + 1, cells };
    round.groups.set(group.pieceIds, geometry);
  }
  return geometry;
}

export function puzzleGroupBounds(group: PuzzleGroup, pieces: PuzzlePiece[], layout: PuzzleLayout) {
  const { minCol, minRow, columns, rows } = puzzleGroupGeometry(group, pieces);
  return { minCol, minRow, width: columns * layout.cellWidth, height: rows * layout.cellHeight };
}

export function piecePosition(piece: PuzzlePiece, group: PuzzleGroup, pieces: PuzzlePiece[], layout: PuzzleLayout) {
  const bounds = puzzleGroupBounds(group, pieces, layout);
  return { x: group.x + (piece.col - bounds.minCol) * layout.cellWidth, y: group.y + (piece.row - bounds.minRow) * layout.cellHeight };
}

export function positionPuzzleGroup(groups: PuzzleGroup[], id: number, x: number, y: number, pieces: PuzzlePiece[], layout: PuzzleLayout): PuzzleGroup[] {
  return groups.map((group) => {
    if (group.id !== id) return group;
    const bounds = puzzleGroupBounds(group, pieces, layout);
    return { ...group,
      x: Math.max(layout.padding, Math.min(layout.width - bounds.width - layout.padding, x)),
      y: Math.max(layout.padding, Math.min(layout.height - bounds.height - layout.padding, y)),
    };
  });
}

/** Free continuous positions, with bounded best-candidate sampling to avoid buried pieces. */
export function scatterPuzzleGroups(groups: PuzzleGroup[], pieces: PuzzlePiece[], layout: PuzzleLayout, random = Math.random): PuzzleGroup[] {
  const boxes = groups.map((group) => ({ group, bounds: puzzleGroupBounds(group, pieces, layout) }))
    .sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height);
  const positions = new Map<number, { x: number; y: number }>();
  const occupied: { x: number; y: number; width: number; height: number }[] = [];
  const inset = layout.padding + 6;
  for (const [index, { group, bounds }] of boxes.entries()) {
    let best = { x: inset, y: inset, score: Infinity };
    for (let attempt = 0; attempt < 100; attempt++) {
      // Irrational offsets also keep deterministic/low-entropy RNGs from stacking everything.
      const x = inset + (layout.width - bounds.width - inset * 2) * ((random() + attempt * 0.61803398875 + index * 0.41421356237) % 1);
      const y = inset + (layout.height - bounds.height - inset * 2) * ((random() + attempt * 0.75487766625 + index * 0.73205080757) % 1);
      let score = 0;
      for (const other of occupied) {
        const overlapX = Math.max(0, Math.min(x + bounds.width + layout.padding, other.x + other.width + layout.padding) - Math.max(x - layout.padding, other.x - layout.padding));
        const overlapY = Math.max(0, Math.min(y + bounds.height + layout.padding, other.y + other.height + layout.padding) - Math.max(y - layout.padding, other.y - layout.padding));
        score += overlapX * overlapY;
      }
      if (score < best.score) best = { x, y, score };
      if (score === 0) break;
    }
    positions.set(group.id, { x: best.x, y: best.y });
    occupied.push({ x: best.x, y: best.y, width: bounds.width, height: bounds.height });
  }
  return groups.map((group) => ({ ...group, ...positions.get(group.id)! }));
}

export function centerPuzzleGroup(group: PuzzleGroup, pieces: PuzzlePiece[], layout: PuzzleLayout): PuzzleGroup {
  const bounds = puzzleGroupBounds(group, pieces, layout);
  return { ...group, x: (layout.width - bounds.width) / 2, y: (layout.height - bounds.height) / 2 };
}

/** Resizing preserves group membership and keeps the finished image centered. */
export function reflowPuzzleGroups(groups: PuzzleGroup[], pieces: PuzzlePiece[], layout: PuzzleLayout) {
  return { groups: groups.length === 1 ? [centerPuzzleGroup(groups[0], pieces, layout)] : scatterPuzzleGroups(groups, pieces, layout), height: layout.height };
}

/** Snap correct neighbors anywhere on the mat, merging both entire groups. */
export function snapPuzzleGroup(groups: PuzzleGroup[], id: number, pieces: PuzzlePiece[], layout: PuzzleLayout) {
  let result = groups;
  const initial = groups.find((group) => group.id === id);
  let contact: [PuzzlePiece, PuzzlePiece] | null = null;
  if (!initial) return { groups, joinedIds: [] as number[], point: null };
  let moving: PuzzleGroup = initial;
  const tolerance = Math.min(layout.cellWidth, layout.cellHeight) * 0.3;
  while (true) {
    const aBounds = puzzleGroupBounds(moving, pieces, layout);
    const ax = moving.x - aBounds.minCol * layout.cellWidth;
    const ay = moving.y - aBounds.minRow * layout.cellHeight;
    const members = pieces.filter((piece) => moving.pieceIds.includes(piece.id));
    let nearest: { group: PuzzleGroup; x: number; y: number; distance: number; pair: [PuzzlePiece, PuzzlePiece] } | null = null;
    for (const other of result) {
      if (other.id === moving.id) continue;
      const bounds = puzzleGroupBounds(other, pieces, layout);
      const originX = other.x - bounds.minCol * layout.cellWidth;
      const originY = other.y - bounds.minRow * layout.cellHeight;
      const distance = Math.hypot(ax - originX, ay - originY);
      if (distance > tolerance || (nearest && distance >= nearest.distance)) continue;
      const others = pieces.filter((piece) => other.pieceIds.includes(piece.id));
      for (const a of members) {
        const b = others.find((piece) => Math.abs(a.row - piece.row) + Math.abs(a.col - piece.col) === 1);
        if (b) { nearest = { group: other, x: originX, y: originY, distance, pair: [a, b] }; break; }
      }
    }
    if (!nearest) break;
    const merged: PuzzleGroup = { ...moving, pieceIds: [...moving.pieceIds, ...nearest.group.pieceIds], z: Math.max(moving.z, nearest.group.z) };
    const bounds = puzzleGroupBounds(merged, pieces, layout);
    moving = { ...merged, x: nearest.x + bounds.minCol * layout.cellWidth, y: nearest.y + bounds.minRow * layout.cellHeight };
    result = [...result.filter((group) => group.id !== id && group.id !== nearest.group.id), moving];
    contact = nearest.pair;
  }
  if (!contact) return { groups, joinedIds: [] as number[], point: null };
  result = positionPuzzleGroup(result, id, moving.x, moving.y, pieces, layout);
  moving = result.find((group) => group.id === id)!;
  const a = piecePosition(contact[0], moving, pieces, layout);
  const b = piecePosition(contact[1], moving, pieces, layout);
  return { groups: result, joinedIds: moving.pieceIds, point: { x: (a.x + b.x + layout.cellWidth) / 2, y: (a.y + b.y + layout.cellHeight) / 2 } };
}

/** Clockwise outlines use shared, complementary connectors on neighboring pieces. */
export function puzzlePiecePath(piece: PuzzlePiece, layout: PuzzleLayout, connected?: ReadonlySet<string>): string {
  const { cellWidth: w, cellHeight: h, padding: p } = layout;
  const depth = Math.min(w, h) * 0.11;
  let x = p;
  let y = p;
  let path = `M ${x} ${y}`;
  const side = (dx: number, dy: number, sign: Edge, visible: boolean) => {
    const length = Math.hypot(dx, dy);
    const nx = dy / length * depth * sign;
    const ny = -dx / length * depth * sign;
    const point = (t: number, bump = 0) => `${x + dx * t + nx * bump} ${y + dy * t + ny * bump}`;
    if (sign && visible) {
      path += ` L ${point(0.35)} C ${point(0.42)} ${point(0.40, 1)} ${point(0.45, 1)}`;
      path += ` C ${point(0.45, 1.6)} ${point(0.55, 1.6)} ${point(0.55, 1)}`;
      path += ` C ${point(0.60, 1)} ${point(0.58)} ${point(0.65)}`;
    }
    path += ` ${visible ? 'L' : 'M'} ${point(1)}`;
    x += dx; y += dy;
  };
  side(w, 0, piece.edges.top, !connected?.has(`${piece.row - 1}:${piece.col}`));
  side(0, h, piece.edges.right, !connected?.has(`${piece.row}:${piece.col + 1}`));
  side(-w, 0, piece.edges.bottom, !connected?.has(`${piece.row + 1}:${piece.col}`));
  side(0, -h, piece.edges.left, !connected?.has(`${piece.row}:${piece.col - 1}`));
  return path + (connected ? '' : ' Z');
}
