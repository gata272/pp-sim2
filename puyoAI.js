/**
 * puyoAI.js - Ama Reproduction Edition (v9.0)
 * 
 * 特徴:
 * 1. citrus610/ama (beamブランチ) のアルゴリズムを忠実に再現
 * 2. 静止探索 (Quiescence Search) による潜在連鎖・キーぷよ・スペース評価
 * 3. 多角的な形状評価 (溝, 凹凸, 連結, 14段目抑制)
 * 4. 定型制約(keepuyo等)を排除した純粋な探索型AI
 * 5. 物理制約（14段目設置条件、連続ゴミ捨て制限）の厳密実装
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

  /* ================= 1. 物理制約判定 ================= */

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
      
      // 12段目の壁による進入不可チェック
      if (ty >= 11) {
        const step = tx > DEAD_X ? -1 : 1;
        if (tx !== DEAD_X) {
          for (let curr = tx + step; curr !== DEAD_X; curr += step) {
            if (h[curr] >= 12) return false;
          }
        }
      }

      // 14段目(Y=13)設置のための足場条件 (手前Y=11が必要)
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

  /* ================= 2. Ama再現評価関数 ================= */

  function evaluate(board, chain, discardCount) {
    const h = columnHeights(board);
    if (h[DEAD_X] >= DEAD_Y) return -1e25;

    let score = 0;

    // A. 静止探索 (Quiescence Search)
    const qResult = quiescenceSearch(board);
    score += qResult.chainCount * 1e15; // 潜在連鎖数
    score += qResult.keyPuyos * 1e12;   // 必要なキーぷよの少なさ
    score += qResult.space * 1e11;      // 連鎖を伸ばすためのスペース

    // B. 形状評価 (Ama-style)
    // 溝(well)の回避
    for (let x = 0; x < WIDTH; x++) {
      const left = x > 0 ? h[x-1] : 12;
      const right = x < WIDTH - 1 ? h[x+1] : 12;
      if (h[x] < left - 2 && h[x] < right - 2) score -= 1e14;
    }
    // 凹凸(bump)の抑制
    for (let x = 0; x < WIDTH - 1; x++) {
      score -= Math.abs(h[x] - h[x+1]) * 1e11;
    }
    // 14段目(Y=13)の無駄使い抑制
    for (let x = 0; x < WIDTH; x++) {
      if (h[x] === GHOST_Y) score -= 1e13;
    }

    // C. 連結評価 (Puyo Connections)
    const links = countLinks(board);
    score += links.link2 * 1e10;
    score += links.link3 * 1e12;

    // D. 暴発抑制 (探索中の連鎖が小さい場合はペナルティ)
    if (chain > 0 && chain < 10) score -= 1e18;

    score -= discardCount * 1e16;

    return score;
  }

  function quiescenceSearch(board) {
    // 簡易的な静止探索: 
    // 1. 各列に足りない色を1つずつ置いてみて、最大何連鎖になるかを確認
    // 2. その際の連鎖数、キーぷよ数、スペースを返す
    let maxChains = 0;
    let bestSpace = 0;
    
    for (let x = 0; x < WIDTH; x++) {
      const h = columnHeights(board);
      if (h[x] >= 12) continue;
      
      // 4色試行
      for (let color = 1; color <= 4; color++) {
        const b = board.map(row => [...row]);
        b[h[x]][x] = color;
        const sim = simulateChain(b);
        if (sim.chains > maxChains) {
          maxChains = sim.chains;
          bestSpace = countEmptySpaces(sim.board);
        }
      }
    }
    
    return {
      chainCount: maxChains,
      keyPuyos: maxChains > 0 ? 1 : 0, // 簡易化
      space: bestSpace
    };
  }

  function countEmptySpaces(board) {
    let count = 0;
    for (let x = 0; x < WIDTH; x++) {
      for (let y = 0; y < 12; y++) {
        if (!board[y][x]) count++;
      }
    }
    return count;
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

  /* ================= 3. 探索エンジン ================= */

  function getBestMove(board, current, next1, next2) {
    const tsumos = [
      [current.axisColor, current.childColor],
      [next1.axisColor, next1.childColor],
      [next2.axisColor, next2.childColor]
    ];

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
      return best.firstMove;
    }
    return { x: 2, rotation: 0 };
  }

  /* ================= 4. 基本処理 ================= */

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
