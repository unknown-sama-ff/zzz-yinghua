import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFrontend } from './loadFrontend.js';

const { PUZZLE_DIFFICULTIES, puzzleGrid, puzzleLayout, createPuzzlePieces, createPuzzleGroups, centerPuzzleGroup, piecePosition, positionPuzzleGroup, puzzleGroupGeometry, puzzleGroupBounds, reflowPuzzleGroups, snapPuzzleGroup, puzzlePiecePath, eligiblePuzzleImages, pickPuzzleImage, loadPuzzleGallery } = await loadFrontend(`
  export * from './src/lib/puzzle';
  export * from './src/lib/puzzleGallery';
`);

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);
const group = (id, pieceIds, x, y) => ({ id, pieceIds, x, y, z: id + 1 });

test('adaptive grids preserve original aspect ratios and scatter every piece inside the free mat', () => {
  assert.deepEqual(puzzleGrid(1536, 1024, 'easy'), { rows: 3, columns: 4 });
  assert.deepEqual(puzzleGrid(1024, 1536, 'easy'), { rows: 4, columns: 3 });
  for (const [width, height] of [[1536, 1024], [1024, 1536], [1024, 1024], [2048, 768]]) {
    let previous = 0;
    for (const level of PUZZLE_DIFFICULTIES) {
      const grid = puzzleGrid(width, height, level.id);
      assert.ok(grid.rows * grid.columns > previous); previous = grid.rows * grid.columns;
      for (const viewport of [280, 350, 780, 1320]) {
        const canvasHeight = viewport < 600 ? 420 : 560;
        const layout = puzzleLayout(viewport, width, height, grid, canvasHeight);
        assert.equal(layout.height, canvasHeight, 'canvas accepts an independent viewport height');
        near(layout.image.width / layout.image.height, width / height);
        const pieces = createPuzzlePieces(grid);
        const groups = createPuzzleGroups(pieces, layout);
        assert.equal(groups.length, grid.rows * grid.columns);
        for (const piece of pieces) {
          const position = piecePosition(piece, groups[piece.id], pieces, layout);
          assert.ok(position.x >= layout.padding && position.y >= layout.padding);
          assert.ok(position.x + layout.cellWidth + layout.padding <= layout.width);
          assert.ok(position.y + layout.cellHeight + layout.padding <= layout.height);
          if (piece.col) assert.equal(piece.edges.left, -pieces[piece.id - 1].edges.right);
          else assert.equal(piece.edges.left, 0);
          if (piece.row) assert.equal(piece.edges.top, -pieces[piece.id - grid.columns].edges.bottom);
          else assert.equal(piece.edges.top, 0);
          if (piece.col === grid.columns - 1) assert.equal(piece.edges.right, 0);
          if (piece.row === grid.rows - 1) assert.equal(piece.edges.bottom, 0);
          assert.ok(puzzlePiecePath(piece, layout).endsWith(' Z'));
        }
      }
    }
  }
});

test('scatter has continuous random positions, and completion centers the full image at every size', () => {
  for (const width of [280, 350, 780, 1320]) {
    const grid = puzzleGrid(1024, 1536, 'hard');
    const canvasHeight = width < 600 ? 460 : 560;
    const layout = puzzleLayout(width, 1024, 1536, grid, canvasHeight);
    const pieces = createPuzzlePieces(grid);
    const scattered = createPuzzleGroups(pieces, layout, () => 0.37);
    assert.equal(new Set(scattered.map((item) => item.x.toFixed(3))).size, scattered.length);
    assert.equal(new Set(scattered.map((item) => item.y.toFixed(3))).size, scattered.length);
    assert.ok(Math.max(...scattered.map((item) => item.y)) - Math.min(...scattered.map((item) => item.y)) > canvasHeight * 0.5);
    const whole = centerPuzzleGroup({ id: 0, pieceIds: pieces.map((piece) => piece.id), x: 10, y: 20, z: 1 }, pieces, layout);
    const bounds = puzzleGroupBounds(whole, pieces, layout);
    near(whole.x + bounds.width / 2, layout.width / 2);
    near(whole.y + bounds.height / 2, layout.height / 2);
    const resized = reflowPuzzleGroups([whole], pieces, layout);
    assert.equal(resized.height, canvasHeight); near(resized.groups[0].x, whole.x); near(resized.groups[0].y, whole.y);
  }
});

const grid = puzzleGrid(1536, 1024, 'easy');
const layout = puzzleLayout(1000, 1536, 1024, grid);
const pieces = createPuzzlePieces(grid);
const cw = layout.cellWidth; const ch = layout.cellHeight;

test('group geometry survives movement but refreshes for merges, rounds and resize scale', () => {
  const initial = group(0, [0, 1], 100, 80);
  const geometry = puzzleGroupGeometry(initial, pieces);
  const moved = positionPuzzleGroup([initial], 0, 180, 160, pieces, layout)[0];
  assert.equal(puzzleGroupGeometry(moved, pieces), geometry);
  assert.deepEqual([...geometry.cells], ['0:0', '0:1']);
  const merged = { ...moved, pieceIds: [...moved.pieceIds, 4] };
  assert.notEqual(puzzleGroupGeometry(merged, pieces), geometry);
  assert.equal(puzzleGroupGeometry(merged, pieces).rows, 2);
  const portrait = createPuzzlePieces({ rows: 4, columns: 3 });
  assert.notEqual(puzzleGroupGeometry(initial, portrait), geometry);
  const narrow = puzzleLayout(350, 1536, 1024, grid);
  near(puzzleGroupBounds(moved, pieces, narrow).width, narrow.cellWidth * 2);
});

test('correct horizontal and vertical neighbors snap anywhere without a fixed frame', () => {
  for (const [x, y] of [[100, 70], [310, 180]]) {
    const horizontal = snapPuzzleGroup([group(0, [0], x, y), group(1, [1], x + cw + 6, y + 4)], 1, pieces, layout);
    assert.equal(horizontal.groups.length, 1);
    assert.deepEqual(new Set(horizontal.joinedIds), new Set([0, 1]));
    const a = piecePosition(pieces[0], horizontal.groups[0], pieces, layout);
    const b = piecePosition(pieces[1], horizontal.groups[0], pieces, layout);
    near(b.x - a.x, cw); near(b.y, a.y);
    const vertical = snapPuzzleGroup([group(0, [0], x, y), group(4, [4], x + 3, y + ch - 5)], 4, pieces, layout);
    assert.equal(vertical.groups.length, 1);
    assert.ok(vertical.point);
    const top = piecePosition(pieces[0], vertical.groups[0], pieces, layout);
    const bottom = piecePosition(pieces[4], vertical.groups[0], pieces, layout);
    near(bottom.y - top.y, ch); near(bottom.x, top.x);
  }
});

test('wrong neighbors, diagonal contact, reversed edges and distant pieces do not merge', () => {
  const base = group(0, [0], 160, 140);
  for (const candidate of [group(2, [2], 160 + cw * 2, 140), group(5, [5], 160 + cw, 140 + ch), group(1, [1], 160 - cw, 140), group(1, [1], 160 + cw + 60, 140)]) {
    const original = [base, candidate];
    const result = snapPuzzleGroup(original, candidate.id, pieces, layout);
    assert.equal(result.groups, original); assert.deepEqual(result.joinedIds, []); assert.equal(result.point, null);
  }
});

test('two completed subgroups merge into a rigid whole and stay draggable', () => {
  const source = [group(1, [0, 1], 160, 100), group(5, [4, 5], 164, 100 + ch + 5)];
  const joined = snapPuzzleGroup(source, 5, pieces, layout);
  assert.equal(joined.groups.length, 1);
  assert.equal(joined.joinedIds.length, 4);
  assert.deepEqual(source[1].pieceIds, [4, 5], 'input groups are immutable');
  const before = pieces.filter((piece) => joined.joinedIds.includes(piece.id)).map((piece) => piecePosition(piece, joined.groups[0], pieces, layout));
  const moved = positionPuzzleGroup(joined.groups, 5, 230, 170, pieces, layout);
  const after = pieces.filter((piece) => joined.joinedIds.includes(piece.id)).map((piece) => piecePosition(piece, moved[0], pieces, layout));
  for (let i = 1; i < after.length; i++) { near(after[i].x - before[i].x, after[0].x - before[0].x); near(after[i].y - before[i].y, after[0].y - before[0].y); }
  const bounded = positionPuzzleGroup(moved, 5, 9999, -9999, pieces, layout)[0];
  const bounds = puzzleGroupBounds(bounded, pieces, layout);
  near(bounded.x + bounds.width + layout.padding, layout.width); near(bounded.y, layout.padding);
});

test('cascading connections complete one freely movable image, and resize preserves the whole', () => {
  const groups = pieces.map((piece) => group(piece.id, [piece.id], 120 + piece.col * cw, 70 + piece.row * ch));
  const joined = snapPuzzleGroup(groups, 0, pieces, layout);
  assert.equal(joined.groups.length, 1); assert.equal(joined.joinedIds.length, pieces.length);
  for (const width of [350, 1320, 280]) {
    const nextLayout = puzzleLayout(width, 1536, 1024, grid);
    const reflowed = reflowPuzzleGroups(joined.groups, pieces, nextLayout);
    assert.equal(reflowed.groups[0].pieceIds.length, pieces.length);
    for (const piece of pieces) {
      const position = piecePosition(piece, reflowed.groups[0], pieces, nextLayout);
      near(position.x, reflowed.groups[0].x + piece.col * nextLayout.cellWidth);
      near(position.y, reflowed.groups[0].y + piece.row * nextLayout.cellHeight);
      assert.ok(position.x + nextLayout.cellWidth <= width);
      assert.ok(position.y + nextLayout.cellHeight <= reflowed.height);
    }
    const moved = positionPuzzleGroup(reflowed.groups, 0, 30, 45, pieces, { ...nextLayout, height: reflowed.height });
    assert.equal(moved[0].pieceIds.length, pieces.length); near(moved[0].x, 30); near(moved[0].y, 45);
  }
  const scattered = createPuzzleGroups(pieces, layout);
  const mixed = [group(1, [0, 1], 100, 100), ...scattered.filter((item) => item.id !== 0 && item.id !== 1)];
  const narrow = puzzleLayout(350, 1536, 1024, grid);
  const packed = reflowPuzzleGroups(mixed, pieces, narrow);
  for (const item of packed.groups) {
    const bounds = puzzleGroupBounds(item, pieces, narrow);
    assert.ok(item.x >= narrow.padding && item.y >= narrow.padding);
    assert.ok(item.x + bounds.width + narrow.padding <= narrow.width);
    assert.ok(item.y + bounds.height + narrow.padding <= packed.height);
  }
});

const row = (id, style, image_url = `https://example.invalid/${id}.webp`) => ({ id, style, image_url, created_at: '', character_name: '', prompt: '', provider: '' });
test('draws only requested sources, deduplicates images and avoids the current image', () => {
  const images = eligiblePuzzleImages([row(1, '自由创作'), row(2, '动作底稿'), row(3, '海报版'), row(4, '三视图'), row(5, '剪影版'), row(6, '自由创作', ''), row(7, '海报版', 'https://example.invalid/1.webp')]);
  assert.deepEqual(images.map((image) => image.id), [1, 2, 3]);
  assert.equal(pickPuzzleImage(images, images[0].image_url, () => 0).id, 2);
  assert.equal(pickPuzzleImage([images[0]], images[0].image_url).id, 1);
  assert.equal(pickPuzzleImage([]), null);
});
test('older gallery pages participate and failed or repeated pages terminate', async () => {
  const offsets = [];
  const images = await loadPuzzleGallery(async ({ limit, offset }) => {
    assert.equal(limit, 200); offsets.push(offset);
    return offset === 0 ? { rows: [row(1, '三视图'), row(2, '剪影版')], hasMore: true } : { rows: [row(3, '自由创作')], hasMore: false };
  });
  assert.deepEqual(offsets, [0, 2]); assert.equal(images[0].id, 3);
  let calls = 0;
  await loadPuzzleGallery(async () => { calls++; return { rows: [row(1, '海报版')], hasMore: true }; });
  assert.equal(calls, 2);
  await assert.rejects(() => loadPuzzleGallery(async () => { throw new Error('offline'); }), /offline/);
});
