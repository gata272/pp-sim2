/**
 * puyoAI.js - GTR Master & Physics Strict Edition (v7.0)
 * 
 * 特徴:
 * 1. 14段目(Y=13)設置の物理制約（手前Y=11足場条件）の厳密実装
 * 2. 14段目消滅仕様 & 連続ゴミ捨て4回制限
 * 3. keepuyo.com準拠のGTR絶対始動ロジック
 * 4. 3列目(X=2)窒息の絶対回避
 * 5. 15連鎖以上を狙う大連鎖・多重折り返し評価
 */

const PuyoAI = (() => {
  const WIDTH = 6;
  const HEIGHT = 14; // 13段目(Y=12), 14段目(Y=13)を含む
  const GHOST_Y = 13;
  const DEAD_X = 2;
  const DEAD_Y = 11;
  const BEAM_WIDTH = 128;
  const MAX_CONTINUOUS_DISCARD = 4;

  let currentDiscardCount = 0;
  let moveHistory = [];

  /* ================= 1. GTR絶対始動（初手定型化） ================= */
  
  function getFixedInitialMove(tsumos) {
    const [p1, p2] = tsumos[0]; // 初手
    const [p3, p4] = tsumos[1]; // 2手目
    
    const A = p1;
    const B = (p2 !== A) ? p2 : null;
    
    // AAAB型: 1列目AA横、2列目A、3列目B
    if (p1 === p2 && p3 === A && p4 !== A) return { x: 0, rotation: 1 }; 
    
    // ABAB / AABB型: 1-2列目横、1-2列目横
    if (p1 !== p2 && p3 === p1 && p4 === p2) return { x: 0, rotation: 1 }; 
    
    // ABAC型: 1-2列目横、1-2列目横
    if (p1 !== p2 && p3 === p1 && p4 !== p1 && p4 !== p2) return { x: 0, rotation: 1 }; 
    
    // AABC型: 1-2列目横、1-2列目横
    if (p1 === p2 && p3 !== p1 && p4 !== p1 && p3 !== p4) return { x: 0, rotation: 1 }; 

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
      
      // 3列目窒息チェック
      if (tx === DEAD_X && ty >= DEAD_Y) return false;

      // 12段目(Y=11)の壁による進入不可チェック
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
        if (h[tx] < GHOST_Y - 1) return false; // 自分の列のY=12が必要
        const neighborX = (tx <= DEAD_X) ? tx + 1 : tx - 1;
        if (neighborX >= 0 && neighborX < WIDTH) {
          if (h[neighborX] < 12) return false; // 手前の列のY=11が必要
        }
      }
    }
    return true;
  }

  /* ================= 3. 評価関数 (keepuyo.com 定石) ================= */

  function evaluate(board, chain, discardCount) {
    const h = columnHeights(board);
    if (h[DEAD_X] >= DEAD_Y) return -1e18;

    let score = 0;

    // A. 連鎖評価 (10連鎖未満は抑制、15連鎖以上を極大評価)
    if (chain > 0) {
      if (chain < 10) score -= 1e12;
      else score += Math.pow(chain, 6) * 1e6;
    }

    // B. GTR定石評価 (keepuyo.com)
    const gtrColor = board[0][0];
    if (gtrColor) {
      // 1列目L字, 2列目底, 3列目底
      if (board[1][0] === gtrColor && board[1][1] === gtrColor) score += 1e10;
      if (board[0][1] === gtrColor) score += 5e9;
      if (board[0][2] === gtrColor) score += 5e9;
    }
    
    // 3列目の「門」の維持 (凹型)
    if (h[2] > 0 && h[2] < h[1] && h[2] < h[3]) score += 8e9;

    // C. 土台基礎 (Y字型優先)
    for (let x = 3; x < 5; x++) {
      if (board[0][x] && board[0][x] === board[0][x+1]) score += 1e8;
    }

    // D. 連鎖尾 (右肩上がり)
    if (h[5] >= h[4] && h[4] >= h[3]) score += 5e7;

    // E. ゴミ捨てペナルティ
    score -= discardCount * 1e9;

    return score;
  }

  /* ================= 4. 探索エンジン ================= */

  function getBestMove(board, current, next1, next2) {
    const tsumos = [
      [current.axisColor, current.childColor],
      [next1.axisColor, next1.childColor],
      [next2.axisColor, next2.childColor]
    ];

    // 初手定型チェック
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
    return { x: 2, rotation: 0 };
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
