/* puyoAI.js
 * Stable worker-backed AI for pp-sim2
 * - current piece + NEXT1 + NEXT2
 * - worker first, main-thread fallback
 * - beam search + future-seed evaluation
 * - GTR / ABAC friendly scoring bias
 */
(function (global) {
  'use strict';

  const IS_WORKER = typeof document === 'undefined';

  const COLORS = {
    EMPTY: 0,
    RED: 1,
    BLUE: 2,
    GREEN: 3,
    YELLOW: 4,
    GARBAGE: 5
  };

  const BONUS_TABLE = {
    CHAIN: [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512],
    GROUP: [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    COLOR: [0, 0, 3, 6, 12]
  };

  const AI_CONFIG = {
    WORKER_CANDIDATES: [
      './puyo-ai-worker.js?v=6',
      './puyo-ai-worker.js',
      './puyoAI.worker.js?v=6',
      './puyoAI.worker.js'
    ],
    AUTO_TICK_MS: 140,
    THINK_TIMEOUT_MS: 12000,
    READY_TIMEOUT_MS: 8000,
    BEAM_WIDTH: 12,
    LEAF_PSEUDO_BRANCH_LIMIT: 8,
    PSEUDO_COLORS: [1, 2, 3, 4]
  };

  const DANGER_CELL_X = 2;
  const DANGER_CELL_Y = 11;

  const TEMPLATE_LIBRARY = [
    { name: 'left_stair',   mask: [1, 1, 1, 1, 0, 0], profile: [0, 1, 2, 3, 0, 0], weight: 1.00 },
    { name: 'right_stair',  mask: [0, 0, 1, 1, 1, 1], profile: [0, 0, 3, 2, 1, 0], weight: 1.00 },
    { name: 'left_gtr',     mask: [1, 1, 1, 1, 1, 0], profile: [0, 1, 2, 2, 1, 0], weight: 1.28 },
    { name: 'right_gtr',    mask: [0, 1, 1, 1, 1, 1], profile: [0, 1, 2, 2, 1, 0], weight: 1.28 },
    { name: 'valley',       mask: [1, 1, 1, 1, 1, 1], profile: [2, 1, 0, 0, 1, 2], weight: 1.12 },
    { name: 'center_tower', mask: [0, 1, 1, 1, 1, 0], profile: [0, 1, 2, 3, 2, 1], weight: 1.05 },
    { name: 'bridge',       mask: [1, 1, 1, 1, 1, 1], profile: [1, 2, 1, 1, 2, 1], weight: 0.95 }
  ];

  const STATE = {
    worker: null,
    workerReady: false,
    workerReadyPromise: null,
    workerDisabled: false,
    pending: new Map(),
    autoEnabled: false,
    autoTimer: null,
    busy: false,
    booted: false,
    jobSeq: 0
  };

  function getWidth() {
    return typeof WIDTH !== 'undefined' ? WIDTH : 6;
  }

  function getHeight() {
    return typeof HEIGHT !== 'undefined' ? HEIGHT : 14;
  }

  function getColors() {
    return typeof COLORS !== 'undefined' ? COLORS : global.COLORS || COLORS;
  }

  function getGameState() {
    return typeof gameState !== 'undefined' ? gameState : 'playing';
  }

  function getCurrentPuyo() {
    return typeof currentPuyo !== 'undefined' && currentPuyo ? currentPuyo : null;
  }

  function getQueueArray() {
    if (typeof global.getNextQueue === 'function') {
      const q = global.getNextQueue();
      return Array.isArray(q) ? q : [];
    }
    if (typeof nextQueue !== 'undefined' && Array.isArray(nextQueue)) {
      return nextQueue.map(pair => Array.isArray(pair) ? pair.slice() : [0, 0]);
    }
    return [];
  }

  function getQueueIndex() {
    return (typeof queueIndex !== 'undefined' && Number.isFinite(queueIndex)) ? queueIndex : 0;
  }

  function getPendingOjama() {
    return (typeof pendingOjama !== 'undefined' && Number.isFinite(pendingOjama)) ? pendingOjama : 0;
  }

  function getScoreToOjamaFn() {
    if (typeof scoreToOjama === 'function') return scoreToOjama;
    return (v) => Math.floor(Math.max(0, v) / 70);
  }

  function getAllClearBonus() {
    return (typeof ALL_CLEAR_SCORE_BONUS !== 'undefined') ? ALL_CLEAR_SCORE_BONUS : 2100;
  }

  function cloneBoard(board2d) {
    return board2d.map(row => row.slice());
  }

  function boardToKey(board2d) {
    return board2d.map(row => row.join('')).join('|');
  }

  function updateStatus(text) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('ai-status');
    if (el) el.textContent = text;
  }

  function updateAutoButton() {
    if (typeof document === 'undefined') return;
    const btn = document.getElementById('ai-auto-button');
    if (btn) btn.textContent = STATE.autoEnabled ? 'AI自動: ON' : 'AI自動: OFF';
  }

  function pieceFromPair(pair) {
    if (!pair || !Array.isArray(pair) || pair.length < 2) return null;
    return { mainColor: pair[1] | 0, subColor: pair[0] | 0 };
  }

  function readPiecesForMainThread() {
    const cur = getCurrentPuyo();
    if (!cur) return [];
    const q = getQueueArray();
    const idx = getQueueIndex();

    const pieces = [{ mainColor: cur.mainColor | 0, subColor: cur.subColor | 0 }];
    const p1 = pieceFromPair(q[idx]);
    const p2 = pieceFromPair(q[idx + 1]);
    if (p1) pieces.push(p1);
    if (p2) pieces.push(p2);
    return pieces;
  }

  function normalizeStatePieces(state) {
    if (Array.isArray(state.pieces) && state.pieces.length) {
      return state.pieces
        .map(p => (p && Number.isFinite(p.mainColor) && Number.isFinite(p.subColor))
          ? { mainColor: p.mainColor | 0, subColor: p.subColor | 0 }
          : null)
        .filter(Boolean);
    }

    const pieces = [];
    const cur = state.currentPuyo;
    if (cur && Number.isFinite(cur.mainColor) && Number.isFinite(cur.subColor)) {
      pieces.push({ mainColor: cur.mainColor | 0, subColor: cur.subColor | 0 });
    }
    const q = Array.isArray(state.nextQueue) ? state.nextQueue : [];
    const idx = Number.isFinite(state.queueIndex) ? state.queueIndex : 0;
    const p1 = pieceFromPair(q[idx]);
    const p2 = pieceFromPair(q[idx + 1]);
    if (p1) pieces.push(p1);
    if (p2) pieces.push(p2);
    return pieces;
  }

  function getPieceCoords(piece, x, y, rotation) {
    let sx = x;
    let sy = y;
    if (rotation === 0) sy = y + 1;
    else if (rotation === 1) sx = x - 1;
    else if (rotation === 2) sy = y - 1;
    else if (rotation === 3) sx = x + 1;
    return [
      { x, y, color: piece.mainColor },
      { x: sx, y: sy, color: piece.subColor }
    ];
  }

  function canPlace(board2d, piece, x, y, rotation) {
    const W = getWidth();
    const H = getHeight();
    const coords = getPieceCoords(piece, x, y, rotation);
    const C = getColors();
    for (const c of coords) {
      if (c.x < 0 || c.x >= W || c.y < 0 || c.y >= H) return false;
      if (board2d[c.y][c.x] !== C.EMPTY) return false;
    }
    return true;
  }

  function findRestY(board2d, piece, x, rotation) {
    let y = getHeight() - 2;
    if (!canPlace(board2d, piece, x, y, rotation)) return null;
    while (y > 0 && canPlace(board2d, piece, x, y - 1, rotation)) y--;
    return y;
  }

  function enumeratePlacements(board2d, piece) {
    const out = [];
    for (let rot = 0; rot < 4; rot++) {
      for (let x = 0; x < getWidth(); x++) {
        const y = findRestY(board2d, piece, x, rot);
        if (y !== null) out.push({ x, y, rotation: rot });
      }
    }
    return out;
  }

  function placePiece(board2d, piece, x, y, rotation) {
    const next = cloneBoard(board2d);
    const coords = getPieceCoords(piece, x, y, rotation);
    for (const c of coords) {
      if (c.x >= 0 && c.x < getWidth() && c.y >= 0 && c.y < getHeight()) {
        next[c.y][c.x] = c.color;
      }
    }
    return next;
  }

  function gravityOn(board2d) {
    const C = getColors();
    for (let x = 0; x < getWidth(); x++) {
      const col = [];
      for (let y = 0; y < getHeight(); y++) {
        if (board2d[y][x] !== C.EMPTY) col.push(board2d[y][x]);
      }
      for (let y = 0; y < getHeight(); y++) {
        board2d[y][x] = y < col.length ? col[y] : C.EMPTY;
      }
    }
  }

  function findGroups(board2d) {
    const W = getWidth();
    const H = getHeight();
    const C = getColors();
    const visited = Array.from({ length: H }, () => Array(W).fill(false));
    const groups = [];

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const color = board2d[y][x];
        if (color === C.EMPTY || color === C.GARBAGE || visited[y][x]) continue;

        const stack = [{ x, y }];
        visited[y][x] = true;
        const group = [];

        while (stack.length) {
          const cur = stack.pop();
          group.push(cur);
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = cur.x + dx;
            const ny = cur.y + dy;
            if (nx >= 0 && nx < W && ny >= 0 && ny < H && !visited[ny][nx] && board2d[ny][nx] === color) {
              visited[ny][nx] = true;
              stack.push({ x: nx, y: ny });
            }
          }
        }

        if (group.length >= 4) groups.push({ color, group });
      }
    }

    return groups;
  }

  function clearGarbageNeighbors(board2d, erasedCoords) {
    const W = getWidth();
    const H = getHeight();
    const C = getColors();
    const toClear = new Set();

    for (const { x, y } of erasedCoords) {
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < W && ny >= 0 && ny < H && board2d[ny][nx] === C.GARBAGE) {
          toClear.add(`${nx},${ny}`);
        }
      }
    }

    for (const key of toClear) {
      const [x, y] = key.split(',').map(Number);
      board2d[y][x] = C.EMPTY;
    }
  }

  function groupBonus(size) {
    const t = BONUS_TABLE.GROUP;
    return t[Math.min(size, t.length - 1)] || 0;
  }

  function chainBonus(chainNo) {
    const t = BONUS_TABLE.CHAIN;
    const idx = Math.max(0, Math.min(chainNo - 1, t.length - 1));
    return t[idx] || 0;
  }

  function colorBonus(colorCount) {
    const t = BONUS_TABLE.COLOR;
    return t[Math.min(colorCount, t.length - 1)] || 0;
  }

  function calculateScore(groups, chainNo) {
    let totalPuyos = 0;
    const colorSet = new Set();
    let bonusTotal = 0;

    for (const { color, group } of groups) {
      totalPuyos += group.length;
      colorSet.add(color);
      bonusTotal += groupBonus(group.length);
    }

    bonusTotal += chainBonus(chainNo);
    bonusTotal += colorBonus(colorSet.size);

    if (bonusTotal <= 0) bonusTotal = 1;
    return 10 * totalPuyos * bonusTotal;
  }

  function resolveBoard(board2d) {
    const scoreFn = getScoreToOjamaFn();
    const acBonus = getAllClearBonus();

    let totalChains = 0;
    let totalScore = 0;
    let totalAttack = 0;

    while (true) {
      gravityOn(board2d);
      const groups = findGroups(board2d);
      if (groups.length === 0) break;

      totalChains++;
      const chainScore = calculateScore(groups, totalChains);
      totalScore += chainScore;
      totalAttack += scoreFn(chainScore);

      const erased = [];
      for (const { group } of groups) {
        for (const p of group) {
          board2d[p.y][p.x] = getColors().EMPTY;
          erased.push(p);
        }
      }
      clearGarbageNeighbors(board2d, erased);
    }

    gravityOn(board2d);

    const allClear = isBoardEmpty(board2d);
    if (allClear) {
      totalScore += acBonus;
      totalAttack += scoreFn(acBonus);
    }

    return { board: board2d, chains: totalChains, score: totalScore, attack: totalAttack, allClear };
  }

  function isBoardEmpty(board2d) {
    const C = getColors();
    for (let y = 0; y < getHeight(); y++) {
      for (let x = 0; x < getWidth(); x++) {
        if (board2d[y][x] !== C.EMPTY) return false;
      }
    }
    return true;
  }

  function columnHeights(board2d) {
    const heights = Array(getWidth()).fill(0);
    const C = getColors();
    for (let x = 0; x < getWidth(); x++) {
      let h = 0;
      for (let y = getHeight() - 1; y >= 0; y--) {
        if (board2d[y][x] !== C.EMPTY) {
          h = y + 1;
          break;
        }
      }
      heights[x] = h;
    }
    return heights;
  }

  function countHoles(board2d, heights) {
    const C = getColors();
    let holes = 0;
    for (let x = 0; x < getWidth(); x++) {
      for (let y = 0; y < heights[x]; y++) {
        if (board2d[y][x] === C.EMPTY) holes++;
      }
    }
    return holes;
  }

  function openNeighborCount(board2d, cells) {
    const C = getColors();
    const seen = new Set();
    let count = 0;
    for (const { x, y } of cells) {
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < getWidth() && ny >= 0 && ny < getHeight() && board2d[ny][nx] === C.EMPTY) {
          const key = `${nx},${ny}`;
          if (!seen.has(key)) {
            seen.add(key);
            count++;
          }
        }
      }
    }
    return count;
  }

  function findGroupsLoose(board2d) {
    const W = getWidth();
    const H = getHeight();
    const C = getColors();
    const visited = Array.from({ length: H }, () => Array(W).fill(false));
    const out = [];

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const color = board2d[y][x];
        if (color === C.EMPTY || color === C.GARBAGE || visited[y][x]) continue;

        const stack = [{ x, y }];
        visited[y][x] = true;
        const cells = [];

        while (stack.length) {
          const cur = stack.pop();
          cells.push(cur);
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = cur.x + dx;
            const ny = cur.y + dy;
            if (nx >= 0 && nx < W && ny >= 0 && ny < H && !visited[ny][nx] && board2d[ny][nx] === color) {
              visited[ny][nx] = true;
              stack.push({ x: nx, y: ny });
            }
          }
        }

        out.push({ color, cells });
      }
    }

    return out;
  }

  function dangerPenalty(board2d) {
    const C = getColors();
    const heights = columnHeights(board2d);
    let penalty = 0;

    if (board2d[DANGER_CELL_Y] && board2d[DANGER_CELL_Y][DANGER_CELL_X] !== C.EMPTY) {
      penalty += 1000000;
    }
    if (heights[DANGER_CELL_X] >= DANGER_CELL_Y + 1) penalty += 250000;
    if (heights[DANGER_CELL_X] >= DANGER_CELL_Y - 1) penalty += 80000;

    for (let y = Math.max(0, DANGER_CELL_Y - 2); y <= DANGER_CELL_Y; y++) {
      if (board2d[y] && board2d[y][DANGER_CELL_X] !== C.EMPTY) penalty += 25000;
    }
    return penalty;
  }

  function templateScore(board2d) {
    const heights = columnHeights(board2d);
    let best1 = 0;
    let best2 = 0;

    for (const t of TEMPLATE_LIBRARY) {
      const cols = [];
      for (let x = 0; x < getWidth(); x++) {
        if (t.mask[x]) cols.push(x);
      }
      if (!cols.length) continue;

      let base = Infinity;
      for (const x of cols) base = Math.min(base, heights[x] - t.profile[x]);
      if (!Number.isFinite(base)) continue;

      let s = 0;
      let occupied = 0;
      for (const x of cols) {
        const target = base + t.profile[x];
        const diff = Math.abs(heights[x] - target);
        s += Math.max(0, 8 - diff * 3);
        if (heights[x] > 0) occupied++;
      }

      s += occupied * 2;
      s *= t.weight;

      if (s > best1) {
        best2 = best1;
        best1 = s;
      } else if (s > best2) {
        best2 = s;
      }
    }

    return best1 + best2 * 0.5;
  }

  function seedScore(board2d) {
    const comps = findGroupsLoose(board2d);
    let s = 0;

    for (const g of comps) {
      const size = g.cells.length;
      if (size === 1) s += 1;
      else if (size === 2) s += 12 + openNeighborCount(board2d, g.cells) * 2;
      else if (size === 3) s += 35 + openNeighborCount(board2d, g.cells) * 4;
    }

    const W = getWidth();
    const H = getHeight();
    const C = getColors();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = board2d[y][x];
        if (c === C.EMPTY || c === C.GARBAGE) continue;

        if (x + 2 < W && board2d[y][x + 1] === c && board2d[y][x + 2] === c) {
          if ((x - 1 >= 0 && board2d[y][x - 1] === C.EMPTY) || (x + 3 < W && board2d[y][x + 3] === C.EMPTY)) {
            s += 16;
          }
        }

        if (y + 2 < H && board2d[y + 1][x] === c && board2d[y + 2][x] === c) {
          if ((y - 1 >= 0 && board2d[y - 1][x] === C.EMPTY) || (y + 3 < H && board2d[y + 3][x] === C.EMPTY)) {
            s += 16;
          }
        }

        if (x + 1 < W && y + 1 < H) {
          const a = board2d[y][x];
          const b = board2d[y][x + 1];
          const d = board2d[y + 1][x];
          if (a === c && b === c && d === c) s += 20;
        }
      }
    }

    return s;
  }

  function evaluateBoard(board2d) {
    const heights = columnHeights(board2d);
    const holes = countHoles(board2d, heights);
    const maxH = Math.max(...heights);
    const bumpiness = heights.reduce((sum, h, i) => sum + (i > 0 ? Math.abs(h - heights[i - 1]) : 0), 0);

    let s = 0;
    s += templateScore(board2d) * 18;
    s += seedScore(board2d) * 10;

    const comps = findGroupsLoose(board2d);
    for (const g of comps) {
      const size = g.cells.length;
      if (size === 2) s += 10;
      else if (size === 3) s += 30 + openNeighborCount(board2d, g.cells) * 3;
      else if (size >= 5) s += Math.min(80, size * 8);
    }

    s -= holes * 38;
    s -= bumpiness * 10;
    s -= maxH * 30;
    s -= dangerPenalty(board2d);

    if (maxH >= getHeight() - 3) s -= 120;
    if (maxH >= getHeight() - 2) s -= 260;

    const counts = [0, 0, 0, 0, 0];
    for (let y = 0; y < getHeight(); y++) {
      for (let x = 0; x < getWidth(); x++) {
        const v = board2d[y][x];
        if (v >= 1 && v <= 4) counts[v]++;
      }
    }
    const sorted = counts.slice(1).sort((a, b) => b - a);
    s += (sorted[0] + sorted[1]) * 0.6;
    s -= (sorted[2] + sorted[3]) * 0.8;

    return s;
  }

  function chainOutcomeValue(sim) {
    const chainPart = Math.pow(sim.chains, 2.15) * 32000;
    const scorePart = sim.score * 8;
    const attackPart = sim.attack * 1800;
    const allClearPart = sim.allClear ? 250000 : 0;
    return chainPart + scorePart + attackPart + allClearPart;
  }

  function quickPlacementValue(board2d, sim) {
    return evaluateBoard(board2d) + chainOutcomeValue(sim) * 0.01;
  }

  function simulateMove(board2d, piece, x, y, rotation) {
    const placed = placePiece(board2d, piece, x, y, rotation);
    return resolveBoard(placed);
  }

  function pseudoLeafScore(board2d) {
    let best = evaluateBoard(board2d);

    const plays = [];
    for (const color of AI_CONFIG.PSEUDO_COLORS) {
      const dummy = { mainColor: color, subColor: color };
      const placements = enumeratePlacements(board2d, dummy);
      for (const p of placements) {
        const sim = simulateMove(board2d, dummy, p.x, p.y, p.rotation);
        const value = sim.chains > 0
          ? chainOutcomeValue(sim) + evaluateBoard(sim.board) * 0.1
          : evaluateBoard(sim.board) + seedScore(sim.board) * 3;
        plays.push({ value, sim });
      }
    }

    plays.sort((a, b) => b.value - a.value);
    for (let i = 0; i < Math.min(AI_CONFIG.LEAF_PSEUDO_BRANCH_LIMIT, plays.length); i++) {
      const node = plays[i];
      const v = node.value + (node.sim.chains === 0 ? evaluateBoard(node.sim.board) * 0.3 : 0);
      if (v > best) best = v;
    }

    return best;
  }

  function searchBest(board2d, pieces, depth, memo, rootMove) {
    const key = `${depth}|${boardToKey(board2d)}|${pieces.map(p => `${p.mainColor}${p.subColor}`).join(',')}`;
    if (memo.has(key)) return memo.get(key);

    if (depth >= pieces.length) {
      const score = pseudoLeafScore(board2d);
      const ret = { score, move: rootMove || null };
      memo.set(key, ret);
      return ret;
    }

    const piece = pieces[depth];
    const placements = enumeratePlacements(board2d, piece);
    if (!placements.length) {
      const ret = { score: -1e15, move: rootMove || null };
      memo.set(key, ret);
      return ret;
    }

    const candidates = [];
    for (const p of placements) {
      const sim = simulateMove(board2d, piece, p.x, p.y, p.rotation);
      const quick = quickPlacementValue(sim.board, sim);
      candidates.push({ ...p, sim, quick });
    }

    candidates.sort((a, b) => b.quick - a.quick);
    const beam = candidates.slice(0, AI_CONFIG.BEAM_WIDTH);

    let best = { score: -1e15, move: rootMove || null };

    for (const c of beam) {
      const moveHere = depth === 0 ? { x: c.x, y: c.y, rotation: c.rotation } : rootMove;
      let total;

      if (c.sim.chains > 0) {
        total = chainOutcomeValue(c.sim) + evaluateBoard(c.sim.board) * 0.1;
      } else if (depth + 1 >= pieces.length) {
        total = evaluateBoard(c.sim.board) * 0.25 + pseudoLeafScore(c.sim.board);
      } else {
        const child = searchBest(c.sim.board, pieces, depth + 1, memo, moveHere);
        total = evaluateBoard(c.sim.board) * 0.25 + child.score;
      }

      if (total > best.score) best = { score: total, move: moveHere };
    }

    memo.set(key, best);
    return best;
  }

  function chooseBestMoveFromState(state) {
    const width = Number.isFinite(state.width) ? state.width : getWidth();
    const height = Number.isFinite(state.height) ? state.height : getHeight();

    let board2d;
    if (Array.isArray(state.board)) {
      board2d = state.board.map(row => Array.isArray(row) ? row.slice() : []);
    } else {
      board2d = Array.from({ length: height }, () => Array(width).fill(0));
    }

    const pieces = normalizeStatePieces(state);
    if (!pieces.length) return null;

    const memo = new Map();
    const result = searchBest(board2d, pieces, 0, memo, null);
    return result.move ? { ...result.move, score: result.score } : null;
  }

  function chooseBestMoveMainThread() {
    const b = typeof board !== 'undefined' && Array.isArray(board) ? board : null;
    const cur = getCurrentPuyo();
    if (!b || !cur || getGameState() !== 'playing') return null;

    const pieces = readPiecesForMainThread();
    if (!pieces.length) return null;

    const memo = new Map();
    const snapshot = cloneBoard(b);
    const result = searchBest(snapshot, pieces, 0, memo, null);
    return result.move || null;
  }

  function applyMove(move) {
    const cur = getCurrentPuyo();
    if (!cur || !move) return false;
    cur.mainX = move.x | 0;
    cur.mainY = move.y | 0;
    cur.rotation = move.rotation | 0;
    if (typeof renderBoard === 'function') renderBoard();
    return true;
  }

  function hardDropCurrent() {
    if (typeof hardDrop === 'function') {
      hardDrop();
      return;
    }
    if (typeof lockPuyo === 'function') {
      lockPuyo();
    }
  }

  function packStateForWorker() {
    const cur = getCurrentPuyo();
    const q = getQueueArray();
    const idx = getQueueIndex();

    const pieces = [];
    if (cur) pieces.push({ mainColor: cur.mainColor | 0, subColor: cur.subColor | 0 });

    const p1 = pieceFromPair(q[idx]);
    const p2 = pieceFromPair(q[idx + 1]);
    if (p1) pieces.push(p1);
    if (p2) pieces.push(p2);

    return {
      width: getWidth(),
      height: getHeight(),
      board: typeof board !== 'undefined' && Array.isArray(board) ? board.map(row => row.slice()) : [],
      pieces,
      pendingOjama: getPendingOjama()
    };
  }

  function createWorkerFromUrl(url) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let worker = null;

      try {
        worker = new Worker(url);
      } catch (err) {
        reject(err);
        return;
      }

      const cleanup = () => {
        if (!worker) return;
        worker.onmessage = null;
        worker.onerror = null;
      };

      const readyTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        try { worker.terminate(); } catch (_) {}
        reject(new Error(`Worker ready timeout: ${url}`));
      }, AI_CONFIG.READY_TIMEOUT_MS);

      worker.onmessage = (ev) => {
        const msg = ev.data || {};
        if (msg.type !== 'ready') return;
        if (settled) return;
        settled = true;
        clearTimeout(readyTimer);
        cleanup();
        resolve(worker);
      };

      worker.onerror = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(readyTimer);
        cleanup();
        try { worker.terminate(); } catch (_) {}
        reject(err instanceof Error ? err : new Error(String(err)));
      };
    });
  }

  async function ensureWorker() {
    if (STATE.worker && STATE.workerReady) return true;
    if (STATE.workerDisabled) return false;
    if (STATE.workerReadyPromise) return STATE.workerReadyPromise;

    STATE.workerReadyPromise = (async () => {
      let lastErr = null;

      for (const url of AI_CONFIG.WORKER_CANDIDATES) {
        try {
          const worker = await createWorkerFromUrl(url);
          STATE.worker = worker;
          STATE.workerReady = true;

          worker.onmessage = (ev) => {
            const msg = ev.data || {};
            if (msg.type === 'result') {
              const job = STATE.pending.get(msg.jobId);
              if (!job) return;
              STATE.pending.delete(msg.jobId);
              job.resolve(msg.move || null);
            } else if (msg.type === 'error') {
              const job = STATE.pending.get(msg.jobId);
              if (job) {
                STATE.pending.delete(msg.jobId);
                job.reject(new Error(msg.message || 'AI worker error'));
              }
              updateStatus('AIエラー');
            }
          };

          worker.onerror = (err) => {
            console.error('AI worker runtime error:', err);
            STATE.workerReady = false;
            updateStatus('AI workerエラー');
          };

          updateStatus('AI待機中');
          return true;
        } catch (err) {
          lastErr = err;
        }
      }

      STATE.workerReady = false;
      STATE.workerDisabled = true;
      throw lastErr || new Error('All worker candidates failed');
    })();

    try {
      await STATE.workerReadyPromise;
      return true;
    } catch (err) {
      console.error('Failed to initialize AI worker:', err);
      updateStatus('AI worker初期化失敗');
      STATE.workerReadyPromise = null;
      return false;
    } finally {
      if (!STATE.workerReady) STATE.workerReadyPromise = null;
    }
  }

  function postSearchJobToWorker(state) {
    return new Promise(async (resolve, reject) => {
      const ok = await ensureWorker();
      if (!ok || !STATE.worker || !STATE.workerReady) {
        reject(new Error('AI worker not ready'));
        return;
      }

      const jobId = ++STATE.jobSeq;
      STATE.pending.set(jobId, { resolve, reject });

      STATE.worker.postMessage({ type: 'search', jobId, state });

      setTimeout(() => {
        const job = STATE.pending.get(jobId);
        if (!job) return;
        STATE.pending.delete(jobId);
        job.reject(new Error('AI search timeout'));
        updateStatus('AI思考タイムアウト');
      }, AI_CONFIG.THINK_TIMEOUT_MS);
    });
  }

  async function requestBestMove() {
    const state = packStateForWorker();
    if (!STATE.workerDisabled && STATE.workerReady) {
      try {
        return await postSearchJobToWorker(state);
      } catch (err) {
        console.error('Worker search failed, falling back to main thread:', err);
      }
    }
    return chooseBestMoveMainThread();
  }

  async function runOneMove() {
    if (STATE.busy) return;
    if (getGameState() !== 'playing') {
      updateStatus('AI待機中');
      return;
    }
    if (!getCurrentPuyo()) {
      updateStatus('AI待機中');
      return;
    }

    STATE.busy = true;
    updateStatus('AI思考中...');

    try {
      const result = await requestBestMove();
      const move = result && result.move ? result.move : result;
      if (!move) {
        updateStatus('手が見つかりません');
        return;
      }

      applyMove(move);
      hardDropCurrent();
      updateStatus('AI実行完了');
    } catch (err) {
      console.error('AI error:', err);
      updateStatus('AIエラー');
    } finally {
      STATE.busy = false;
    }
  }

  function startAutoLoop() {
    stopAutoLoop();
    STATE.autoTimer = setInterval(() => {
      if (!STATE.autoEnabled || STATE.busy) return;
      if (getGameState() !== 'playing') return;
      if (!getCurrentPuyo()) return;
      runOneMove();
    }, AI_CONFIG.AUTO_TICK_MS);
  }

  function stopAutoLoop() {
    if (STATE.autoTimer) {
      clearInterval(STATE.autoTimer);
      STATE.autoTimer = null;
    }
  }

  function initUI() {
    updateAutoButton();
    updateStatus('AI待機中');
  }

  function bootMain() {
    if (STATE.booted) return;
    STATE.booted = true;
    initUI();
    ensureWorker().catch((err) => {
      console.error(err);
      updateStatus('AI worker初期化失敗');
    });
  }

  function bootWorker() {
    global.onmessage = (ev) => {
      const msg = ev.data || {};
      if (msg.type !== 'search') return;
      try {
        const move = chooseBestMoveFromState(msg.state || {});
        global.postMessage({ type: 'result', jobId: msg.jobId, move });
      } catch (err) {
        global.postMessage({
          type: 'error',
          jobId: msg.jobId,
          message: err && err.message ? err.message : String(err)
        });
      }
    };
    global.postMessage({ type: 'ready' });
  }

  // ---------- public API ----------
  global.runPuyoAI = function () {
    if (IS_WORKER) return;
    runOneMove();
  };

  global.toggleAIAuto = function () {
    if (IS_WORKER) return;
    STATE.autoEnabled = !STATE.autoEnabled;
    updateAutoButton();

    if (STATE.autoEnabled) {
      updateStatus('AI自動起動');
      startAutoLoop();
      runOneMove();
    } else {
      stopAutoLoop();
      updateStatus('AI待機中');
    }
  };

  global.PuyoAI = {
    requestBestMove,
    chooseBestMoveMainThread,
    chooseBestMoveFromState,
    evaluateBoard,
    resolveBoard,
    searchBest,
    templateScore,
    seedScore,
    dangerPenalty,
    ensureWorker
  };

  if (IS_WORKER) {
    bootWorker();
  } else {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootMain);
    } else {
      bootMain();
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        stopAutoLoop();
        if (STATE.worker) {
          STATE.worker.terminate();
          STATE.worker = null;
        }
      });
    }
  }
})(typeof self !== 'undefined' ? self : window);