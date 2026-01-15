/**
 * PuyoAI ProBuilder v5.0 - GTR Master Edition
 * keepuyo.comのGTR定石を全面的に反映
 * 15連鎖以上の大連鎖構築 & 3列目窒息絶対回避
 */

const PuyoAI = (() => {
  const WIDTH = 6;
  const HEIGHT = 14; 
  const COLORS = [1, 2, 3, 4];
  const BEAM_WIDTH = 128; 
  const MAX_CONTINUOUS_DISCARD = 4;

  /* ================= 評価関数 ================= */

  function evaluate(board, discardCount) {
    const h = columnHeights(board);
    if (h[2] >= 12) return -Infinity;

    let score = 0;

    // ① 高さ管理（絶対安全）
    if (h[2] >= 11) score -= 1e18;
    if (h[2] >= 10) score -= 1e15;
    for (let x = 0; x < WIDTH; x++) {
      if (x !== 2 && h[x] >= 12) score -= 1e12;
    }

    // ② GTR定石評価（keepuyo.comベース）
    score += evaluateGTRStructure(board);

    // ③ 連鎖シミュレーション
    const sim = simulateChain(board);
    if (sim.chains > 0) {
      if (sim.chains < 10) score -= 1e7; 
      else score += sim.chains * 5e6; 
    }

    // ④ 連鎖ポテンシャル & 連結
    score += countPotentialConnections(board);

    // ⑤ 地形評価（U字・S字構築）
    score += terrainEvaluation(board);

    // ⑥ ゴミ捨てペナルティ
    if (discardCount > 0) score -= discardCount * 2e6;

    return score;
  }

  /* ================= GTR定石評価ロジック ================= */

  function evaluateGTRStructure(board) {
    let s = 0;
    
    // 1. GTRの核 (1列目, 2列目, 3列目の左下部分)
    // 理想的なGTRの形: (0,0),(1,0),(2,0)が同色、(0,1)が別色、(0,2),(1,1),(1,2)が同色
    const baseColor = board[0][0];
    if (baseColor) {
      if (board[0][1] === baseColor && board[0][2] === baseColor) s += 1e6; // 1列目のL字
      if (board[1][0] === baseColor && board[2][0] === baseColor) s += 1e6; // 底面の横並び
      
      // 折り返し部分の評価
      const turnColor = board[1][1];
      if (turnColor && turnColor !== baseColor) {
        if (board[0][1] === turnColor) s += 5e5;
        if (board[1][2] === turnColor) s += 5e5;
      }
    }

    // 2. 土台基礎 (Y字, L字)
    // 4列目以降の連結を評価
    for (let x = 3; x < WIDTH; x++) {
      const c = board[0][x];
      if (c) {
        if (board[1][x] === c) s += 3e5; // 縦連結
        if (x < WIDTH - 1 && board[0][x+1] === c) s += 3e5; // 横連結
      }
    }

    // 3. 3列目の「門」の維持
    const h = columnHeights(board);
    if (h[2] < h[1] && h[2] < h[3]) s += 1e6; // 3列目が凹んでいる状態を高く評価

    return s;
  }

  /* ================= 評価詳細 ================= */

  function countPotentialConnections(board) {
    let s = 0;
    const visited = Array.from({ length: 14 }, () => Array(WIDTH).fill(false));
    let groups = { 2: 0, 3: 0 };
    for (let y = 0; y < 12; y++) { 
      for (let x = 0; x < WIDTH; x++) {
        if (!visited[y][x] && board[y][x]) {
          let group = [];
          dfs(board, x, y, visited, group);
          if (group.length === 2) groups[2]++;
          if (group.length === 3) groups[3]++;
        }
      }
    }
    s += groups[3] * 1e6;
    s += groups[2] * 2e5;
    return s;
  }

  function terrainEvaluation(board) {
    let s = 0;
    const h = columnHeights(board);
    // 連鎖尾の段差 (右肩上がり)
    for (let i = 3; i < WIDTH - 1; i++) {
      if (h[i+1] >= h[i]) s += 2e5;
    }
    // 全体的な平坦度
    for (let i = 0; i < WIDTH - 1; i++) {
      if (Math.abs(h[i] - h[i+1]) > 2) s -= 5e5;
    }
    return s;
  }

  /* ================= 探索（GTR最適化ビームサーチ） ================= */

  let currentDiscardCount = 0;

  function getBestMove(board, current, next1, next2) {
    const tsumos = [
      [current.axisColor, current.childColor],
      [next1.axisColor, next1.childColor],
      [next2.axisColor, next2.childColor]
    ];
    
    let leaves = [{
      board: board,
      firstMove: null,
      totalScore: 0,
      discardCount: currentDiscardCount
    }];

    for (let depth = 0; depth < tsumos.length; depth++) {
      let nextLeaves = [];
      const [p1, p2] = tsumos[depth];

      for (let leaf of leaves) {
        for (let x = 0; x < WIDTH; x++) {
          for (let r = 0; r < 4; r++) {
            if (!canPlacePuyo(leaf.board, x, r)) continue;
            const result = applyMoveWithDiscard(leaf.board, p1, p2, x, r, leaf.discardCount);
            if (!result) continue; 
            if (columnHeights(result.board)[2] >= 12) continue; 

            const moveScore = evaluate(result.board, result.discardCount) * (depth + 1);
            const totalScore = leaf.totalScore + moveScore;
            const move = { x, rotation: r };
            nextLeaves.push({
              board: result.board,
              firstMove: leaf.firstMove || move,
              totalScore: totalScore,
              discardCount: result.discardCount,
              didDiscard: result.didDiscard
            });
          }
        }
      }
      nextLeaves.sort((a, b) => b.totalScore - a.totalScore);
      leaves = nextLeaves.slice(0, BEAM_WIDTH);
    }

    const bestLeaf = leaves.length > 0 ? leaves[0] : null;
    if (bestLeaf) {
      if (bestLeaf.didDiscard) currentDiscardCount++;
      else currentDiscardCount = 0;
      return bestLeaf.firstMove;
    }
    return { x: 0, rotation: 0 };
  }

  /* ================= 物理仕様・基本処理 ================= */

  function canPlacePuyo(board, x, r) {
    const h = columnHeights(board);
    let puyoPositions = [];
    if (r === 0) puyoPositions = [{x: x, y: h[x]}, {x: x, y: h[x] + 1}];
    else if (r === 1) puyoPositions = [{x: x, y: h[x]}, {x: x + 1, y: h[x + 1]}];
    else if (r === 2) puyoPositions = [{x: x, y: h[x] + 1}, {x: x, y: h[x]}];
    else if (r === 3) puyoPositions = [{x: x, y: h[x]}, {x: x - 1, y: h[x - 1]}];

    for (let puyo of puyoPositions) {
      const tx = puyo.x, ty = puyo.y;
      if (tx < 0 || tx >= WIDTH || ty >= 14) return false; 
      if (ty >= 11) {
        const step = tx > 2 ? 1 : -1;
        if (tx !== 2) {
          for (let curr = 2; curr !== tx; curr += step) if (h[curr] < 12) return false; 
        }
        if (ty >= 13 && tx !== 2) {
          const adjStep = tx > 2 ? -1 : 1;
          if (h[tx + adjStep] < 12) return false;
        }
      }
    }
    return true;
  }

  function applyMoveWithDiscard(board, p1, p2, x, r, discardCount) {
    const b = board.map(row => [...row]);
    let pos = [];
    if (r === 0) pos = [[x, 0, p1], [x, 1, p2]];
    else if (r === 1) pos = [[x, 0, p1], [x + 1, 0, p2]];
    else if (r === 2) pos = [[x, 1, p1], [x, 0, p2]];
    else if (r === 3) pos = [[x, 0, p1], [x - 1, 0, p2]];

    const sortedPos = [...pos].sort((a, b) => a[1] - b[1]);
    let didDiscard = false;
    for (let [px, _, c] of sortedPos) {
      let y = 0;
      while (y < HEIGHT && b[y][px]) y++;
      if (y >= HEIGHT) return null;
      if (y === 13) { didDiscard = true; b[y][px] = 0; }
      else b[y][px] = c;
    }
    let nextDiscardCount = didDiscard ? discardCount + 1 : 0;
    if (nextDiscardCount > MAX_CONTINUOUS_DISCARD) return null; 
    return { board: b, discardCount: nextDiscardCount, didDiscard: didDiscard };
  }

  function simulateChain(board) {
    let chains = 0;
    const b = board.map(row => [...row]);
    while (true) {
      const del = [];
      const vis = Array.from({ length: 14 }, () => Array(WIDTH).fill(false));
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
    return { chains };
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

  function dfs(b, x, y, v, g) {
    const c = b[y][x];
    const st = [{ x, y }];
    v[y][x] = true;
    while (st.length) {
      const p = st.pop();
      g.push(p);
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const nx = p.x + dx, ny = p.y + dy;
        if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < 14 && !v[ny][nx] && b[ny][nx] === c) {
          v[ny][nx] = true;
          st.push({ x: nx, y: ny });
        }
      });
    }
  }

  function columnHeights(b) {
    return [...Array(WIDTH)].map((_, x) => {
      let y = 0;
      while (y < HEIGHT && b[y][x]) y++;
      return y;
    });
  }

  function findMaxChainPuyo(board) {
    let maxChain = 0;
    let bestPos = null;
    for (let x = 0; x < WIDTH; x++) {
      for (let y = 0; y < 12; y++) {
        if (board[y][x] === 0) {
          for (let c of COLORS) {
            const b = board.map(r => [...r]);
            b[y][x] = c;
            const res = simulateChain(b);
            if (res.chains > maxChain) {
              maxChain = res.chains;
              bestPos = { x, y, chain: res.chains };
            }
          }
        }
      }
    }
    return bestPos;
  }

  return { getBestMove, findMaxChainPuyo };
})();
