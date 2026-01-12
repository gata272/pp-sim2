/**
 * PuyoAI v15 - Big Chain Oriented AI
 * 目的：15連鎖以上を最優先で狙う
 * 方針：
 *  - 即消しは致命的ペナルティ
 *  - 平坦化禁止（凹凸は正義）
 *  - 折り返し・段差・鍵を高評価
 *  - 計算量制限なし（重い）
 */

const PuyoAI = (() => {

  const WIDTH = 6;
  const HEIGHT = 14;
  const COLORS = [1, 2, 3, 4];

  /* ================= 基本ユーティリティ ================= */

  function clone(board) {
    return board.map(r => [...r]);
  }

  function columnHeights(board) {
    return Array.from({ length: WIDTH }, (_, x) => {
      let y = 0;
      while (y < HEIGHT && board[y][x] !== 0) y++;
      return y;
    });
  }

  function variance(arr) {
    const avg = arr.reduce((a,b)=>a+b,0) / arr.length;
    return arr.reduce((s,v)=>s+(v-avg)**2,0);
  }

  /* ================= 連鎖シミュレーション ================= */

  function simulatePureChain(board) {
    let chains = 0;
    while (true) {
      let erased = false;
      let visited = Array.from({ length: 12 }, () => Array(WIDTH).fill(false));

      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < WIDTH; x++) {
          if (board[y][x] === 0 || visited[y][x]) continue;

          let color = board[y][x];
          let stack = [{x,y}];
          let group = [];
          visited[y][x] = true;

          while (stack.length) {
            let p = stack.pop();
            group.push(p);
            for (let [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
              let nx = p.x + dx, ny = p.y + dy;
              if (
                nx>=0 && nx<WIDTH &&
                ny>=0 && ny<12 &&
                !visited[ny][nx] &&
                board[ny][nx] === color
              ) {
                visited[ny][nx] = true;
                stack.push({x:nx,y:ny});
              }
            }
          }

          if (group.length >= 4) {
            erased = true;
            group.forEach(p => board[p.y][p.x] = 0);
          }
        }
      }

      if (!erased) break;

      applyGravity(board);
      chains++;
    }
    return chains;
  }

  function applyGravity(board) {
    for (let x = 0; x < WIDTH; x++) {
      let write = 0;
      for (let y = 0; y < 12; y++) {
        if (board[y][x] !== 0) {
          board[write][x] = board[y][x];
          if (write !== y) board[y][x] = 0;
          write++;
        }
      }
    }
  }

  /* ================= 折り返し検出 ================= */

  function hasLShape(board, x, y) {
    const c = board[y][x];
    if (!c) return false;
    return (
      (board[y][x+1] === c && board[y+1]?.[x] === c) ||
      (board[y][x-1] === c && board[y+1]?.[x] === c)
    );
  }

  /* ================= 評価関数（最重要） ================= */

  function evaluate(board) {
    let score = 0;

    // 1. 即消しチェック（致命的）
    let temp = clone(board);
    let chains = simulatePureChain(temp);
    if (chains > 0) return -1_000_000;

    // 2. 高低差評価（平坦禁止）
    let heights = columnHeights(board);
    score += variance(heights) * 3000;

    // 3. 縦積みペナルティ
    heights.forEach(h => {
      if (h >= 10) score -= 50_000;
    });

    // 4. 折り返し加点
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (hasLShape(board, x, y)) score += 80_000;
      }
    }

    // 5. 潜在連鎖（仮発火）
    let maxFuture = 0;
    for (let x = 0; x < WIDTH; x++) {
      for (let c of COLORS) {
        let b = clone(board);
        let y = 0;
        while (y < 12 && b[y][x] !== 0) y++;
        if (y >= 12) continue;
        b[y][x] = c;
        maxFuture = Math.max(maxFuture, simulatePureChain(b));
      }
    }

    score += Math.pow(maxFuture, 6) * 5000;

    return score;
  }

  /* ================= 探索 ================= */

  function place(board, p1, p2, x, rot) {
    let b = clone(board);
    let coords = [];

    if (rot === 0) coords = [[x,1,p2],[x,0,p1]];
    if (rot === 2) coords = [[x,0,p1],[x,1,p2]];
    if (rot === 1) coords = [[x,0,p1],[x+1,0,p2]];
    if (rot === 3) coords = [[x,0,p1],[x-1,0,p2]];

    for (let [cx] of coords)
      if (cx < 0 || cx >= WIDTH) return null;

    coords.sort((a,b)=>a[1]-b[1]);

    for (let [cx,_,col] of coords) {
      let y = 0;
      while (y < 12 && b[y][cx] !== 0) y++;
      if (y >= 12) return null;
      b[y][cx] = col;
    }
    return b;
  }

  function getBestMove(board, next) {
    let best = { score: -Infinity, x: 2, rot: 0 };

    for (let x = 0; x < WIDTH; x++) {
      for (let r = 0; r < 4; r++) {
        let b = place(board, next[0], next[1], x, r);
        if (!b) continue;
        let s = evaluate(b);
        if (s > best.score) best = { score: s, x, rot: r };
      }
    }
    return { x: best.x, rotation: best.rot };
  }

  return { getBestMove };
})();

if (typeof module !== "undefined") module.exports = PuyoAI;
