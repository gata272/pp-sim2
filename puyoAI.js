/**
 * PuyoAI ProBuilder v2
 * 3手先読み（ツモ・ネクスト1・ネクスト2）対応
 * ビームサーチ & 高度評価関数実装
 */

const PuyoAI = (() => {
  const WIDTH = 6;
  const HEIGHT = 14;
  const COLORS = [1, 2, 3, 4];
  const BEAM_WIDTH = 16; // ビームサーチの幅

  /* ================= 評価関数 ================= */

  function evaluate(board) {
    let score = 0;

    // ① 連鎖シミュレーション
    const sim = simulateChain(board);
    if (sim.chains === 1) return -1e8; // 即消しは厳禁
    if (sim.chains >= 2) {
      score += sim.chains * 500000; // 連鎖数ボーナス
    }

    // ② 連結ボーナス（連鎖の種）
    score += connectionPotential(board);

    // ③ 段差・平坦さ評価
    score += surfacePotential(board);

    // ④ 高さ評価（中央を低く、窒息防止）
    score += heightEvaluation(board);

    // ⑤ 無駄ぷよペナルティ
    score += wastePenalty(board);

    return score;
  }

  /* ================= 評価詳細 ================= */

  // 連結ボーナス：2連結、3連結を高く評価
  function connectionPotential(board) {
    let s = 0;
    const visited = Array.from({ length: 12 }, () => Array(WIDTH).fill(false));
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (!visited[y][x] && board[y][x]) {
          let group = [];
          dfs(board, x, y, visited, group);
          if (group.length === 2) s += 20000;
          if (group.length === 3) s += 150000;
          if (group.length >= 4) s -= 200000; // 発火していない4連結以上は形が悪い
        }
      }
    }
    return s;
  }

  // 段差評価：理想的な段差（1-2段）を評価
  function surfacePotential(board) {
    let s = 0;
    const h = columnHeights(board);
    for (let i = 0; i < WIDTH - 1; i++) {
      const d = Math.abs(h[i] - h[i + 1]);
      if (d === 1) s += 40000;
      if (d === 2) s += 20000;
      if (d === 0) s -= 10000; // 平坦すぎると連鎖が組みにくい
      if (d >= 3) s -= 50000; // 急激な段差はマイナス
    }
    return s;
  }

  // 高さ評価：3列目（発火点）を空け、全体的に低く保つ
  function heightEvaluation(board) {
    let s = 0;
    const h = columnHeights(board);
    
    // 3列目（インデックス2）の窒息チェック
    if (h[2] >= 10) s -= 1e7;
    
    // 全体の高さペナルティ
    const totalHeight = h.reduce((a, b) => a + b, 0);
    s -= totalHeight * 5000;

    // 中央（2,3列目）を少し低くするボーナス
    s -= (h[2] + h[3]) * 2000;

    return s;
  }

  // 無駄ぷよペナルティ：孤立したぷよを減点
  function wastePenalty(board) {
    let s = 0;
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (board[y][x]) {
          let neighbors = 0;
          [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < 12 && board[ny][nx]) {
              neighbors++;
            }
          });
          if (neighbors === 0) s -= 30000;
        }
      }
    }
    return s;
  }

  /* ================= 探索（ビームサーチ） ================= */

  /**
   * @param {Array} board 現在の盤面
   * @param {Array} current 現在のツモ [color1, color2]
   * @param {Array} next1 ネクスト1 [color1, color2]
   * @param {Array} next2 ネクスト2 [color1, color2]
   */
  function getBestMove(board, current, next1, next2) {
    // 3手分のツモ情報を配列にまとめる
    const tsumos = [
      [current.axisColor, current.childColor],
      [next1.axisColor, next1.childColor],
      [next2.axisColor, next2.childColor]
    ];
    
    // ビームサーチの初期状態
    let leaves = [{
      board: board,
      firstMove: null,
      totalScore: 0
    }];

    // 3手先まで探索
    for (let depth = 0; depth < tsumos.length; depth++) {
      let nextLeaves = [];
      const [p1, p2] = tsumos[depth];

      for (let leaf of leaves) {
        // 全ての可能な配置を試行
        for (let x = 0; x < WIDTH; x++) {
          for (let r = 0; r < 4; r++) {
            const nextBoard = applyMove(leaf.board, p1, p2, x, r);
            if (!nextBoard) continue;

            const moveScore = evaluate(nextBoard);
            const totalScore = leaf.totalScore + moveScore;
            
            const move = { x, rotation: r };
            nextLeaves.push({
              board: nextBoard,
              firstMove: leaf.firstMove || move, // 1手目の動きを保持
              totalScore: totalScore
            });
          }
        }
      }

      // スコア順にソートして上位 BEAM_WIDTH 個を残す
      nextLeaves.sort((a, b) => b.totalScore - a.totalScore);
      leaves = nextLeaves.slice(0, BEAM_WIDTH);
    }

    // 最もスコアの高い手筋の「1手目」を返す
    if (leaves.length > 0) {
      return leaves[0].firstMove;
    } else {
      return { x: 2, rotation: 0 }; // フォールバック
    }
  }

  /* ================= 基本処理 ================= */

  function applyMove(board, p1, p2, x, r) {
    const b = board.map(row => [...row]);
    let pos = [];
    // 0: 縦(p1下), 1: 横(p1左), 2: 縦(p1上), 3: 横(p1右)
    if (r === 0) pos = [[x, 0, p1], [x, 1, p2]];
    else if (r === 1) pos = [[x, 0, p1], [x + 1, 0, p2]];
    else if (r === 2) pos = [[x, 1, p1], [x, 0, p2]];
    else if (r === 3) pos = [[x, 0, p1], [x - 1, 0, p2]];

    for (let [px] of pos) if (px < 0 || px >= WIDTH) return null;
    
    // ぷよを落とす（簡易重力）
    const sortedPos = pos.sort((a, b) => a[1] - b[1]); // 下にあるぷよから処理
    for (let [px, _, c] of sortedPos) {
      let y = 0;
      while (y < 12 && b[y][px]) y++;
      if (y >= 12) return null;
      b[y][px] = c;
    }
    
    // 着地後の連鎖は評価関数内でシミュレートするため、ここでは落とすだけ
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
      while (y < 12 && b[y][x]) y++;
      return y;
    });
  }

  // 最大連鎖数を見つける補助関数（UI用）
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
