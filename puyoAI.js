/**
 * PuyoAI ProBuilder v4.0 - Ultra Precision & Absolute Safety Edition
 * 15連鎖以上の大連鎖構築 & 3列目窒息絶対回避（ハード制約）
 * ビーム幅拡大(128) & 物理仕様完全準拠
 */

const PuyoAI = (() => {
  const WIDTH = 6;
  const HEIGHT = 14; 
  const COLORS = [1, 2, 3, 4];
  const BEAM_WIDTH = 128; // 演算時間を増やし、精度を極限まで高める
  const MAX_CONTINUOUS_DISCARD = 4;

  /* ================= 評価関数 ================= */

  function evaluate(board, discardCount) {
    const h = columnHeights(board);
    
    // 【絶対制約】3列目(X=2)の12段目(Y=11)が埋まったら即座に最低評価
    if (h[2] >= 12) return -Infinity;

    let score = 0;

    // ① 高さ管理（3列目付近の警戒）
    if (h[2] >= 11) score -= 1e15; // 窒息寸前
    if (h[2] >= 10) score -= 1e12; // 警告
    
    // 他の列の高さ管理
    for (let x = 0; x < WIDTH; x++) {
      if (x !== 2 && h[x] >= 12) score -= 1e10;
    }

    // ② 連鎖シミュレーション
    const sim = simulateChain(board);
    if (sim.chains > 0) {
      if (sim.chains < 10) {
        score -= 5000000; // 小連鎖ペナルティ（大連鎖を優先）
      } else {
        score += sim.chains * 2000000; // 大連鎖ボーナス
      }
    }

    // ③ 連鎖ポテンシャル（種の評価）
    score += countPotentialConnections(board);

    // ④ 地形評価（U字構築・段差管理）
    score += terrainEvaluation(board);

    // ⑤ 色の分散
    score += colorDiversity(board);

    // ⑥ ゴミ捨てペナルティ
    if (discardCount > 0) {
      score -= discardCount * 1000000;
    }

    return score;
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
          if (group.length >= 4) s -= 1000000; // 消えない連結を維持
        }
      }
    }
    s += groups[3] * 1000000;
    s += groups[2] * 200000;
    return s;
  }

  function terrainEvaluation(board) {
    let s = 0;
    const h = columnHeights(board);
    for (let i = 0; i < WIDTH - 1; i++) {
      const d = h[i] - h[i + 1];
      if (d === 1 || d === 2) s += 100000; // 理想的な段差
      if (d === 0) s -= 50000;
      if (Math.abs(d) >= 3) s -= 200000; // 高低差がありすぎると危険
    }
    // U字構築：端を高く、3列目を低く
    s += (h[0] + h[5]) * 50000;
    s -= h[2] * 100000; 
    return s;
  }

  function colorDiversity(board) {
    const counts = {};
    let total = 0;
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (board[y][x]) {
          counts[board[y][x]] = (counts[board[y][x]] || 0) + 1;
          total++;
        }
      }
    }
    if (total === 0) return 0;
    let variance = 0;
    const avg = total / COLORS.length;
    COLORS.forEach(c => {
      const count = counts[c] || 0;
      variance += Math.abs(count - avg);
    });
    return -variance * 20000;
  }

  /* ================= 探索（超高精度ビームサーチ） ================= */

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
            // 物理的な設置制限チェック
            if (!canPlacePuyo(leaf.board, x, r)) continue;

            const result = applyMoveWithDiscard(leaf.board, p1, p2, x, r, leaf.discardCount);
            if (!result) continue; 

            // 3列目窒息のハードチェック
            const h = columnHeights(result.board);
            if (h[2] >= 12) continue; 

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

      // スコア順にソートして上位を残す
      nextLeaves.sort((a, b) => b.totalScore - a.totalScore);
      leaves = nextLeaves.slice(0, BEAM_WIDTH);
    }

    const bestLeaf = leaves.length > 0 ? leaves[0] : null;
    if (bestLeaf) {
      if (bestLeaf.didDiscard) currentDiscardCount++;
      else currentDiscardCount = 0;
      return bestLeaf.firstMove;
    }
    
    // 万が一、全滅した場合は緊急回避（3列目以外に置く）
    for (let x = 0; x < WIDTH; x++) {
      if (x !== 2) return { x, rotation: 0 };
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
      const tx = puyo.x;
      const ty = puyo.y;

      if (tx < 0 || tx >= WIDTH) return false; 
      if (ty >= 14) return false; 

      if (ty >= 11) {
        const step = tx > 2 ? 1 : -1;
        if (tx !== 2) {
          for (let curr = 2; curr !== tx; curr += step) {
            if (h[curr] < 12) return false; 
          }
        }
        // 14段目(Y=13)設置条件：手前Y=11足場
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
      
      if (y === 13) {
        didDiscard = true;
        b[y][px] = 0; 
      } else {
        b[y][px] = c;
      }
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
