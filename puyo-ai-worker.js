(() => {
  'use strict';

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
    OPENING_THRESHOLD_FILLED: 18,
    OPENING_THRESHOLD_MAXH: 4,
    DANGER_X: 2,
    DANGER_Y: 11,
    GTR_WEIGHT: 28,
    SEED_WEIGHT: 18,
    TEMPLATE_WEIGHT: 8,
    CHAIN8_BONUS: 700000,
    CHAIN4_BONUS: 85000,
  };

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function getWidth(v) {
    return Number.isFinite(v) ? v : 6;
  }

  function getHeight(v) {
    return Number.isFinite(v) ? v : 14;
  }

  function cloneBoard(src) {
    return src.map(row => row.slice());
  }

  function boardToKey(board) {
    return board.map(row => row.join('')).join('|');
  }

  function decodeBoard(buffer, w, h) {
    const out = Array.from({ length: h }, () => Array(w).fill(COLORS.EMPTY));
    const view = buffer instanceof Uint8Array
      ? buffer
      : buffer instanceof ArrayBuffer
        ? new Uint8Array(buffer)
        : Array.isArray(buffer)
          ? Uint8Array.from(buffer)
          : new Uint8Array(w * h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        out[y][x] = view[y * w + x] || COLORS.EMPTY;
      }
    }
    return out;
  }

  function decodePieces(pieceBuffer) {
    const view = pieceBuffer instanceof Uint8Array
      ? pieceBuffer
      : pieceBuffer instanceof ArrayBuffer
        ? new Uint8Array(pieceBuffer)
        : Array.isArray(pieceBuffer)
          ? Uint8Array.from(pieceBuffer)
          : new Uint8Array(8);

    const pieces = [];
    const count = Math.min(4, Math.floor(view.length / 2));
    for (let i = 0; i < count; i++) {
      const mainColor = view[i * 2] || 0;
      const subColor = view[i * 2 + 1] || 0;
      if (mainColor || subColor) pieces.push({ mainColor, subColor });
    }
    return pieces;
  }

  function makeSymbolPatterns(pieces) {
    const map = new Map();
    let next = 0;
    const sym = (color) => {
      if (!map.has(color)) map.set(color, String.fromCharCode(65 + next++));
      return map.get(color);
    };
    return pieces.map(p => `${sym(p.mainColor)}${sym(p.subColor)}`);
  }

  function samePair(p) {
    return !!p && p.length === 2 && p[0] === p[1];
  }
  function mixedPair(p) {
    return !!p && p.length === 2 && p[0] !== p[1];
  }
  function sharesOneColor(a, b) {
    const sa = new Set(a.split(''));
    const sb = new Set(b.split(''));
    let n = 0;
    for (const x of sa) if (sb.has(x)) n++;
    return n === 1;
  }
  function sameColorSet(a, b) {
    const sa = new Set(a.split(''));
    const sb = new Set(b.split(''));
    if (sa.size !== 2 || sb.size !== 2) return false;
    if (sa.size !== sb.size) return false;
    for (const x of sa) if (!sb.has(x)) return false;
    return true;
  }

  function detectFamily(patterns) {
    const p0 = patterns[0] || '';
    const p1 = patterns[1] || '';
    const p2 = patterns[2] || '';

    if (samePair(p0) && samePair(p1)) return 'AABB';
    if (mixedPair(p0) && mixedPair(p1) && sameColorSet(p0, p1)) return 'ABAB';
    if (mixedPair(p0) && mixedPair(p1) && sharesOneColor(p0, p1)) return 'ABAC';
    if (samePair(p0) && mixedPair(p1) && !sharesOneColor(p0, p1)) return 'AABC';
    if (samePair(p0) && mixedPair(p1) && sharesOneColor(p0, p1) && p2 && p2 !== 'BB') return 'AAAB';
    if (samePair(p0) && mixedPair(p1)) return 'AAAB';
    return 'GENERIC';
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

  function pieceSlots(piecePattern, rotation) {
    const main = piecePattern[0] || '';
    const sub = piecePattern[1] || '';
    if (rotation === 0) return { top: sub, bottom: main, left: null, right: null };
    if (rotation === 2) return { top: main, bottom: sub, left: null, right: null };
    if (rotation === 1) return { top: null, bottom: null, left: sub, right: main };
    if (rotation === 3) return { top: null, bottom: null, left: main, right: sub };
    return { top: null, bottom: null, left: null, right: null };
  }

  function isHorizontal(rotation) { return rotation === 1 || rotation === 3; }
  function isVertical(rotation) { return rotation === 0 || rotation === 2; }

  function occupiedCols(move, piece) {
    const cells = getPieceCoords(piece, move.x, move.y, move.rotation);
    return Array.from(new Set(cells.map(c => c.x))).sort((a, b) => a - b);
  }

  function canPlace(boardState, piece, x, y, rotation) {
    const w = boardState[0].length;
    const h = boardState.length;
    const cells = getPieceCoords(piece, x, y, rotation);
    for (const c of cells) {
      if (c.x < 0 || c.x >= w || c.y < 0 || c.y >= h) return false;
      if (boardState[c.y][c.x] !== COLORS.EMPTY) return false;
    }
    return true;
  }

  function findRestY(boardState, piece, x, rotation) {
    const h = boardState.length;
    let y = h - 1;
    while (y >= 0 && !canPlace(boardState, piece, x, y, rotation)) y--;
    if (y < 0) return null;
    while (y > 0 && canPlace(boardState, piece, x, y - 1, rotation)) y--;
    return y;
  }

  function generatePlacements(boardState, piece) {
    const w = boardState[0].length;
    const out = [];
    for (let rot = 0; rot < 4; rot++) {
      for (let x = 0; x < w; x++) {
        const y = findRestY(boardState, piece, x, rot);
        if (y !== null) out.push({ x, y, rotation: rot });
      }
    }
    return out;
  }

  function placePiece(boardState, piece, move) {
    const next = cloneBoard(boardState);
    for (const c of getPieceCoords(piece, move.x, move.y, move.rotation)) {
      if (c.x >= 0 && c.x < next[0].length && c.y >= 0 && c.y < next.length) {
        next[c.y][c.x] = c.color;
      }
    }
    return next;
  }

  function gravityOn(boardState) {
    const w = boardState[0].length;
    const h = boardState.length;
    for (let x = 0; x < w; x++) {
      const col = [];
      for (let y = 0; y < h; y++) if (boardState[y][x] !== COLORS.EMPTY) col.push(boardState[y][x]);
      for (let y = 0; y < h; y++) boardState[y][x] = y < col.length ? col[y] : COLORS.EMPTY;
    }
  }

  function findGroups(boardState) {
    const w = boardState[0].length;
    const h = boardState.length;
    const visited = Array.from({ length: h }, () => Array(w).fill(false));
    const groups = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const color = boardState[y][x];
        if (color === COLORS.EMPTY || color === COLORS.GARBAGE || visited[y][x]) continue;
        const stack = [{ x, y }];
        visited[y][x] = true;
        const group = [];
        while (stack.length) {
          const cur = stack.pop();
          group.push(cur);
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = cur.x + dx, ny = cur.y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && !visited[ny][nx] && boardState[ny][nx] === color) {
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

  function clearGarbageNeighbors(boardState, erasedCoords) {
    const w = boardState[0].length;
    const h = boardState.length;
    const toClear = new Set();
    for (const { x, y } of erasedCoords) {
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && boardState[ny][nx] === COLORS.GARBAGE) {
          toClear.add(`${nx},${ny}`);
        }
      }
    }
    for (const key of toClear) {
      const [x, y] = key.split(',').map(Number);
      boardState[y][x] = COLORS.EMPTY;
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

  function resolveBoard(boardState) {
    const resolved = cloneBoard(boardState);
    let totalChains = 0;
    let totalScore = 0;
    let totalAttack = 0;

    while (true) {
      gravityOn(resolved);
      const groups = findGroups(resolved);
      if (!groups.length) break;

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

    return { board: resolved, chains: totalChains, score: totalScore, attack: totalAttack, allClear };
  }

  function isBoardEmpty(boardState) {
    for (const row of boardState) {
      for (const v of row) if (v !== COLORS.EMPTY) return false;
    }
    return true;
  }

  function columnHeights(boardState) {
    const w = boardState[0].length;
    const h = boardState.length;
    const heights = Array(w).fill(0);
    for (let x = 0; x < w; x++) {
      let top = -1;
      for (let y = h - 1; y >= 0; y--) {
        if (boardState[y][x] !== COLORS.EMPTY) { top = y; break; }
      }
      heights[x] = top + 1;
    }
    return heights;
  }

  function countHoles(boardState, heights) {
    let holes = 0;
    for (let x = 0; x < boardState[0].length; x++) {
      for (let y = 0; y < heights[x]; y++) {
        if (boardState[y][x] === COLORS.EMPTY) holes++;
      }
    }
    return holes;
  }

  function bumpiness(heights) {
    let b = 0;
    for (let i = 1; i < heights.length; i++) b += Math.abs(heights[i] - heights[i - 1]);
    return b;
  }

  function countColors(boardState) {
    const counts = [0, 0, 0, 0, 0];
    for (const row of boardState) {
      for (const v of row) if (v >= 1 && v <= 4) counts[v]++;
    }
    return counts;
  }

  function dangerPenalty(boardState) {
    const h = columnHeights(boardState);
    let p = 0;
    const x = AI.DANGER_X;
    const y = AI.DANGER_Y;
    if (boardState[y] && boardState[y][x] !== COLORS.EMPTY) p += 1000000;
    if (h[x] >= y + 1) p += 250000;
    if (h[x] >= y - 1) p += 80000;
    for (let yy = Math.max(0, y - 2); yy <= y; yy++) {
      if (boardState[yy] && boardState[yy][x] !== COLORS.EMPTY) p += 25000;
    }
    return p;
  }

  function looseGroups(boardState) {
    const w = boardState[0].length;
    const h = boardState.length;
    const visited = Array.from({ length: h }, () => Array(w).fill(false));
    const out = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const color = boardState[y][x];
        if (color === COLORS.EMPTY || color === COLORS.GARBAGE || visited[y][x]) continue;
        const stack = [{ x, y }];
        visited[y][x] = true;
        const cells = [];
        while (stack.length) {
          const cur = stack.pop();
          cells.push(cur);
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = cur.x + dx, ny = cur.y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && !visited[ny][nx] && boardState[ny][nx] === color) {
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

  function openNeighborCount(boardState, cells) {
    const w = boardState[0].length;
    const h = boardState.length;
    const seen = new Set();
    let count = 0;
    for (const { x, y } of cells) {
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && boardState[ny][nx] === COLORS.EMPTY) {
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

  function seedScore(boardState) {
    let s = 0;
    for (const g of looseGroups(boardState)) {
      const size = g.cells.length;
      const opens = openNeighborCount(boardState, g.cells);
      if (size === 1) s += 1;
      else if (size === 2) s += 18 + opens * 4;
      else if (size === 3) s += 60 + opens * 8;
      else if (size >= 4) s += 90 + size * 10;
    }

    const w = boardState[0].length;
    const h = boardState.length;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = boardState[y][x];
        if (c === COLORS.EMPTY || c === COLORS.GARBAGE) continue;

        if (x + 2 < w && boardState[y][x + 1] === c && boardState[y][x + 2] === c) {
          if ((x - 1 >= 0 && boardState[y][x - 1] === COLORS.EMPTY) || (x + 3 < w && boardState[y][x + 3] === COLORS.EMPTY)) s += 24;
        }
        if (y + 2 < h && boardState[y + 1][x] === c && boardState[y + 2][x] === c) {
          if ((y - 1 >= 0 && boardState[y - 1][x] === COLORS.EMPTY) || (y + 3 < h && boardState[y + 3][x] === COLORS.EMPTY)) s += 24;
        }
        if (x + 1 < w && y + 1 < h) {
          if (boardState[y][x] === c && boardState[y][x + 1] === c && boardState[y + 1][x] === c) s += 30;
        }
      }
    }
    return s;
  }

  function gtrScaffoldScore(boardState) {
    const h = columnHeights(boardState);
    const filled = totalFilled(boardState);

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

  function genericTemplateScore(boardState) {
    const h = columnHeights(boardState);
    let best1 = 0, best2 = 0;
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

  function evaluateBoard(boardState) {
    const h = columnHeights(boardState);
    const holes = countHoles(boardState, h);
    const maxH = Math.max(...h);
    const bump = bumpiness(h);
    const counts = countColors(boardState);

    let s = 0;
    s += gtrScaffoldScore(boardState) * AI.GTR_WEIGHT;
    s += genericTemplateScore(boardState) * AI.TEMPLATE_WEIGHT;
    s += seedScore(boardState) * AI.SEED_WEIGHT;

    const sorted = counts.slice(1).sort((a, b) => b - a);
    s += (sorted[0] + sorted[1]) * 0.5;
    s -= (sorted[2] + sorted[3]) * 0.8;

    s -= holes * 40;
    s -= bump * 10;
    s -= maxH * 28;
    s -= dangerPenalty(boardState);

    if (maxH >= 11) s -= 120;
    if (maxH >= 12) s -= 260;
    return s;
  }

  function chainOutcomeValue(sim) {
    if (!sim || !sim.chains) return 0;
    const chainPart = Math.pow(sim.chains, 2.15) * 30000;
    const scorePart = sim.score * 7;
    const attackPart = sim.attack * 1500;
    const allClearPart = sim.allClear ? 250000 : 0;
    if (sim.chains >= 8) return AI.CHAIN8_BONUS + chainPart + scorePart + attackPart + allClearPart;
    if (sim.chains >= 4) return AI.CHAIN4_BONUS + chainPart + scorePart + attackPart + allClearPart;
    return chainPart + scorePart + attackPart + allClearPart;
  }

  function isOpeningBoard(boardState) {
    const h = columnHeights(boardState);
    return totalFilled(boardState) <= AI.OPENING_THRESHOLD_FILLED || Math.max(...h) <= AI.OPENING_THRESHOLD_MAXH;
  }

  const OPENING_RULES = {
    AAAB: [
      { depth: 0, pattern: 'AA', shape: 'H', cols: [0, 1], score: 260000 },
      { depth: 1, pattern: 'AB', shape: 'V', x: 2, top: 'A', bottom: 'B', score: 260000 },
      { depth: 2, pattern: 'AA', shape: 'H', cols: [3, 4], score: 220000 },
      { depth: 2, pattern: 'AB', shape: 'V', x: 3, top: 'A', bottom: 'B', score: 220000 },
      { depth: 2, pattern: 'AC', shape: 'V', x: 1, top: 'A', bottom: 'C', score: 220000 },
      { depth: 2, pattern: 'BB', shape: 'V', x: 3, top: 'B', bottom: 'B', score: 150000 },
      { depth: 2, pattern: 'BC', shape: 'V', x: 3, top: 'B', bottom: 'C', score: 220000 },
      { depth: 2, pattern: 'CC', shape: 'H', cols: [0, 1], score: 160000 },
      { depth: 2, pattern: 'CD', shape: 'H', cols: [4, 5], left: 'C', right: 'D', score: 180000 },
      { depth: 2, pattern: 'CD', shape: 'V', x: 5, top: 'C', bottom: 'D', score: 180000 },
      { depth: 3, pattern: 'CC', prev: ['AA', 'AB', 'CD'], shape: 'H', cols: [3, 4], score: 260000 },
      { depth: 3, pattern: 'BC', prev: ['AA', 'AB', 'CD'], shape: 'H', cols: [4, 5], score: 240000 },
      { depth: 3, pattern: 'CC', prev: ['AA', 'AB', 'CD'], shape: 'V', x: 5, top: 'C', bottom: 'C', score: 240000 },
    ],
    AABB: [
      { depth: 0, pattern: 'AA', shape: 'H', cols: [0, 1], score: 260000 },
      { depth: 1, pattern: 'BB', shape: 'H', cols: [0, 1], score: 260000 },
      { depth: 2, pattern: 'AA', shape: 'H', cols: [3, 4], score: 180000 },
      { depth: 2, pattern: 'AB', shape: 'H', cols: [0, 1], right: 'A', score: 170000 },
      { depth: 2, pattern: 'AC', shape: 'V', x: 2, top: 'A', bottom: 'C', score: 170000 },
      { depth: 2, pattern: 'BB', shape: 'H', cols: [3, 4], score: 170000 },
      { depth: 2, pattern: 'BC', shape: 'V', x: 0, top: 'B', bottom: 'C', score: 170000 },
      { depth: 2, pattern: 'CC', shape: 'H', cols: [3, 4], score: 170000 },
      { depth: 2, pattern: 'CD', shape: 'H', cols: [4, 5], score: 160000 },
      { depth: 2, pattern: 'CD', shape: 'V', x: 5, top: 'C', bottom: 'D', score: 160000 },
      { depth: 3, pattern: 'AC', prev: ['AA', 'BB', 'CC'], shape: 'V', x: 3, top: 'A', bottom: 'C', score: 240000 },
      { depth: 3, pattern: 'BC', prev: ['AA', 'BB', 'CD'], shape: 'H', cols: [4, 5], score: 220000 },
      { depth: 3, pattern: 'CD', prev: ['AA', 'BB', 'CD'], shape: 'H', cols: [2, 3], left: 'D', right: 'C', score: 220000 },
      { depth: 3, pattern: 'CD', prev: ['AA', 'BB', 'CD'], shape: 'V', x: 1, top: 'D', bottom: 'C', score: 220000 },
      { depth: 3, pattern: 'CC', prev: ['AA', 'BB', 'CD'], shape: 'H', cols: [3, 4], score: 220000 },
    ],
    ABAB: [
      { depth: 0, pattern: 'AB', shape: 'V', x: 0, top: 'A', bottom: 'B', score: 220000 },
      { depth: 0, pattern: 'AB', shape: 'V', x: 0, top: 'B', bottom: 'A', score: 220000 },
      { depth: 0, pattern: 'AB', shape: 'V', x: 1, top: 'A', bottom: 'B', score: 220000 },
      { depth: 0, pattern: 'AB', shape: 'V', x: 1, top: 'B', bottom: 'A', score: 220000 },
      { depth: 1, pattern: 'AB', shape: 'V', x: 1, top: 'A', bottom: 'B', score: 220000 },
      { depth: 1, pattern: 'AB', shape: 'V', x: 1, top: 'B', bottom: 'A', score: 220000 },
      { depth: 1, pattern: 'AB', shape: 'V', x: 0, top: 'A', bottom: 'B', score: 220000 },
      { depth: 1, pattern: 'AB', shape: 'V', x: 0, top: 'B', bottom: 'A', score: 220000 },
      { depth: 2, pattern: 'AA', shape: 'H', cols: [3, 4], score: 150000 },
      { depth: 2, pattern: 'BB', shape: 'H', cols: [3, 4], score: 150000 },
      { depth: 2, pattern: 'CC', shape: 'H', cols: [3, 4], score: 150000 },
    ],
    ABAC: [
      { depth: 0, pattern: 'AB', shape: 'H', cols: [1, 2], left: 'A', score: 190000 },
      { depth: 0, pattern: 'AB', shape: 'V', x: 0, top: 'A', bottom: 'B', score: 170000 },
      { depth: 1, pattern: 'CC', shape: 'H', cols: [0, 1], score: 160000 },
      { depth: 1, pattern: 'BD', shape: 'V', x: 0, top: 'B', bottom: 'D', score: 160000 },
      { depth: 1, pattern: 'CD', shape: 'V', x: 3, top: 'D', bottom: 'C', score: 170000 },
      { depth: 1, pattern: 'AC', shape: 'V', x: 2, top: 'A', bottom: 'C', score: 170000 },
      { depth: 1, pattern: 'AB', shape: 'H', cols: [1, 2], right: 'A', score: 150000 },
      { depth: 1, pattern: 'BB', shape: 'H', cols: [0, 1], score: 140000 },
    ],
    AABC: [
      { depth: 0, pattern: 'AA', shape: 'H', cols: [0, 1], score: 220000 },
      { depth: 1, pattern: 'BC', shape: 'H', cols: [2, 3], right: 'B', score: 190000 },
      { depth: 1, pattern: 'AB', shape: 'H', cols: [4, 5], left: 'B', score: 180000 },
      { depth: 1, pattern: 'BB', shape: 'H', cols: [4, 5], score: 170000 },
      { depth: 1, pattern: 'BC', shape: 'V', x: 4, top: 'B', bottom: 'C', score: 170000 },
      { depth: 1, pattern: 'BD', shape: 'H', cols: [4, 5], left: 'B', score: 170000 },
      { depth: 2, pattern: 'AA', shape: 'H', cols: [1, 2], score: 120000 },
      { depth: 2, pattern: 'BC', shape: 'H', cols: [1, 2], score: 100000 },
      { depth: 2, pattern: 'AD', shape: 'H', cols: [1, 2], score: 100000 },
      { depth: 2, pattern: 'DD', shape: 'H', cols: [0, 1], score: 90000 },
    ]
  };

  function matchRule(rule, ctx) {
    if (rule.pattern && rule.pattern !== ctx.pattern) return false;
    if (rule.prev) {
      if (rule.prev.length !== ctx.prev.length) return false;
      for (let i = 0; i < rule.prev.length; i++) if (rule.prev[i] !== ctx.prev[i]) return false;
    }
    if (rule.shape === 'H' && !isHorizontal(ctx.move.rotation)) return false;
    if (rule.shape === 'V' && !isVertical(ctx.move.rotation)) return false;

    if (rule.cols) {
      const cols = occupiedCols(ctx.move, ctx.piece);
      if (cols.length !== rule.cols.length) return false;
      for (let i = 0; i < cols.length; i++) if (cols[i] !== rule.cols[i]) return false;
    }
    if (rule.x !== undefined && ctx.move.x !== rule.x) return false;

    const slots = pieceSlots(ctx.pattern, ctx.move.rotation);
    if (rule.top !== undefined && slots.top !== rule.top) return false;
    if (rule.bottom !== undefined && slots.bottom !== rule.bottom) return false;
    if (rule.left !== undefined && slots.left !== rule.left) return false;
    if (rule.right !== undefined && slots.right !== rule.right) return false;

    return true;
  }

  function openingRuleScore(boardState, piecesPatterns, depth, move, piece) {
    if (!isOpeningBoard(boardState)) return 0;

    const family = detectFamily(piecesPatterns);
    const rules = OPENING_RULES[family] || [];
    const currentPattern = piecesPatterns[depth] || '';
    const ctx = {
      pattern: currentPattern,
      prev: piecesPatterns.slice(0, depth),
      move,
      piece
    };

    let score = 0;
    for (const rule of rules) {
      if (rule.depth !== depth) continue;
      if (matchRule(rule, ctx)) score += rule.score || 0;
    }

    score += gtrScaffoldScore(boardState) * 120;
    return score;
  }

  function evaluateCandidate(boardBefore, boardAfter, piecesPatterns, depth, move, piece, sim) {
    let s = evaluateBoard(boardAfter);
    if (sim.chains >= 8) {
      s += chainOutcomeValue(sim) * 2.0;
    } else if (sim.chains > 0) {
      s += chainOutcomeValue(sim) * 1.2;
    } else {
      s += seedScore(boardAfter) * 4;
    }
    s += openingRuleScore(boardBefore, piecesPatterns, depth, move, piece);
    return s;
  }

  function simulateMove(boardState, piece, move) {
    return resolveBoard(placePiece(boardState, piece, move));
  }

  function searchBest(boardState, pieces, depth, memo, rootMove) {
    const key = `${depth}|${boardToKey(boardState)}|${pieces.patterns.join(',')}`;
    if (memo.has(key)) return memo.get(key);

    if (depth >= pieces.raw.length) {
      const ret = { score: evaluateBoard(boardState), move: rootMove || null };
      memo.set(key, ret);
      return ret;
    }

    const piece = pieces.raw[depth];
    const placements = generatePlacements(boardState, piece);

    if (!placements.length) {
      const ret = { score: -1e18, move: rootMove || null };
      memo.set(key, ret);
      return ret;
    }

    const ranked = [];
    for (const move of placements) {
      const sim = simulateMove(boardState, piece, move);
      const local = evaluateCandidate(boardState, sim.board, pieces.patterns, depth, move, piece, sim);
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
      } else {
        total += evaluateBoard(c.sim.board) * 0.25;
      }

      if (total > best.score) best = { score: total, move: nextRoot };
    }

    memo.set(key, best);
    return best;
  }

  function chooseBestMove(state) {
    const w = getWidth(state.width);
    const h = getHeight(state.height);
    const boardState = decodeBoard(state.boardBuffer, w, h);
    const piecesRaw = decodePieces(state.pieceBuffer);
    if (!piecesRaw.length) return null;

    const patterns = makeSymbolPatterns(piecesRaw);
    const pieces = { raw: piecesRaw, patterns };
    const memo = new Map();
    const result = searchBest(boardState, pieces, 0, memo, null);
    return result.move || null;
  }

  function handleSearch(msg) {
    try {
      const state = msg.state || {};
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
    if (msg.type === 'search') handleSearch(msg);
  };

  self.postMessage({ type: 'ready' });

})();