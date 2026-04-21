// puyoAI.js
// 3-ply beam search + chain-building heuristics
// - targets longer chains by preferring future potential over small immediate clears
// - works with the current puyoSim.js globals
// - compatible with the HTML buttons:
//   <button onclick="runPuyoAI()">AIで1手</button>
//   <button onclick="toggleAIAuto()">AI自動</button>

(function () {
  'use strict';

  const AI_CONFIG = {
    SEARCH_DEPTH: 3,            // current + NEXT1 + NEXT2
    BEAM_WIDTH: 60,             // beam width per ply
    TIME_LIMIT_MS: 1800,        // search budget per move
    AUTO_INTERVAL_MS: 160,      // polling interval for auto mode
    NO_MOVE_RETRY_MS: 120,
    // Heavy bias toward building long chains.
    TARGET_CHAIN_BONUS: 65000,
    SMALL_CHAIN_PENALTY: 45000, // penalty when a move resolves only 1-5 chains
    HEURISTIC_WEIGHT: 1,
    SCORE_WEIGHT: 0.35,
    HOLE_PENALTY: 2600,
    HEIGHT_PENALTY: 420,
    VARIANCE_PENALTY: 55,
    SMOOTHNESS_BONUS: 210,
    COMPONENT2_BONUS: 1400,
    COMPONENT3_BONUS: 3200,
    TOTALFILLED_BONUS: 26,
    ALL_CLEAR_BONUS: 22000,
    FAIL_SCORE: -1e18,
  };

  const WIDTH = typeof window.WIDTH === 'number' ? window.WIDTH : 6;
  const HEIGHT = typeof window.HEIGHT === 'number' ? window.HEIGHT : 14;
  const HIDDEN_ROWS = typeof window.HIDDEN_ROWS === 'number' ? window.HIDDEN_ROWS : 2;
  const VISIBLE_ROWS = Math.max(0, HEIGHT - HIDDEN_ROWS);
  const COLORS = window.COLORS || {
    EMPTY: 0,
    RED: 1,
    BLUE: 2,
    GREEN: 3,
    YELLOW: 4,
    GARBAGE: 5,
  };
  const BONUS_TABLE = window.BONUS_TABLE || {
    CHAIN: [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512],
    GROUP: [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    COLOR: [0, 0, 3, 6, 12],
  };
  const ALL_CLEAR_SCORE_BONUS = typeof window.ALL_CLEAR_SCORE_BONUS === 'number' ? window.ALL_CLEAR_SCORE_BONUS : 2100;

  const OFFSETS = [
    [0, 1],   // rotation 0: sub above main
    [-1, 0],  // rotation 1: sub left of main
    [0, -1],  // rotation 2: sub below main
    [1, 0],   // rotation 3: sub right of main
  ];

  let autoEnabled = false;
  let autoTimer = null;
  let aiBusy = false;
  let lastThinkAt = 0;

  function isReady() {
    return typeof board !== 'undefined' && Array.isArray(board) &&
      typeof currentPuyo !== 'undefined' && typeof nextQueue !== 'undefined' &&
      typeof queueIndex !== 'undefined' && typeof gameState !== 'undefined';
  }

  function aiStatus(text) {
    const el = document.getElementById('ai-status');
    if (el) el.textContent = text;
  }

  function setAutoButton(on) {
    const btn = document.getElementById('ai-auto-button');
    if (btn) btn.textContent = on ? 'AI自動: ON' : 'AI自動: OFF';
  }

  function setStepButtonDisabled(disabled) {
    const btn = document.getElementById('ai-step-button');
    if (btn) btn.disabled = !!disabled;
  }

  function cloneBoard(src) {
    return src.map(row => row.slice());
  }

  function isInside(x, y) {
    return x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
  }

  function getPieceCoords(mainX, mainY, rotation) {
    const [dx, dy] = OFFSETS[rotation & 3];
    return [
      { x: mainX, y: mainY },
      { x: mainX + dx, y: mainY + dy },
    ];
  }

  function canPlaceOnBoard(targetBoard, mainX, mainY, rotation) {
    const coords = getPieceCoords(mainX, mainY, rotation);
    for (const p of coords) {
      if (!isInside(p.x, p.y)) return false;
      if (targetBoard[p.y][p.x] !== COLORS.EMPTY) return false;
    }
    return true;
  }

  function dropMainY(targetBoard, mainX, rotation) {
    let y = HEIGHT - 2;
    if (!canPlaceOnBoard(targetBoard, mainX, y, rotation)) return null;
    while (canPlaceOnBoard(targetBoard, mainX, y - 1, rotation)) {
      y -= 1;
    }
    return y;
  }

  function placePiece(targetBoard, piece, placement) {
    const { mainX, mainY, rotation } = placement;
    const coords = getPieceCoords(mainX, mainY, rotation);
    const next = cloneBoard(targetBoard);

    const mainColor = piece.mainColor;
    const subColor = piece.subColor;

    for (const p of coords) {
      if (!isInside(p.x, p.y)) return null;
      if (next[p.y][p.x] !== COLORS.EMPTY) return null;
    }

    next[coords[0].y][coords[0].x] = mainColor;
    next[coords[1].y][coords[1].x] = subColor;
    return next;
  }

  function gravityOnBoard(targetBoard) {
    for (let x = 0; x < WIDTH; x++) {
      const stack = [];
      for (let y = 0; y < HEIGHT; y++) {
        if (targetBoard[y][x] !== COLORS.EMPTY) stack.push(targetBoard[y][x]);
      }
      for (let y = 0; y < HEIGHT; y++) {
        targetBoard[y][x] = y < stack.length ? stack[y] : COLORS.EMPTY;
      }
    }
  }

  function findConnectedPuyosOnBoard(targetBoard) {
    const visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
    const groups = [];

    for (let y = 0; y < VISIBLE_ROWS; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const color = targetBoard[y][x];
        if (color === COLORS.EMPTY || color === COLORS.GARBAGE || visited[y][x]) continue;

        const stack = [{ x, y }];
        visited[y][x] = true;
        const group = [];

        while (stack.length) {
          const cur = stack.pop();
          group.push(cur);

          const neigh = [
            [0, 1], [0, -1], [1, 0], [-1, 0],
          ];
          for (const [dx, dy] of neigh) {
            const nx = cur.x + dx;
            const ny = cur.y + dy;
            if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= VISIBLE_ROWS) continue;
            if (visited[ny][nx]) continue;
            if (targetBoard[ny][nx] !== color) continue;
            visited[ny][nx] = true;
            stack.push({ x: nx, y: ny });
          }
        }

        if (group.length >= 4) groups.push({ color, group });
      }
    }

    return groups;
  }

  function clearAdjacentGarbage(targetBoard, erasedCoords) {
    const toClear = new Set();
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];

    for (const { x, y } of erasedCoords) {
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (!isInside(nx, ny)) continue;
        if (targetBoard[ny][nx] === COLORS.GARBAGE) {
          toClear.add(`${nx},${ny}`);
        }
      }
    }

    for (const key of toClear) {
      const [nx, ny] = key.split(',').map(Number);
      targetBoard[ny][nx] = COLORS.EMPTY;
    }
  }

  function scoreForGroups(groups, currentChain) {
    let totalPuyos = 0;
    const colorSet = new Set();
    let bonusTotal = 0;

    for (const { group, color } of groups) {
      totalPuyos += group.length;
      colorSet.add(color);
      const idx = Math.min(group.length, BONUS_TABLE.GROUP.length - 1);
      bonusTotal += BONUS_TABLE.GROUP[idx];
    }

    const chainIdx = Math.max(0, Math.min(currentChain - 1, BONUS_TABLE.CHAIN.length - 1));
    bonusTotal += BONUS_TABLE.CHAIN[chainIdx];

    const colorIdx = Math.min(colorSet.size, BONUS_TABLE.COLOR.length - 1);
    bonusTotal += BONUS_TABLE.COLOR[colorIdx];

    const finalBonus = Math.max(1, Math.min(999, bonusTotal));
    return (10 * totalPuyos) * finalBonus;
  }

  function isBoardEmpty(targetBoard) {
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (targetBoard[y][x] !== COLORS.EMPTY) return false;
      }
    }
    return true;
  }

  function resolveChains(targetBoard) {
    let totalScore = 0;
    let totalChains = 0;

    while (true) {
      gravityOnBoard(targetBoard);
      const groups = findConnectedPuyosOnBoard(targetBoard);
      if (groups.length === 0) {
        if (isBoardEmpty(targetBoard)) totalScore += ALL_CLEAR_SCORE_BONUS;
        break;
      }

      totalChains += 1;
      const chainScore = scoreForGroups(groups, totalChains);
      totalScore += chainScore;

      const erased = [];
      for (const { group } of groups) {
        for (const p of group) {
          targetBoard[p.y][p.x] = COLORS.EMPTY;
          erased.push(p);
        }
      }

      clearAdjacentGarbage(targetBoard, erased);
    }

    return { board: targetBoard, totalScore, totalChains };
  }

  function analyzeBoard(targetBoard) {
    const heights = Array(WIDTH).fill(0);
    let totalFilled = 0;
    let holes = 0;

    for (let x = 0; x < WIDTH; x++) {
      let seenFilled = false;
      let h = 0;
      for (let y = 0; y < HEIGHT; y++) {
        const cell = targetBoard[y][x];
        if (cell !== COLORS.EMPTY) {
          seenFilled = true;
          h += 1;
          totalFilled += 1;
        } else if (seenFilled) {
          holes += 1;
        }
      }
      heights[x] = h;
    }

    let maxHeight = 0;
    let minHeight = HEIGHT;
    let variance = 0;
    let smoothness = 0;
    let midHeightBonus = 0;

    for (const h of heights) {
      if (h > maxHeight) maxHeight = h;
      if (h < minHeight) minHeight = h;
      if (h >= 2 && h <= 9) midHeightBonus += 1;
    }

    const avg = heights.reduce((a, b) => a + b, 0) / WIDTH;
    variance = heights.reduce((sum, h) => sum + (h - avg) * (h - avg), 0) / WIDTH;
    for (let i = 0; i < WIDTH - 1; i++) {
      smoothness -= Math.abs(heights[i] - heights[i + 1]);
    }

    const visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
    let component2 = 0;
    let component3 = 0;
    let component4 = 0;

    for (let y = 0; y < VISIBLE_ROWS; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const color = targetBoard[y][x];
        if (color === COLORS.EMPTY || color === COLORS.GARBAGE || visited[y][x]) continue;

        const stack = [{ x, y }];
        visited[y][x] = true;
        let size = 0;

        while (stack.length) {
          const cur = stack.pop();
          size += 1;
          for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const nx = cur.x + dx;
            const ny = cur.y + dy;
            if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= VISIBLE_ROWS) continue;
            if (visited[ny][nx]) continue;
            if (targetBoard[ny][nx] !== color) continue;
            visited[ny][nx] = true;
            stack.push({ x: nx, y: ny });
          }
        }

        if (size === 2) component2 += 1;
        else if (size === 3) component3 += 1;
        else if (size >= 4) component4 += 1;
      }
    }

    return {
      heights,
      totalFilled,
      holes,
      maxHeight,
      minHeight,
      variance,
      smoothness,
      midHeightBonus,
      component2,
      component3,
      component4,
    };
  }

  function evaluateState(result) {
    const metrics = analyzeBoard(result.board);

    let value = 0;

    value += result.totalScore * AI_CONFIG.SCORE_WEIGHT;

    if (result.totalChains > 0) {
      value += result.totalChains * result.totalChains * AI_CONFIG.TARGET_CHAIN_BONUS;

      if (result.totalChains < 6) {
        value -= (6 - result.totalChains) * AI_CONFIG.SMALL_CHAIN_PENALTY;
      } else {
        value += result.totalChains * 50000;
      }
    } else {
      value += metrics.component3 * AI_CONFIG.COMPONENT3_BONUS;
      value += metrics.component2 * AI_CONFIG.COMPONENT2_BONUS;
      value += metrics.midHeightBonus * 800;
    }

    value += metrics.component3 * AI_CONFIG.COMPONENT3_BONUS;
    value += metrics.component2 * AI_CONFIG.COMPONENT2_BONUS;
    value += metrics.midHeightBonus * 400;
    value += metrics.smoothness * AI_CONFIG.SMOOTHNESS_BONUS;
    value += metrics.totalFilled * AI_CONFIG.TOTALFILLED_BONUS;

    value -= metrics.holes * AI_CONFIG.HOLE_PENALTY;
    value -= metrics.maxHeight * AI_CONFIG.HEIGHT_PENALTY;
    value -= metrics.variance * AI_CONFIG.VARIANCE_PENALTY;

    if (metrics.maxHeight >= HEIGHT - 2) {
      value -= 40000;
    }

    return value;
  }

  function enumeratePlacements(targetBoard, piece) {
    const placements = [];
    const seen = new Set();

    for (let rotation = 0; rotation < 4; rotation++) {
      for (let x = 0; x < WIDTH; x++) {
        const y = dropMainY(targetBoard, x, rotation);
        if (y === null) continue;
        const key = `${x},${y},${rotation}`;
        if (seen.has(key)) continue;
        seen.add(key);
        placements.push({ mainX: x, mainY: y, rotation });
      }
    }

    placements.sort((a, b) => {
      const ca = Math.abs(a.mainX - 2.5) + (HEIGHT - 2 - a.mainY) * 0.25;
      const cb = Math.abs(b.mainX - 2.5) + (HEIGHT - 2 - b.mainY) * 0.25;
      return ca - cb;
    });

    return placements;
  }

  function pieceFromCurrent() {
    if (!currentPuyo) return null;
    return {
      mainColor: currentPuyo.mainColor,
      subColor: currentPuyo.subColor,
    };
  }

  function pieceFromQueue(index) {
    if (!Array.isArray(nextQueue) || index < 0 || index >= nextQueue.length) return null;
    const pair = nextQueue[index];
    if (!pair || pair.length < 2) return null;
    return {
      mainColor: pair[1],
      subColor: pair[0],
    };
  }

  function makeRootPieces() {
    const pieces = [];
    const cur = pieceFromCurrent();
    if (cur) pieces.push(cur);

    const next1 = pieceFromQueue(queueIndex);
    const next2 = pieceFromQueue(queueIndex + 1);
    if (next1) pieces.push(next1);
    if (next2) pieces.push(next2);

    return pieces;
  }

  function simulateOneMove(baseBoard, piece, placement) {
    const placed = placePiece(baseBoard, piece, placement);
    if (!placed) return null;
    gravityOnBoard(placed);
    const resolved = resolveChains(placed);
    return resolved;
  }

  function betterOf(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (b.evalScore !== a.evalScore) return b.evalScore > a.evalScore ? b : a;
    if (b.totalChains !== a.totalChains) return b.totalChains > a.totalChains ? b : a;
    if (b.totalScore !== a.totalScore) return b.totalScore > a.totalScore ? b : a;
    return b;
  }

  function think() {
    if (!isReady()) return null;

    const pieces = makeRootPieces();
    if (!pieces.length) return null;

    const startBoard = cloneBoard(board);
    const startTime = performance.now();

    let beam = [{
      board: startBoard,
      path: [],
      totalScore: 0,
      totalChains: 0,
      evalScore: evaluateState({ board: startBoard, totalScore: 0, totalChains: 0 }),
    }];

    let bestLeaf = null;

    for (let depth = 0; depth < Math.min(AI_CONFIG.SEARCH_DEPTH, pieces.length); depth++) {
      const piece = pieces[depth];
      const candidates = [];

      for (const node of beam) {
        if (performance.now() - startTime > AI_CONFIG.TIME_LIMIT_MS) break;

        const placements = enumeratePlacements(node.board, piece);
        for (const placement of placements) {
          if (performance.now() - startTime > AI_CONFIG.TIME_LIMIT_MS) break;

          const sim = simulateOneMove(node.board, piece, placement);
          if (!sim) continue;

          const nextNode = {
            board: sim.board,
            path: node.path.concat([placement]),
            totalScore: node.totalScore + sim.totalScore,
            totalChains: node.totalChains + sim.totalChains,
          };

          nextNode.evalScore = evaluateState({
            board: nextNode.board,
            totalScore: nextNode.totalScore,
            totalChains: nextNode.totalChains,
          });

          candidates.push(nextNode);
          bestLeaf = betterOf(bestLeaf, nextNode);
        }
      }

      if (!candidates.length) break;

      candidates.sort((a, b) => {
        if (b.evalScore !== a.evalScore) return b.evalScore - a.evalScore;
        if (b.totalChains !== a.totalChains) return b.totalChains - a.totalChains;
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        return 0;
      });

      beam = candidates.slice(0, AI_CONFIG.BEAM_WIDTH);
      bestLeaf = betterOf(bestLeaf, beam[0]);
    }

    if (!bestLeaf || !bestLeaf.path.length) {
      return null;
    }

    const first = bestLeaf.path[0];
    const predictedChains = bestLeaf.totalChains;
    const predictedScore = bestLeaf.totalScore;

    return {
      rotation: first.rotation,
      mainX: first.mainX,
      mainY: first.mainY,
      predictedChains,
      predictedScore,
      evalScore: bestLeaf.evalScore,
      searchMs: Math.round(performance.now() - startTime),
    };
  }

  function applyPlan(plan) {
    if (!plan || !currentPuyo) return false;
    if (typeof gameState !== 'undefined' && gameState !== 'playing') return false;

    currentPuyo.mainX = plan.mainX;
    currentPuyo.mainY = plan.mainY;
    currentPuyo.rotation = plan.rotation;

    if (typeof renderBoard === 'function') renderBoard();
    if (typeof hardDrop === 'function') {
      hardDrop();
    } else if (typeof lockPuyo === 'function') {
      lockPuyo();
    }

    return true;
  }

  function runPuyoAIInternal() {
    if (aiBusy) return false;
    if (!isReady()) {
      aiStatus('AI待機中');
      return false;
    }
    if (gameState !== 'playing') {
      aiStatus(gameState === 'gameover' ? 'ゲームオーバー' : 'AI待機中');
      return false;
    }
    if (!currentPuyo) {
      aiStatus('操作ぷよ待ち');
      return false;
    }

    aiBusy = true;
    setStepButtonDisabled(true);
    aiStatus('AI思考中...');

    try {
      const plan = think();
      if (!plan) {
        aiStatus('手が見つかりませんでした');
        return false;
      }

      applyPlan(plan);
      lastThinkAt = Date.now();
      aiStatus(`AI完了 / 想定 ${plan.predictedChains}連 / ${plan.searchMs}ms`);
      return true;
    } catch (err) {
      console.error('[PuyoAI] think failed:', err);
      aiStatus('AIエラー');
      return false;
    } finally {
      aiBusy = false;
      setStepButtonDisabled(false);
    }
  }

  function scheduleAutoTick() {
    if (!autoEnabled) return;
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }

    autoTimer = setTimeout(() => {
      autoTimer = null;
      if (!autoEnabled) return;

      if (!isReady() || gameState !== 'playing') {
        aiStatus(gameState === 'gameover' ? 'ゲームオーバー' : 'AI待機中');
        scheduleAutoTick();
        return;
      }

      if (!currentPuyo) {
        aiStatus('操作ぷよ待ち');
        scheduleAutoTick();
        return;
      }

      const didRun = runPuyoAIInternal();
      if (!didRun) {
        scheduleAutoTick();
        return;
      }

      scheduleAutoTick();
    }, AI_CONFIG.AUTO_INTERVAL_MS);
  }

  window.PuyoAI = {
    think,
    runOnce: runPuyoAIInternal,
    config: AI_CONFIG,
  };

  window.runPuyoAI = function () {
    return runPuyoAIInternal();
  };

  window.toggleAIAuto = function () {
    autoEnabled = !autoEnabled;
    setAutoButton(autoEnabled);

    if (autoEnabled) {
      aiStatus('AI自動実行中');
      scheduleAutoTick();
    } else {
      if (autoTimer) {
        clearTimeout(autoTimer);
        autoTimer = null;
      }
      aiStatus('AI待機中');
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    setAutoButton(false);
    setStepButtonDisabled(false);
    aiStatus('AI待機中');
  });
})();