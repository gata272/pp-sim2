/**
 * PuyoAI GTR-Specialist v6.0
 * keepuyo.comのGTR定石を絶対最優先 (過去の汎用学習をリセット)
 */

const PuyoAI = (() => {
  const WIDTH = 6;
  const HEIGHT = 14;
  const BEAM_WIDTH = 128;
  const MAX_CONTINUOUS_DISCARD = 4;

  let currentDiscardCount = 0;
  let moveHistory = []; // 初手からの履歴を追跡

  /* ================= 1. GTR完全定型化（初手2手） ================= */
  
  function getFixedInitialMove(tsumos) {
    const [p1, p2] = tsumos[0]; // 初手
    const [p3, p4] = tsumos[1]; // 2手目
    
    // 色のパターン判定 (A, B, C)
    const A = p1;
    const B = (p2 !== A) ? p2 : null;
    
    // AAAB型
    if (p1 === p2 && p3 === A && p4 !== A) return { x: 2, rotation: 0 }; // 3列目縦
    if (p1 === p2 && p4 === A && p3 !== A) return { x: 2, rotation: 2 }; 
    
    // ABAB / AABB型
    if (p1 !== p2 && p3 === p1 && p4 === p2) return { x: 0, rotation: 1 }; // 1-2列目横
    
    // ABAC型
    if (p1 !== p2 && p3 === p1 && p4 !== p1 && p4 !== p2) return { x: 0, rotation: 0 }; // 1列目縦
    
    // AABC型
    if (p1 === p2 && p3 !== p1 && p4 !== p1 && p3 !== p4) return { x: 0, rotation: 1 }; // 1-2列目横

    return null; // 定型外は評価関数に任せる
  }

  /* ================= 2. GTR特化型評価関数 ================= */

  function evaluate(board, discardCount) {
    const h = columnHeights(board);
    if (h[2] >= 12) return -Infinity; // 3列目窒息は即終了

    let score = 0;

    // A. GTRの形 (keepuyo.com ステップ1-5)
    // 1列目(0,0)-(0,2), 2列目(1,0)-(1,1), 3列目(2,0) の特定パターンを極めて高く評価
    const gtrColor = board[0][0];
    if (gtrColor) {
      // 土台の底 (1,0), (2,0)
      if (board[0][1] === gtrColor) score += 1e12;
      if (board[1][0] === gtrColor) score += 1e12;
      if (board[2][0] === gtrColor) score += 1e12;
      
      // 折り返し (0,1), (0,2), (1,1)
      const turnColor = board[1][1];
      if (turnColor && turnColor !== gtrColor) {
        if (board[0][1] === turnColor) score += 1e11;
        if (board[0][2] === turnColor) score += 1e11;
        if (board[1][2] === turnColor) score += 1e11;
      }
    }

    // B. 3列目の「門」 (keepuyo.com ステップ3)
    // 3列目が他の列より低い状態を維持
    if (h[2] < h[1] && h[2] < h[3]) score += 1e10;
    score -= h[2] * 1e9; // 3列目は低ければ低いほど良い

    // C. 土台基礎 (Y字・L字)
    for (let x = 3; x < WIDTH; x++) {
      if (board[0][x] && board[0][x] === board[1][x]) score += 1e8; // 縦L字
      if (x < WIDTH - 1 && board[0][x] && board[0][x] === board[0][x+1]) score += 1e8; // 横L字
    }

    // D. 連鎖評価 (10連鎖以上のみ加点)
    const sim = simulateChain(board);
    if (sim.chains >= 10) {
      score += sim.chains * 1e13; 
    } else if (sim.chains > 0) {
      score -= 1e10; // 小連鎖は暴発としてペナルティ
    }

    // E. 物理制約
    if (h[2] >= 11) score -= 1e15;
    if (discardCount > 0) score -= discardCount * 1e8;

    return score;
  }

  /* ================= 3. 探索エンジン ================= */

  function getBestMove(board, current, next1, next2) {
    const tsumos = [
      [current.axisColor, current.childColor],
      [next1.axisColor, next1.childColor],
      [next2.axisColor, next2.childColor]
    ];

    // 初手付近なら定型手をチェック
    if (moveHistory.length < 2) {
      const fixedMove = getFixedInitialMove(tsumos);
      if (fixedMove) {
        moveHistory.push(fixedMove);
        return fixedMove;
      }
    }

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

            const moveScore = evaluate(result.board, result.discardCount);
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
      moveHistory.push(bestLeaf.firstMove);
      return bestLeaf.firstMove;
    }
    return { x: 0, rotation: 0 };
  }

  /* ================= 4. 物理仕様・基本処理 ================= */

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

  return { getBestMove };
})();
