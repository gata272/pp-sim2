/* puyo-ai-worker.js
 * GTR-first / seed-building / 8-chain-fire AI worker
 * Message protocol:
 *   in : { type: 'search', jobId, state: { width, height, boardBuffer, pieceBuffer, pendingOjama } }
 *   out: { type: 'ready' }
 *   out: { type: 'result', jobId, move, score, chains, allClear }
 *   out: { type: 'error', jobId, message }
 */
(() => {
  'use strict';

  const W_DEFAULT = 6;
  const H_DEFAULT = 14;

  const COLORS = {
    EMPTY: 0,
    RED: 1,
    BLUE: 2,
    GREEN: 3,
    YELLOW: 4,
    GARBAGE: 5,
  };

  const BONUS_TABLE = {
    CHAIN: [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512],
    GROUP: [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    COLOR: [0, 0, 3, 6, 12]
  };

  const AI = {
    BEAM_WIDTH: 12,
    MAX_CANDIDATES: 24,
    THRESHOLD_OPENING_FILLED: 12,
    THRESHOLD_OPENING_MAXH: 3,
    DANGER_CELL_X: 2,
    DANGER_CELL_Y: 11,
    OPENING_WEIGHT: 18,
    SEED_WEIGHT: 12,
    CHAIN8_BONUS: 700000,
    CHAIN_STRONG_BONUS: 85000,
    TIMEOUT_SAFE_MARGIN_MS: 0
  };

  const stateCtx = {
    pendingOjama: 0,
    width: W_DEFAULT,
    height: H_DEFAULT,
  };

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function keyBoard(board) {
    return board.map(row => row.join('')).join('|');
  }

  function isBoardLike(v) {
    return Array.isArray(v) && Array.isArray(v[0]);
  }

  function getWidth(v) {
    return Number.isFinite(v) ? v : W_DEFAULT;
  }

  function getHeight(v) {
    return Number.isFinite(v) ? v : H_DEFAULT;
  }

  function emptyBoard(w, h) {
    return Array.from({ length: h }, () => Array(w).fill(COLORS.EMPTY));
  }

  function decodeBoard(buffer, w, h) {
    const board = emptyBoard(w, h);
    let view = null;

    if (buffer instanceof Uint8Array) {
      view = buffer;
    } else if (buffer instanceof ArrayBuffer) {
      view = new Uint8Array(buffer);
    } else if (Array.isArray(buffer)) {
      view = Uint8Array.from(buffer);
    } else {
      view = new Uint8Array(w * h);
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        board[y][x] = view[y * w + x] || COLORS.EMPTY;
      }
    }
    return board;
  }

  function decodePieces(pieceBuffer) {
    const out = [];
    let view = null;

    if (pieceBuffer instanceof Uint8Array) {
      view = pieceBuffer;
    } else if (pieceBuffer instanceof ArrayBuffer) {
      view = new Uint8Array(pieceBuffer);
    } else if (Array.isArray(pieceBuffer)) {
      view = Uint8Array.from(pieceBuffer);
    } else {
      view = new Uint8Array(6);
    }

    for (let i = 0; i < 3; i++) {
      const mainColor = view[i * 2] || 0;
      const subColor = view[i * 2 + 1] || 0;
      if (mainColor || subColor) {
        out.push({ mainColor, subColor });
      }
    }
    return out;
  }

  function cloneBoard(board) {
    return board.map(row => row.slice());
  }

  function totalFilled(board) {
    let c = 0;
    for (const row of board) {
      for (const v of row) if (v !== COLORS.EMPTY) c++;
    }
    return c;
  }

  function columnHeights(board) {
    const h = board.length;
    const w = board[0].length;
    const heights = Array(w).fill(0);

    for (let x = 0; x < w; x++) {
      let yTop = -1;
      for (let y = h - 1; y >= 0; y--) {
        if (board[y][x] !== COLORS.EMPTY) {
          yTop = y;
          break;
        }
      }
      heights[x] = yTop + 1;
    }
    return heights;
  }

  function maxHeight(heights) {
    return heights.reduce((m, v) => Math.max(m, v), 0);
  }

  function countHoles(board, heights) {
    let holes = 0;
    for (let x = 0; x < board[0].length; x++) {
      for (let y = 0; y < heights[x]; y++) {
        if (board[y][x] === COLORS.EMPTY) holes++;
      }
    }
    return holes;
  }

  function bumpiness(heights) {
    let b = 0;
    for (let i = 1; i < heights.length; i++) {
      b += Math.abs(heights[i] - heights[i - 1]);
    }
    return b;
  }

  function countColors(board) {
    const counts = [0, 0, 0, 0, 0];
    for (const row of board) {
      for (const v of row) {
        if (v >= 1 && v <= 4) counts[v]++;
      }
    }
    return counts;
  }

  function isOpeningBoard(board) {
    const heights = columnHeights(board);
    return totalFilled(board) <= AI.THRESHOLD_OPENING_FILLED || maxHeight(heights) <= AI.THRESHOLD_OPENING_MAXH;
  }

  function boardHasDanger(board) {
    const x = AI.DANGER_CELL_X;
    const y = AI.DANGER_CELL_Y;
    if (!board[y] || board[y][x] === undefined) return false;
    return board[y][x] !== COLORS.EMPTY;
  }

  function dangerPenalty(board) {
    const heights = columnHeights(board);
    let p = 0;

    if (boardHasDanger(board)) p += 1000000;
    if (heights[AI.DANGER_CELL_X] >= AI.DANGER_CELL_Y + 1) p += 250000;
    if (heights[AI.DANGER_CELL_X] >= AI.DANGER_CELL_Y - 1) p += 80000;

    for (let y = Math.max(0, AI.DANGER_CELL_Y - 2); y <= AI.DANGER_CELL_Y; y++) {
      if (board[y] && board[y][AI.DANGER_CELL_X] !== COLORS.EMPTY) {
        p += 25000;
      }
    }
    return p;
  }

  function symbolMapForPieces(pieces) {
    const map = new Map();
    let next = 0;
    const symbolFor = (color) => {
      if (!map.has(color)) {
        map.set(color, String.fromCharCode(65 + next));
        next++;
      }
      return map.get(color);
    };

    const patterns = pieces.map(p => {
      if (!p) return '';
      return symbolFor(p.mainColor) + symbolFor(p.subColor);
    });
    return { patterns, symbolFor };
  }

  function samePair(pattern) {
    return pattern && pattern.length === 2 && pattern[0] === pattern[1];
  }

  function mixedPair(pattern) {
    return pattern && pattern.length === 2 && pattern[0] !== pattern[1];
  }

  function sharedOne(a, b) {
    if (!a || !b) return false;
    const sa = new Set(a.split(''));
    const sb = new Set(b.split(''));
    let n = 0;
    for (const x of sa) if (sb.has(x)) n++;
    return n === 1;
  }

  function classifyOpeningFamilies(patterns) {
    const p0 = patterns[0] || '';
    const p1 = patterns[1] || '';
    const fams = [];

    if (samePair(p0) && samePair(p1)) {
      fams.push('AABB');
    }
    if (samePair(p0) && mixedPair(p1)) {
      fams.push('AAAB');
      fams.push('AABC');
    }
    if (mixedPair(p0) && mixedPair(p1)) {
      if (sharedOne(p0, p1)) fams.push('ABAC');
      else fams.push('ABAB');
    }
    return fams;
  }

  function piecePatternToSlots(piecePattern, rotation) {
    const main = piecePattern[0];
    const sub = piecePattern[1];

    if (rotation === 0) {
      return { top: sub, bottom: main, left: null, right: null };
    }
    if (rotation === 2) {
      return { top: main, bottom: sub, left: null, right: null };
    }
    if (rotation === 1) {
      return { left: sub, right: main, top: null, bottom: null };
    }
    if (rotation === 3) {
      return { left: main, right: sub, top: null, bottom: null };
    }
    return { top: null, bottom: null, left: null, right: null };
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

  function canPlace(board, piece, x, y, rotation) {
    const w = board[0].length;
    const h = board.length;
    const coords = getPieceCoords(piece, x, y, rotation);

    for (const c of coords) {
      if (c.x < 0 || c.x >= w || c.y < 0 || c.y >= h) return false;
      if (board[c.y][c.x] !== COLORS.EMPTY) return false;
    }
    return true;
  }

  function findRestY(board, piece, x, rotation) {
    const h = board.length;
    let y = h - 1;
    while (y >= 0 && !canPlace(board, piece, x, y, rotation)) y--;
    if (y < 0) return null;
    while (y > 0 && canPlace(board, piece, x, y - 1, rotation)) y--;
    return y;
  }

  function generatePlacements(board, piece) {
    const w = board[0].length;
    const out = [];
    for (let rot = 0; rot < 4; rot++) {
      for (let x = 0; x < w; x++) {
        const y = findRestY(board, piece, x, rot);
        if (y !== null) out.push({ x, y, rotation: rot });
      }
    }
    return out;
  }

  function placePiece(board, piece, move) {
    const next = cloneBoard(board);
    const coords = getPieceCoords(piece, move.x, move.y, move.rotation);
    for (const c of coords) {
      if (c.x >= 0 && c.x < next[0].length && c.y >= 0 && c.y < next.length) {
        next[c.y][c.x] = c.color;
      }
    }
    return next;
  }

  function gravityOn(board) {
    const w = board[0].length;
    const h = board.length;
    for (let x = 0; x < w; x++) {
      const col = [];
      for (let y = 0; y < h; y++) {
        if (board[y][x] !== COLORS.EMPTY) col.push(board[y][x]);
      }
      for (let y = 0; y < h; y++) {
        board[y][x] = y < col.length ? col[y] : COLORS.EMPTY;
      }
    }
  }

  function findGroups(board) {
    const w = board[0].length;
    const h = board.length;
    const visited = Array.from({ length: h }, () => Array(w).fill(false));
    const groups = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const color = board[y][x];
        if (color === COLORS.EMPTY || color === COLORS.GARBAGE || visited[y][x]) continue;

        const stack = [{ x, y }];
        visited[y][x] = true;
        const group = [];

        while (stack.length) {
          const cur = stack.pop();
          group.push(cur);

          const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
          for (const [dx, dy] of dirs) {
            const nx = cur.x + dx;
            const ny = cur.y + dy;
            if (
              nx >= 0 && nx < w &&
              ny >= 0 && ny < h &&
              !visited[ny][nx] &&
              board[ny][nx] === color
            ) {
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

  function clearGarbageNeighbors(board, erasedCoords) {
    const w = board[0].length;
    const h = board.length;
    const toClear = new Set();

    for (const { x, y } of erasedCoords) {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          if (board[ny][nx] === COLORS.GARBAGE) toClear.add(`${nx},${ny}`);
        }
      }
    }

    for (const key of toClear) {
      const [x, y] = key.split(',').map(Number);
      board[y][x] = COLORS.EMPTY;
    }
  }

  function chainBonus(chainNo) {
    const idx = clamp(chainNo - 1, 0, BONUS_TABLE.CHAIN.length - 1);
    return BONUS_TABLE.CHAIN[idx] || 0;
  }

  function groupBonus(size) {
    const idx = clamp(size, 0, BONUS_TABLE.GROUP.length - 1);
    return BONUS_TABLE.GROUP[idx] || 0;
  }

  function colorBonus(colorCount) {
    const idx = clamp(colorCount, 0, BONUS_TABLE.COLOR.length - 1);
    return BONUS_TABLE.COLOR[idx] || 0;
  }

  function calculateScore(groups, chainNo) {
    let totalPuyos = 0;
    const colors = new Set();
    let bonusTotal = 0;

    for (const { color, group } of groups) {
      totalPuyos += group.length;
      colors.add(color);
      bonusTotal += groupBonus(group.length);
    }

    bonusTotal += chainBonus(chainNo);
    bonusTotal += colorBonus(colors.size);
    if (bonusTotal <= 0) bonusTotal = 1;

    return 10 * totalPuyos * bonusTotal;
  }

  function resolveBoard(board) {
    const resolved = cloneBoard(board);
    let totalChains = 0;
    let totalScore = 0;
    let totalAttack = 0;

    while (true) {
      gravityOn(resolved);
      const groups = findGroups(resolved);
      if (groups.length === 0) break;

      totalChains++;
      const chainScore = calculateScore(groups, totalChains);
      totalScore += chainScore;
      totalAttack += Math.floor(Math.max(0, chainScore) / 70);

      const erased = [];
      for (const { group } of groups) {
        for (const p of group) {
          resolved[p.y][p.x] = COLORS.EMPTY;
          erased.push(p);
        }
      }
      clearGarbageNeighbors(resolved, erased);
    }

    gravityOn(resolved);

    const allClear = isBoardEmpty(resolved);
    if (allClear) {
      totalScore += 2100;
      totalAttack += Math.floor(2100 / 70);
    }

    return {
      board: resolved,
      chains: totalChains,
      score: totalScore,
      attack: totalAttack,
      allClear
    };
  }

  function isBoardEmpty(board) {
    for (const row of board) {
      for (const v of row) if (v !== COLORS.EMPTY) return false;
    }
    return true;
  }

  function openNeighborCount(board, cells) {
    const w = board[0].length;
    const h = board.length;
    const seen = new Set();
    let count = 0;

    for (const { x, y } of cells) {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && board[ny][nx] === COLORS.EMPTY) {
          const k = `${nx},${ny}`;
          if (!seen.has(k)) {
            seen.add(k);
            count++;
          }
        }
      }
    }
    return count;
  }

  function looseGroups(board) {
    const w = board[0].length;
    const h = board.length;
    const visited = Array.from({ length: h }, () => Array(w).fill(false));
    const out = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const color = board[y][x];
        if (color === COLORS.EMPTY || color === COLORS.GARBAGE || visited[y][x]) continue;

        const stack = [{ x, y }];
        visited[y][x] = true;
        const cells = [];

        while (stack.length) {
          const cur = stack.pop();
          cells.push(cur);

          const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
          for (const [dx, dy] of dirs) {
            const nx = cur.x + dx;
            const ny = cur.y + dy;
            if (
              nx >= 0 && nx < w &&
              ny >= 0 && ny < h &&
              !visited[ny][nx] &&
              board[ny][nx] === color
            ) {
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

  function seedScore(board) {
    let s = 0;
    const comps = looseGroups(board);

    for (const g of comps) {
      const size = g.cells.length;
      const opens = openNeighborCount(board, g.cells);

      if (size === 1) s += 1;
      else if (size === 2) s += 18 + opens * 4;
      else if (size === 3) s += 60 + opens * 8;
      else if (size >= 4) s += 90 + size * 10;
    }

    const w = board[0].length;
    const h = board.length;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = board[y][x];
        if (c === COLORS.EMPTY || c === COLORS.GARBAGE) continue;

        if (x + 2 < w && board[y][x + 1] === c && board[y][x + 2] === c) {
          if ((x - 1 >= 0 && board[y][x - 1] === COLORS.EMPTY) || (x + 3 < w && board[y][x + 3] === COLORS.EMPTY)) {
            s += 24;
          }
        }
        if (y + 2 < h && board[y + 1][x] === c && board[y + 2][x] === c) {
          if ((y - 1 >= 0 && board[y - 1][x] === COLORS.EMPTY) || (y + 3 < h && board[y + 3][x] === COLORS.EMPTY)) {
            s += 24;
          }
        }
        if (x + 1 < w && y + 1 < h) {
          if (board[y][x] === c && board[y][x + 1] === c && board[y + 1][x] === c) {
            s += 30;
          }
        }
      }
    }

    return s;
  }

  function gtrScaffoldScore(board) {
    const h = columnHeights(board);
    const filled = totalFilled(board);

    let s = 0;
    s += 50 - Math.abs(h[0] - h[1]) * 12;
    s += 24 - Math.max(0, h[0] - h[2]) * 4 - Math.max(0, h[1] - h[2]) * 4;
    s += Math.max(0, h[3] - h[2]) * 8;
    s += Math.max(0, h[4] - h[2]) * 8;
    s += Math.max(0, 3 - h[5]) * 2;
    s += Math.min(h[0], 2) * 4;
    s += Math.min(h[1], 2) * 4;
    s += Math.min(h[2], 3) * 3;

    if (filled <= 8) s += 180;
    else if (filled <= 16) s += 80;
    else s -= (filled - 16) * 2;

    if (h[0] >= 5 || h[1] >= 5) s -= 40;
    return s;
  }

  function genericTemplateScore(board) {
    const h = columnHeights(board);
    let best1 = 0;
    let best2 = 0;

    const templates = [
      { mask: [1, 1, 1, 1, 0, 0], profile: [0, 1, 2, 3, 0, 0], weight: 1.00 },
      { mask: [0, 0, 1, 1, 1, 1], profile: [0, 0, 3, 2, 1, 0], weight: 1.00 },
      { mask: [1, 1, 1, 1, 1, 0], profile: [0, 1, 2, 2, 1, 0], weight: 1.25 },
      { mask: [0, 1, 1, 1, 1, 1], profile: [0, 1, 2, 2, 1, 0], weight: 1.25 },
      { mask: [1, 1, 1, 1, 1, 1], profile: [2, 1, 0, 0, 1, 2], weight: 1.10 },
      { mask: [0, 1, 1, 1, 1, 0], profile: [0, 1, 2, 3, 2, 1], weight: 1.05 },
      { mask: [1, 1, 1, 1, 1, 1], profile: [1, 2, 1, 1, 2, 1], weight: 0.95 }
    ];

    for (const t of templates) {
      const cols = [];
      for (let x = 0; x < 6; x++) if (t.mask[x]) cols.push(x);
      if (!cols.length) continue;

      let base = Infinity;
      for (const x of cols) base = Math.min(base, h[x] - t.profile[x]);
      if (!Number.isFinite(base)) continue;

      let s = 0;
      let occupied = 0;
      for (const x of cols) {
        const target = base + t.profile[x];
        const diff = Math.abs(h[x] - target);
        s += Math.max(0, 8 - diff * 3);
        if (h[x] > 0) occupied++;
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

  function evaluateBoard(board) {
    const h = columnHeights(board);
    const holes = countHoles(board, h);
    const maxH = maxHeight(h);
    const bump = bumpiness(h);
    const counts = countColors(board);

    let s = 0;
    s += gtrScaffoldScore(board) * AI.OPENING_WEIGHT;
    s += genericTemplateScore(board) * 10;
    s += seedScore(board) * AI.SEED_WEIGHT;

    const sorted = counts.slice(1).sort((a, b) => b - a);
    s += (sorted[0] + sorted[1]) * 0.5;
    s -= (sorted[2] + sorted[3]) * 0.8;

    s -= holes * 40;
    s -= bump * 10;
    s -= maxH * 28;
    s -= dangerPenalty(board);

    if (maxH >= 11) s -= 120;
    if (maxH >= 12) s -= 260;

    if (stateCtx.pendingOjama > 0) {
      s += stateCtx.pendingOjama * 16;
    }

    return s;
  }

  function chainOutcomeValue(sim) {
    if (!sim || !sim.chains) return 0;
    const chainPart = Math.pow(sim.chains, 2.15) * 30000;
    const scorePart = sim.score * 7;
    const attackPart = sim.attack * 1500;
    const allClearPart = sim.allClear ? 250000 : 0;

    if (sim.chains >= 8) {
      return AI.CHAIN8_BONUS + chainPart + scorePart + attackPart + allClearPart;
    }
    if (sim.chains >= 4) {
      return AI.CHAIN_STRONG_BONUS + chainPart + scorePart + attackPart + allClearPart;
    }
    return chainPart + scorePart + attackPart + allClearPart;
  }

  function patternScoreForMove(boardBefore, boardAfter, pieces, depth, piecePattern, move) {
    const families = classifyOpeningFamilies(pieces.patterns);
    let score = 0;

    const addIfMatch = (rule) => {
      if (rule.pattern && rule.pattern !== piecePattern) return;
      if (rule.depth !== depth) return;

      if (rule.kind === 'H') {
        if (!(move.rotation === 1 || move.rotation === 3)) return;
        const coords = getPieceCoords(pieces.raw[depth], move.x, move.y, move.rotation);
        const xs = coords.map(c => c.x).sort((a, b) => a - b);
        if (rule.cols && (xs.length !== rule.cols.length || xs.some((v, i) => v !== rule.cols[i]))) return;
        if (rule.left && piecePatternToSlots(piecePattern, move.rotation).left !== rule.left) return;
        if (rule.right && piecePatternToSlots(piecePattern, move.rotation).right !== rule.right) return;
        score += rule.score || 0;
      }

      if (rule.kind === 'V') {
        if (!(move.rotation === 0 || move.rotation === 2)) return;
        if (rule.x !== undefined && move.x !== rule.x) return;
        const slots = piecePatternToSlots(piecePattern, move.rotation);
        if (rule.bottom && slots.bottom !== rule.bottom) return;
        if (rule.top && slots.top !== rule.top) return;
        score += rule.score || 0;
      }
    };

    const rules = {
      AAAB: [
        { depth: 0, pattern: 'AA', kind: 'H', cols: [0, 1], score: 220000 },
        { depth: 0, pattern: 'AB', kind: 'V', x: 2, bottom: 'B', score: 220000 },

        { depth: 1, pattern: 'AA', kind: 'H', cols: [3, 4], score: 180000 },
        { depth: 1, pattern: 'AB', kind: 'V', x: 3, bottom: 'A', score: 180000 },
        { depth: 1, pattern: 'AC', kind: 'V', x: 1, bottom: 'C', score: 180000 },
        { depth: 1, pattern: 'BB', kind: 'V', x: 3, score: 150000 },
        { depth: 1, pattern: 'BC', kind: 'V', x: 3, bottom: 'C', score: 180000 },
        { depth: 1, pattern: 'CC', kind: 'H', cols: [0, 1], score: 150000 },
        { depth: 1, pattern: 'CD', kind: 'H', cols: [4, 5], score: 130000 },
        { depth: 1, pattern: 'CD', kind: 'V', x: 5, bottom: 'C', score: 120000 },

        { depth: 2, pattern: 'BB', kind: 'V', x: 0, score: 120000 },
        { depth: 2, pattern: 'CC', kind: 'H', cols: [3, 4], score: 100000 },
        { depth: 2, pattern: 'BC', kind: 'H', cols: [4, 5], score: 100000 }
      ],

      AABB: [
        { depth: 0, pattern: 'AA', kind: 'H', cols: [0, 1], score: 230000 },
        { depth: 1, pattern: 'BB', kind: 'H', cols: [0, 1], score: 220000 },

        { depth: 2, pattern: 'AA', kind: 'H', cols: [3, 4], score: 150000 },
        { depth: 2, pattern: 'AB', kind: 'H', cols: [0, 1], right: 'A', score: 120000 },
        { depth: 2, pattern: 'AC', kind: 'V', x: 2, bottom: 'C', score: 120000 },
        { depth: 2, pattern: 'BB', kind: 'H', cols: [3, 4], score: 150000 },
        { depth: 2, pattern: 'BC', kind: 'V', x: 0, bottom: 'B', score: 110000 },
        { depth: 2, pattern: 'CC', kind: 'H', cols: [3, 4], score: 150000 },
        { depth: 2, pattern: 'CD', kind: 'H', cols: [4, 5], score: 120000 },
        { depth: 2, pattern: 'CD', kind: 'V', x: 5, bottom: 'C', score: 120000 }
      ],

      ABAB: [
        { depth: 0, pattern: 'AB', kind: 'V', x: 0, bottom: 'A', score: 180000 },
        { depth: 0, pattern: 'AB', kind: 'V', x: 0, bottom: 'B', score: 180000 },
        { depth: 0, pattern: 'AB', kind: 'V', x: 1, bottom: 'A', score: 170000 },
        { depth: 0, pattern: 'AB', kind: 'V', x: 1, bottom: 'B', score: 170000 },

        { depth: 1, pattern: 'AB', kind: 'V', x: 1, bottom: 'A', score: 180000 },
        { depth: 1, pattern: 'AB', kind: 'V', x: 1, bottom: 'B', score: 180000 },
        { depth: 1, pattern: 'AB', kind: 'V', x: 0, bottom: 'A', score: 170000 },
        { depth: 1, pattern: 'AB', kind: 'V', x: 0, bottom: 'B', score: 170000 }
      ],

      ABAC: [
        { depth: 0, pattern: 'AB', kind: 'H', cols: [1, 2], left: 'A', score: 190000 },
        { depth: 0, pattern: 'AB', kind: 'V', x: 0, bottom: 'A', score: 170000 },

        { depth: 1, pattern: 'AC', kind: 'V', x: 0, bottom: 'A', score: 180000 },
        { depth: 1, pattern: 'CD', kind: 'V', x: 3, bottom: 'D', score: 170000 },
        { depth: 1, pattern: 'AC', kind: 'H', cols: [1, 2], left: 'A', score: 160000 },
        { depth: 1, pattern: 'AB', kind: 'H', cols: [1, 2], right: 'A', score: 150000 },
        { depth: 1, pattern: 'BB', kind: 'H', cols: [0, 1], score: 140000 }
      ],

      AABC: [
        { depth: 0, pattern: 'AA', kind: 'H', cols: [0, 1], score: 220000 },

        { depth: 1, pattern: 'BC', kind: 'H', cols: [2, 3], right: 'B', score: 190000 },
        { depth: 1, pattern: 'AB', kind: 'H', cols: [4, 5], left: 'B', score: 180000 },
        { depth: 1, pattern: 'BB', kind: 'H', cols: [4, 5], score: 170000 },
        { depth: 1, pattern: 'BC', kind: 'V', x: 4, bottom: 'B', score: 170000 },
        { depth: 1, pattern: 'BD', kind: 'H', cols: [4, 5], left: 'B', score: 170000 },

        { depth: 2, pattern: 'AA', kind: 'H', cols: [1, 2], score: 120000 },
        { depth: 2, pattern: 'BC', kind: 'H', cols: [1, 2], score: 100000 },
        { depth: 2, pattern: 'AD', kind: 'H', cols: [1, 2], score: 100000 },
        { depth: 2, pattern: 'DD', kind: 'H', cols: [0, 1], score: 90000 }
      ]
    };

    for (const fam of families) {
      const list = rules[fam] || [];
      for (const rule of list) addIfMatch(rule);
    }

    // GTR-like scaffold bonus even when a rule does not perfectly match
    const openingBoost = isOpeningBoard(boardBefore) ? 1 : 0.35;
    score += (gtrScaffoldScore(boardAfter) - gtrScaffoldScore(boardBefore)) * 500 * openingBoost;
    return score;
  }

  function evaluateCandidate(boardBefore, pieces, depth, piece, move, sim) {
    const piecePattern = pieces.patterns[depth] || '';
    let s = evaluateBoard(sim.board);

    // If immediate chain is likely, prefer it strongly.
    if (sim.chains >= 8) {
      s += chainOutcomeValue(sim) * 2.0;
    } else if (sim.chains > 0) {
      s += chainOutcomeValue(sim) * 1.2;
    } else {
      // build seeds for future chains
      s += seedScore(sim.board) * 4;
    }

    s += patternScoreForMove(boardBefore, sim.board, pieces, depth, piecePattern, move);

    // Slightly prefer moves that keep the board low and smooth in opening.
    const h = columnHeights(sim.board);
    s -= holesPenaltyFromHeights(sim.board, h);
    return s;
  }

  function holesPenaltyFromHeights(board, heights) {
    const holes = countHoles(board, heights);
    const maxH = maxHeight(heights);
    return holes * 4 + bumpiness(heights) * 1.5 + maxH * 2;
  }

  function simulateMove(board, piece, move) {
    const placed = placePiece(board, piece, move);
    return resolveBoard(placed);
  }

  function searchBest(board, pieces, depth, memo, rootMove) {
    const key = `${depth}|${keyBoard(board)}|${pieces.patterns.join(',')}`;
    if (memo.has(key)) return memo.get(key);

    if (depth >= pieces.raw.length) {
      const ret = { score: evaluateBoard(board), move: rootMove || null };
      memo.set(key, ret);
      return ret;
    }

    const piece = pieces.raw[depth];
    const placements = generatePlacements(board, piece);

    if (!placements.length) {
      const ret = { score: -1e18, move: rootMove || null };
      memo.set(key, ret);
      return ret;
    }

    const ranked = [];
    for (const move of placements) {
      const sim = simulateMove(board, piece, move);
      const local = evaluateCandidate(board, pieces, depth, piece, move, sim);
      ranked.push({ move, sim, local });
    }

    ranked.sort((a, b) => b.local - a.local);
    const beam = ranked.slice(0, AI.BEAM_WIDTH);

    let best = { score: -1e18, move: rootMove || null };

    for (const c of beam) {
      const nextRoot = depth === 0 ? { x: c.move.x, y: c.move.y, rotation: c.move.rotation } : rootMove;
      let total = c.local;

      if (depth + 1 < pieces.raw.length) {
        const child = searchBest(c.sim.board, pieces, depth + 1, memo, nextRoot);
        total += child.score * 0.55;
      }

      if (total > best.score) {
        best = { score: total, move: nextRoot };
      }
    }

    memo.set(key, best);
    return best;
  }

  function chooseBestMove(state) {
    const w = getWidth(state.width);
    const h = getHeight(state.height);

    const board = decodeBoard(state.boardBuffer, w, h);
    const piecesRaw = decodePieces(state.pieceBuffer);
    if (!piecesRaw.length) return null;

    const { patterns } = symbolMapForPieces(piecesRaw);
    const pieces = { raw: piecesRaw, patterns };

    const memo = new Map();
    const result = searchBest(board, pieces, 0, memo, null);
    return result.move || null;
  }

  function handleSearch(msg) {
    try {
      const state = msg.state || {};
      stateCtx.width = getWidth(state.width);
      stateCtx.height = getHeight(state.height);
      stateCtx.pendingOjama = Math.max(0, Math.floor(Number(state.pendingOjama) || 0));

      const move = chooseBestMove(state);
      self.postMessage({
        type: 'result',
        jobId: msg.jobId,
        move,
        score: 0
      });
    } catch (err) {
      self.postMessage({
        type: 'error',
        jobId: msg.jobId,
        message: err && err.stack ? err.stack : String(err)
      });
    }
  }

  self.onmessage = (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'search') {
      handleSearch(msg);
    }
  };

  self.postMessage({ type: 'ready' });
})();