/**
 * PuyoAI ProBuilder v1.1 - Safety Grand Master Edition
 * 15連鎖以上の大連鎖構築 & 3列目窒息絶対回避
 */

const PuyoAI = (() => {
  const WIDTH = 6;
  const HEIGHT = 14;
  const COLORS = [1, 2, 3, 4];
  const BEAM_WIDTH = 24;

  /* ================= 評価関数 ================= */

  function evaluate(board) {
    let score = 0;

    // ① 窒息・高さ管理（最優先）
    const heightScore = heightManagement(board);
    if (heightScore <= -1e14) return heightScore; // 窒息確定なら即座に返す
    score += heightScore;

    // ② 連鎖シミュレーション
    const sim = simulateChain(board);
    if (sim.chains > 0) {
      if (sim.chains < 10) {
        score -= 2000000; // 小連鎖ペナルティ
      } else {
        score += sim.chains * 1000000; // 大連鎖ボーナス
      }
    }

    // ③ 連鎖ポテンシャル
    score += countPotentialConnections(board);

    // ④ 地形評価
    score += terrainEvaluation(board);

    // ⑤ 色の分散
    score += colorDiversity(board);

    return score;
  }

  /* ================= 評価詳細 ================= */

  function heightManagement(board) {
    let s = 0;
    const h = columnHeights(board);
    
    // 【最優先】3列目(X=2)の窒息絶対回避
    // Y=11が埋まることは、どんな大連鎖よりも避けるべき事象
    if (h[2] >= 12) return -1e15; // 完全にゲームオーバー
    if (h[2] >= 11) s -= 1e12;    // 窒息寸前（極めて危険）
    if (h[2] >= 10) s -= 1e9;     // 警告レベル
    
    // 他の列の高さ管理
    for (let x = 0; x < WIDTH; x++) {
      if (h[x] >= 12) s -= 1e10; // 3列目以外でも窒息は避ける
      if (h[x] >= 11) s -= 1e8;
    }
    
    // 全体の高さに対するペナルティ
    const maxHeight = Math.max(...h);
    s -= maxHeight * 100000;
    
    return s;
  }

  function countPotentialConnections(board) {
    let s = 0;
    const visited = Array.from({ length: 12 }, () => Array(WIDTH).fill(false));
    let groups = { 2: 0, 3: 0 };

    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (!visited[y][x] && board[y][x]) {
          let group = [];
          dfs(board, x, y, visited, group);
          if (group.length === 2) groups[2]++;
          if (group.length === 3) groups[3]++;
          if (group.length >= 4) s -= 500000;
        }
      }
    }
    s += groups[3] * 800000;
    s += groups[2] * 100000;
    return s;
  }

  function terrainEvaluation(board) {
    let s = 0;
    const h = columnHeights(board);
    for (let i = 0; i < WIDTH - 1; i++) {
      const d = h[i] - h[i + 1];
      if (d === 1 || d === 2) s += 50000;
      if (d === 0) s -= 30000;
      if (Math.abs(d) >= 3) s -= 100000;
    }
    s += (h[0] + h[5]) * 20000;
    s -= h[2] * 30000;
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
    return -variance * 10000;
  }

  /* ================= 探索（ビームサーチ） ================= */

  function getBestMove(board, current, next1, next2) {
    const tsumos = [
      [current.axisColor, current.childColor],
      [next1.axisColor, next1.childColor],
      [next2.axisColor, next2.childColor]
    ];
    
    let leaves = [{
      board: board,
      firstMove: null,
      totalScore: 0
    }];

    for (let depth = 0; depth < tsumos.length; depth++) {
      let nextLeaves = [];
      const [p1, p2] = tsumos[depth];

      for (let leaf of leaves) {
        for (let x = 0; x < WIDTH; x++) {
          for (let r = 0; r < 4; r++) {
            const nextBoard = applyMove(leaf.board, p1, p2, x, r);
            if (!nextBoard) continue;

            const moveScore = evaluate(nextBoard) * (depth + 1);
            const totalScore = leaf.totalScore + moveScore;
            
            const move = { x, rotation: r };
            nextLeaves.push({
              board: nextBoard,
              firstMove: leaf.firstMove || move,
              totalScore: totalScore
            });
          }
        }
      }

      nextLeaves.sort((a, b) => b.totalScore - a.totalScore);
      leaves = nextLeaves.slice(0, BEAM_WIDTH);
    }

    return leaves.length > 0 ? leaves[0].firstMove : { x: 2, rotation: 0 };
  }

  /* ================= 基本処理 ================= */

  function applyMove(board, p1, p2, x, r) {
    const b = board.map(row => [...row]);
    let pos = [];
    if (r === 0) pos = [[x, 0, p1], [x, 1, p2]];
    else if (r === 1) pos = [[x, 0, p1], [x + 1, 0, p2]];
    else if (r === 2) pos = [[x, 1, p1], [x, 0, p2]];
    else if (r === 3) pos = [[x, 0, p1], [x - 1, 0, p2]];

    for (let [px] of pos) if (px < 0 || px >= WIDTH) return null;
    
    const sortedPos = [...pos].sort((a, b) => a[1] - b[1]);
    for (let [px, _, c] of sortedPos) {
      let y = 0;
      while (y < 14 && b[y][px]) y++;
      if (y >= 14) return null;
      b[y][px] = c;
    }
    return b;
  }

  function simulateChain(board) {
    let chains = 0;
    const b = board.map(row => [...row]);
    while (true) {
      const del = [];
      const vis = Array.from({ length: 12 }, () => Array(WIDTH).fill(false));
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
        if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < 12 && !v[ny][nx] && b[ny][nx] === c) {
          v[ny][nx] = true;
          st.push({ x: nx, y: ny });
        }
      });
    }
  }

  function columnHeights(b) {
    return [...Array(WIDTH)].map((_, x) => {
      let y = 0;
      while (y < 14 && b[y][x]) y++;
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
