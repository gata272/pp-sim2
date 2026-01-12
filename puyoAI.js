/**
 * PuyoAI.js v17
 * 大連鎖構築特化・左右バイアスなし版
 * ・連鎖の「形」を評価
 * ・即消し・左詰め・平坦を排除
 */

const PuyoAI = (function () {
  const WIDTH = 6;
  const HEIGHT = 14;
  const COLORS = [1, 2, 3, 4];

  /* =======================
     評価関数メイン
  ======================= */
  function evaluateBoard(board) {
    let score = 0;

    // 即死チェック（3列目）
    let h3 = 0;
    while (h3 < HEIGHT && board[h3][2] !== 0) h3++;
    if (h3 >= 11) return -50_000_000;

    // 即消し（連鎖発生）を強く拒否
    const chains = simulatePureChain(clone(board));
    if (chains === 1) return -10_000_000;
    if (chains >= 2) return -30_000_000;

    // 構造評価
    score += countPairs(board) * 800;
    score += verticalPotential(board);
    score += stepScore(getHeights(board));

    return score;
  }

  /* =======================
     構造評価①：2連結
  ======================= */
  function countPairs(board) {
    let pairs = 0;
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const c = board[y][x];
        if (!c) continue;
        if (x + 1 < WIDTH && board[y][x + 1] === c) pairs++;
        if (y + 1 < 12 && board[y + 1][x] === c) pairs++;
      }
    }
    return pairs;
  }

  /* =======================
     構造評価②：縦伸び
  ======================= */
  function verticalPotential(board) {
    let s = 0;
    for (let x = 0; x < WIDTH; x++) {
      let last = 0;
      let cnt = 0;
      for (let y = 0; y < 12; y++) {
        if (board[y][x] === last && last !== 0) {
          cnt++;
        } else {
          last = board[y][x];
          cnt = last ? 1 : 0;
        }
        if (cnt === 2) s += 500;
        if (cnt === 3) s += 1200;
      }
    }
    return s;
  }

  /* =======================
     構造評価③：段差
  ======================= */
  function stepScore(heights) {
    let s = 0;
    for (let i = 0; i < WIDTH - 1; i++) {
      const d = Math.abs(heights[i] - heights[i + 1]);
      if (d === 1 || d === 2) s += 1500;
      if (d >= 4) s -= 3000;
    }
    return s;
  }

  function getHeights(board) {
    let h = Array(WIDTH).fill(0);
    for (let x = 0; x < WIDTH; x++) {
      let y = 0;
      while (y < HEIGHT && board[y][x] !== 0) y++;
      h[x] = y;
    }
    return h;
  }

  /* =======================
     連鎖シミュレーター
  ======================= */
  function simulatePureChain(board) {
    let chains = 0;
    while (true) {
      let erase = [];
      let visited = Array.from({ length: HEIGHT }, () =>
        Array(WIDTH).fill(false)
      );

      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          if (!board[y][x] || visited[y][x]) continue;
          let color = board[y][x];
          let stack = [{ x, y }];
          let group = [];
          visited[y][x] = true;

          while (stack.length) {
            const p = stack.pop();
            group.push(p);
            for (const [dx, dy] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ]) {
              const nx = p.x + dx;
              const ny = p.y + dy;
              if (
                nx >= 0 &&
                nx < WIDTH &&
                ny >= 0 &&
                ny < HEIGHT &&
                !visited[ny][nx] &&
                board[ny][nx] === color
              ) {
                visited[ny][nx] = true;
                stack.push({ x: nx, y: ny });
              }
            }
          }

          if (group.length >= 4) erase.push(...group);
        }
      }

      if (erase.length === 0) break;
      chains++;
      erase.forEach(p => (board[p.y][p.x] = 0));

      for (let x = 0; x < WIDTH; x++) {
        let w = 0;
        for (let r = 0; r < HEIGHT; r++) {
          if (board[r][x] !== 0) {
            board[w][x] = board[r][x];
            if (w !== r) board[r][x] = 0;
            w++;
          }
        }
      }
    }
    return chains;
  }

  /* =======================
     探索（3手）
  ======================= */
  function getBestMove(board, next) {
    let best = -Infinity;
    let move = { x: 2, rotation: 0 };

    for (let x1 = 0; x1 < WIDTH; x1++) {
      for (let r1 = 0; r1 < 4; r1++) {
        const b1 = applyMove(board, next[0], next[1], x1, r1);
        if (!b1) continue;

        let localBest = -Infinity;

        for (let x2 = 0; x2 < WIDTH; x2++) {
          for (let r2 = 0; r2 < 4; r2++) {
            const b2 = applyMove(b1, next[2], next[3], x2, r2);
            if (!b2) continue;

            for (let x3 = 0; x3 < WIDTH; x3++) {
              for (let r3 = 0; r3 < 4; r3++) {
                const b3 = applyMove(b2, next[4], next[5], x3, r3);
                if (!b3) continue;
                const s = evaluateBoard(b3);
                if (s > localBest) localBest = s;
              }
            }
          }
        }

        if (localBest > best) {
          best = localBest;
          move = { x: x1, rotation: r1 };
        }
      }
    }
    return move;
  }

  /* =======================
     ぷよ配置
  ======================= */
  function applyMove(board, p1, p2, x, r) {
    const b = clone(board);

    let dx = [0, 1, 0, -1][r];
    let dy = [1, 0, -1, 0][r];

    let x1 = x;
    let x2 = x + dx;
    if (x2 < 0 || x2 >= WIDTH) return null;

    let h1 = getHeights(b)[x1];
    let h2 = getHeights(b)[x2];
    if (h1 >= 12 || h2 >= 12) return null;

    b[h1][x1] = p1;
    b[h2][x2] = p2;
    return b;
  }

  function clone(board) {
    return board.map(r => [...r]);
  }

  return { getBestMove };
})();

if (typeof module !== "undefined") module.exports = PuyoAI;
