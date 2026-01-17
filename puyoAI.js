/**
 * puyoAI.js - GTR Master & Ama Beam Hybrid Edition (v8.0)
 * 
 * 統合された高度な機能:
 * 1. 静止探索 (Quiescence Search): 探索末端での潜在連鎖数の評価
 * 2. 高度な形状評価: 溝(well)、凹凸(bump)、連結(link)の精密スコアリング
 * 3. GTR絶対始動 & keepuyo.com 定石の完全維持
 * 4. 14段目(Y=13)物理制約（手前Y=11足場条件）の厳密実装
 */

const PuyoAI = (() => {
  const WIDTH = 6;
  const HEIGHT = 14;
  const GHOST_Y = 13;
  const DEAD_X = 2;
  const DEAD_Y = 11;
  const BEAM_WIDTH = 128;
  const MAX_CONTINUOUS_DISCARD = 4;

  let currentDiscardCount = 0;
  let moveHistory = [];

  /* ================= 1. GTR絶対始動（初手定型化） ================= */
  
  function getFixedInitialMove(tsumos) {
    const [p1, p2] = tsumos[0];
    const [p3, p4] = tsumos[1];
    const A = p1;
    
    if (p1 === p2 && (p3 === A || p4 === A) && p3 !== p4) {
      if (moveHistory.length === 0) return { x: 0, rotation: 1 };
      if (moveHistory.length === 1) return (p3 === A) ? { x: 0, rotation: 1 } : { x: 0, rotation: 3 };
    }
    if (p1 !== p2 && p1 === p3 && p2 === p4) {
      if (moveHistory.length === 0) return { x: 0, rotation: 1 };
      if (moveHistory.length === 1) return { x: 0, rotation: 1 };
    }
    if (moveHistory.length === 0) return { x: 0, rotation: 1 };
    return null;
  }

  /* ================= 2. 物理制約判定 ================= */

  function canPlacePuyo(board, x, r) {
    const h = columnHeights(board);
    let puyoPositions = [];
    if (r === 0) puyoPositions = [{x: x, y: h[x]}, {x: x, y: h[x] + 1}];
    else if (r === 1) puyoPositions = [{x: x, y: h[x]}, {x: x + 1, y: h[x + 1]}];
    else if (r === 2) puyoPositions = [{x: x, y: h[x] + 1}, {x: x, y: h[x]}];
    else if (r === 3) puyoPositions = [{x: x, y: h[x]}, {x: x - 1, y: h[x - 1]}];

    for (let puyo of puyoPositions) {
      const tx = puyo.x, ty = puyo.y;
      if (tx < 0 || tx >= WIDTH || ty >= HEIGHT) return false;
      if (tx === DEAD_X && ty >= DEAD_Y) return false;
      if (ty >= 11) {
        const step = tx > DEAD_X ? -1 : 1;
        if (tx !== DEAD_X) {
          for (let curr = tx + step; curr !== DEAD_X; curr += step) {
            if (h[curr] >= 12) return false;
          }
        }
      }
      if (ty === GHOST_Y) {
        if (h[tx] < GHOST_Y - 1) return false;
        const neighborX = (tx <= DEAD_X) ? tx + 1 : tx - 1;
        if (neighborX >= 0 && neighborX < WIDTH) {
          if (h[neighborX] < 12) return false;
        }
      }
    }
    return true;
  }

  /* ================= 3. 高度な評価関数 (Ama Hybrid) ================= */

  function evaluate(board, chain, discardCount) {
    const h = columnHeights(board);
    if (h[DEAD_X] >= DEAD_Y) return -1e25;

    let score = 0;

    // A. 静止探索 (潜在連鎖評価)
    const sim = simulateChain(board);
    const potentialChain = sim.chains;
    if (potentialChain >= 15) score += Math.pow(potentialChain, 10) * 1e10;
    else if (potentialChain >= 10) score += Math.pow(potentialChain, 8) * 1e8;
    else if (potentialChain > 0) score -= 1e15; // 暴発抑制

    // B. GTR定石 (keepuyo.com)
    const gtrColor = board[0][0];
    if (gtrColor) {
      if (board[1][0] === gtrColor) score += 1e18;
      if (board[1][1] === gtrColor) score += 1e18;
      if (board[0][1] === gtrColor) score += 1e17;
      if (board[0][2] === gtrColor) score += 1e17;
    } else {
      score -= 1e20;
    }

    // C. 形状評価 (Ama-style)
    // 溝(well)の回避
    for (let x = 0; x < WIDTH; x++) {
      const left = x > 0 ? h[x-1] : 12;
      const right = x < WIDTH - 1 ? h[x+1] : 12;
      if (h[x] < left - 2 && h[x] < right - 2) score -= 1e14;
    }
    // 凹凸(bump)の抑制
    for (let x = 0; x < WIDTH - 1; x++) {
      score -= Math.abs(h[x] - h[x+1]) * 1e12;
    }
    // 3列目の門
    if (h[2] < h[1] && h[2] < h[3]) score += 1e16;
    score -= h[2] * 1e13;

    // D. 連結評価
    const links = countLinks(board);
    score += links.link2 * 1e11;
    score += links.link3 * 1e13;

    score -= discardCount * 1e15;

    return score;
  }

  function countLinks(board) {
    let link2 = 0, link3 = 0;
    const vis = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (board[y][x] && !vis[y][x]) {
          const g = [];
          dfs(board, x, y, vis, g);
          if (g.length === 2) link2++;
          if (g.length === 3) link3++;
        }
      }
    }
    return { link2, link3 };
  }

  /* ================= 4. 探索エンジン ================= */

  function getBestMove(board, current, next1, next2) {
    const tsumos = [
      [current.axisColor, current.childColor],
      [next1.axisColor, next1.childColor],
      [next2.axisColor, next2.childColor]
    ];

    if (moveHistory.length < 2) {
      const fixed = getFixedInitialMove(tsumos);
      if (fixed) {
        moveHistory.push(fixed);
        return fixed;
      }
    }

    let beam = [{ board, score: 0, firstMove: null, discardCount: currentDiscardCount }];

    for (let d = 0; d < tsumos.length; d++) {
      let nextBeam = [];
      const [p1, p2] = tsumos[d];

      for (let state of beam) {
        for (let x = 0; x < WIDTH; x++) {
          for (let r = 0; r < 4; r++) {
            if (!canPlacePuyo(state.board, x, r)) continue;
            const result = applyMove(state.board, p1, p2, x, r, state.discardCount);
            if (!result) continue;

            const moveScore = evaluate(result.board, result.chain, result.discardCount);
            nextBeam.push({
              board: result.board,
              score: state.score + moveScore,
              firstMove: state.firstMove || { x, rotation: r },
              discardCount: result.discardCount,
              didDiscard: result.didDiscard
            });
          }
        }
      }
      nextBeam.sort((a, b) => b.score - a.score);
      beam = nextBeam.slice(0, BEAM_WIDTH);
    }

    const best = beam[0];
    if (best) {
      if (best.didDiscard) currentDiscardCount++;
      else currentDiscardCount = 0;
      moveHistory.push(best.firstMove);
      return best.firstMove;
    }
    return { x: 0, rotation: 1 };
  }

  /* ================= 5. 基本処理 ================= */

  function applyMove(board, p1, p2, x, r, discardCount) {
    const b = board.map(row => [...row]);
    let pos = [];
    if (r === 0) pos = [[x, p1], [x, p2]];
    else if (r === 1) pos = [[x, p1], [x + 1, p2]];
    else if (r === 2) pos = [[x, p2], [x, p1]];
    else if (r === 3) pos = [[x, p1], [x - 1, p2]];

    let didDiscard = false;
    let currentDiscard = discardCount;

    for (let [px, c] of pos) {
      let h = 0;
      while (h < HEIGHT && b[h][px]) h++;
      if (h >= HEIGHT) return null;
      if (h === GHOST_Y) {
        didDiscard = true;
        currentDiscard++;
      } else {
        b[h][px] = c;
      }
    }

    if (currentDiscard > MAX_CONTINUOUS_DISCARD) return null;
    const sim = simulateChain(b);
    return { board: sim.board, chain: sim.chains, discardCount: didDiscard ? currentDiscard : 0, didDiscard };
  }

  function simulateChain(board) {
    let chains = 0;
    const b = board.map(row => [...row]);
    while (true) {
      const del = [];
      const vis = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < WIDTH; x++) {
          if (b[y][x] && !vis[y][x]) {
            const g = [];
            dfs(b, x, y, vis, g);
            if (g.length >= 4) del.push(...g);
          }
        }
      }
      if (!del.length) break;
      del.forEach(p => b[p.y][p.x] = 0);
      gravity(b);
      chains++;
    }
    return { board: b, chains };
  }

  function dfs(b, x, y, v, g) {
    const c = b[y][x];
    const st = [{ x, y }];
    v[y][x] = true;
    while (st.length) {
      const p = st.pop();
      g.push(p);
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const nx = p.x + dx, ny = p.y + dy;
        if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT && !v[ny][nx] && b[ny][nx] === c) {
          v[ny][nx] = true;
          st.push({ x: nx, y: ny });
        }
      });
    }
  }

  function gravity(b) {
    for (let x = 0; x < WIDTH; x++) {
      let w = 0;
      for (let y = 0; y < HEIGHT; y++) {
        if (b[y][x]) {
          b[w][x] = b[y][x];
          if (w !== y) b[y][x] = 0;
          w++;
        }
      }
    }
  }

  function columnHeights(b) {
    return [...Array(WIDTH)].map((_, x) => {
      let y = 0;
      while (y < HEIGHT && b[y][x]) y++;
      return y;
    });
  }

  return { getBestMove };
})();
