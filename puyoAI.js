/* puyoAI.js
 * Chain-first AI for Puyo Puyo Simulator
 * - beam search
 * - quiescence-like leaf extension
 * - chain length priority
 * - board-shape evaluation
 * - autoplay helper
 */
(() => {
  'use strict';

  const AI = {
    LOOKAHEAD_PLIES: 5,
    BEAM_WIDTH: 12,
    TIME_BUDGET_MS: 650,
    AUTO_TICK_MS: 70,
    ENABLE_AUTOPLAY: false,
    DEBUG: false,
  };

  const C = {
    EMPTY: 0,
    RED: 1,
    BLUE: 2,
    GREEN: 3,
    YELLOW: 4,
    GARBAGE: 5,
  };

  const BONUS_TABLE = {
    CHAIN: [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512],
    GROUP: [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    COLOR: [0, 0, 3, 6, 12],
  };

  const ALL_CLEAR_SCORE_BONUS = 2100;

  let autoTimer = null;
  let searchBusy = false;
  let lastPlannedSignature = '';
  let cachedPlan = null;

  function getBoard() {
    return (typeof board !== 'undefined' && Array.isArray(board)) ? board : null;
  }

  function getCurrentPuyo() {
    return (typeof currentPuyo !== 'undefined' && currentPuyo) ? currentPuyo : null;
  }

  function getGameState() {
    return (typeof gameState !== 'undefined') ? gameState : 'playing';
  }

  function getWidth() {
    return (typeof WIDTH === 'number') ? WIDTH : 6;
  }

  function getHeight() {
    return (typeof HEIGHT === 'number') ? HEIGHT : 14;
  }

  function getHiddenRows() {
    return (typeof HIDDEN_ROWS === 'number') ? HIDDEN_ROWS : 2;
  }

  function getVisibleHeight() {
    return getHeight() - getHiddenRows();
  }

  function cloneBoard(src) {
    return src.map(row => row.slice());
  }

  function isEmptyCell(v) {
    return v === C.EMPTY;
  }

  function boardKey(b) {
    return b.map(row => row.join('')).join('|');
  }

  function sleepLikeBudgetExceeded(startTime) {
    return performance.now() - startTime > AI.TIME_BUDGET_MS;
  }

  function inBounds(x, y) {
    return x >= 0 && x < getWidth() && y >= 0 && y < getHeight();
  }

  function getCoordsFromState(pieceState) {
    const { mainX, mainY, rotation } = pieceState;
    let subX = mainX;
    let subY = mainY;

    if (rotation === 0) subY = mainY + 1;
    else if (rotation === 1) subX = mainX - 1;
    else if (rotation === 2) subY = mainY - 1;
    else if (rotation === 3) subX = mainX + 1;

    return [
      { x: mainX, y: mainY, color: pieceState.mainColor },
      { x: subX, y: subY, color: pieceState.subColor },
    ];
  }

  function canOccupy(boardState, coords) {
    const visibleHeight = getVisibleHeight();

    for (const p of coords) {
      if (!inBounds(p.x, p.y)) return false;
      if (p.y < visibleHeight && boardState[p.y][p.x] !== C.EMPTY) return false;
    }
    return true;
  }

  function findLanding(boardState, piece, mainX, rotation) {
    const spawnY = getHeight() - 2;
    let y = spawnY;

    const startState = {
      mainX,
      mainY: y,
      rotation,
      mainColor: piece.mainColor,
      subColor: piece.subColor,
    };

    if (!canOccupy(boardState, getCoordsFromState(startState))) {
      // そのままでは置けない配置は除外
      return null;
    }

    while (true) {
      const nextState = {
        mainX,
        mainY: y - 1,
        rotation,
        mainColor: piece.mainColor,
        subColor: piece.subColor,
      };
      const nextCoords = getCoordsFromState(nextState);
      if (!canOccupy(boardState, nextCoords)) break;
      y--;
    }

    return {
      mainX,
      mainY: y,
      rotation,
      mainColor: piece.mainColor,
      subColor: piece.subColor,
    };
  }

  function enumerateLandingPlacements(boardState, piece) {
    const placements = [];
    const width = getWidth();

    for (let rotation = 0; rotation < 4; rotation++) {
      const minX = (rotation === 1) ? 1 : 0;
      const maxX = (rotation === 3) ? width - 2 : width - 1;

      for (let mainX = minX; mainX <= maxX; mainX++) {
        const landing = findLanding(boardState, piece, mainX, rotation);
        if (landing) placements.push(landing);
      }
    }

    // 重複を軽く除去
    const seen = new Set();
    return placements.filter(p => {
      const key = `${p.mainX},${p.mainY},${p.rotation}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function simulateGravity(boardState) {
    const width = getWidth();
    const height = getHeight();

    for (let x = 0; x < width; x++) {
      const col = [];
      for (let y = 0; y < height; y++) {
        if (boardState[y][x] !== C.EMPTY) col.push(boardState[y][x]);
      }
      for (let y = 0; y < height; y++) {
        boardState[y][x] = (y < col.length) ? col[y] : C.EMPTY;
      }
    }
  }

  function findConnectedGroups(boardState) {
    const width = getWidth();
    const visibleHeight = getVisibleHeight();
    const visited = Array.from({ length: getHeight() }, () => Array(width).fill(false));
    const groups = [];

    for (let y = 0; y < visibleHeight; y++) {
      for (let x = 0; x < width; x++) {
        const color = boardState[y][x];
        if (color === C.EMPTY || color === C.GARBAGE || visited[y][x]) continue;

        const stack = [{ x, y }];
        visited[y][x] = true;
        const group = [];

        while (stack.length) {
          const cur = stack.pop();
          group.push(cur);

          const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
          for (const [dx, dy] of dirs) {
            const nx = cur.x + dx;
            const ny = cur.y + dy;
            if (
              nx >= 0 && nx < width &&
              ny >= 0 && ny < visibleHeight &&
              !visited[ny][nx] &&
              boardState[ny][nx] === color
            ) {
              visited[ny][nx] = true;
              stack.push({ x: nx, y: ny });
            }
          }
        }

        if (group.length >= 4) {
          groups.push({ color, group });
        }
      }
    }

    return groups;
  }

  function clearGarbageAdjacentTo(boardState, erasedCoords) {
    const width = getWidth();
    const height = getHeight();
    const toClear = new Set();
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];

    for (const { x, y } of erasedCoords) {
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          if (boardState[ny][nx] === C.GARBAGE) {
            toClear.add(`${nx},${ny}`);
          }
        }
      }
    }

    for (const key of toClear) {
      const [x, y] = key.split(',').map(Number);
      boardState[y][x] = C.EMPTY;
    }
  }

  function resolveBoard(boardState) {
    const height = getHeight();
    const width = getWidth();

    let totalScore = 0;
    let chainCountResolved = 0;
    let totalCleared = 0;

    while (true) {
      simulateGravity(boardState);
      const groups = findConnectedGroups(boardState);
      if (groups.length === 0) break;

      chainCountResolved++;
      let totalPuyos = 0;
      const colorSet = new Set();
      let groupBonus = 0;
      const erasedCoords = [];

      for (const { color, group } of groups) {
        totalPuyos += group.length;
        colorSet.add(color);
        const groupIdx = Math.min(group.length, BONUS_TABLE.GROUP.length - 1);
        groupBonus += BONUS_TABLE.GROUP[groupIdx];

        for (const p of group) erasedCoords.push(p);
      }

      const chainIdx = Math.max(0, Math.min(chainCountResolved - 1, BONUS_TABLE.CHAIN.length - 1));
      const colorIdx = Math.min(colorSet.size, BONUS_TABLE.COLOR.length - 1);

      let bonus = groupBonus + BONUS_TABLE.CHAIN[chainIdx] + BONUS_TABLE.COLOR[colorIdx];
      if (bonus <= 0) bonus = 1;

      const stepScore = (10 * totalPuyos) * bonus;
      totalScore += stepScore;
      totalCleared += totalPuyos;

      for (const { group } of groups) {
        for (const p of group) {
          boardState[p.y][p.x] = C.EMPTY;
        }
      }

      clearGarbageAdjacentTo(boardState, erasedCoords);
      simulateGravity(boardState);
    }

    const allClear = isBoardEmpty(boardState);
    if (allClear) {
      totalScore += ALL_CLEAR_SCORE_BONUS;
    }

    return {
      board: boardState,
      chainCount: chainCountResolved,
      score: totalScore,
      totalCleared,
      allClear,
    };
  }

  function isBoardEmpty(boardState) {
    for (let y = 0; y < getHeight(); y++) {
      for (let x = 0; x < getWidth(); x++) {
        if (boardState[y][x] !== C.EMPTY) return false;
      }
    }
    return true;
  }

  function simulatePlacementAndResolve(baseBoard, piece, placement) {
    const boardState = cloneBoard(baseBoard);

    const coords = getCoordsFromState(placement);
    if (!canOccupy(boardState, coords)) return null;

    // piece を置く
    boardState[coords[0].y][coords[0].x] = piece.mainColor;
    boardState[coords[1].y][coords[1].x] = piece.subColor;

    simulateGravity(boardState);
    return resolveBoard(boardState);
  }

  function countVisibleEmptyCells(boardState) {
    const visibleHeight = getVisibleHeight();
    let count = 0;
    for (let y = 0; y < visibleHeight; y++) {
      for (let x = 0; x < getWidth(); x++) {
        if (boardState[y][x] === C.EMPTY) count++;
      }
    }
    return count;
  }

  function evaluateShape(boardState) {
    const width = getWidth();
    const visibleHeight = getVisibleHeight();

    const heights = [];
    let holes = 0;
    let roughness = 0;
    let maxHeight = 0;
    let occupiedVisible = 0;

    for (let x = 0; x < width; x++) {
      let columnHeight = 0;
      let seenBlock = false;

      for (let y = visibleHeight - 1; y >= 0; y--) {
        const v = boardState[y][x];
        if (v !== C.EMPTY) {
          if (!seenBlock) {
            columnHeight = y + 1;
            seenBlock = true;
          }
          occupiedVisible++;
        } else if (seenBlock) {
          holes++;
        }
      }

      heights.push(columnHeight);
      maxHeight = Math.max(maxHeight, columnHeight);
    }

    for (let x = 1; x < width; x++) {
      roughness += Math.abs(heights[x] - heights[x - 1]);
    }

    // 同色のまとまりをざっくり数える
    const visited = Array.from({ length: visibleHeight }, () => Array(width).fill(false));
    let triads = 0;
    let duos = 0;
    let singles = 0;
    let bigClusters = 0;

    for (let y = 0; y < visibleHeight; y++) {
      for (let x = 0; x < width; x++) {
        const color = boardState[y][x];
        if (color === C.EMPTY || color === C.GARBAGE || visited[y][x]) continue;

        const stack = [{ x, y }];
        visited[y][x] = true;
        let size = 0;

        while (stack.length) {
          const cur = stack.pop();
          size++;

          const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
          for (const [dx, dy] of dirs) {
            const nx = cur.x + dx;
            const ny = cur.y + dy;
            if (
              nx >= 0 && nx < width &&
              ny >= 0 && ny < visibleHeight &&
              !visited[ny][nx] &&
              boardState[ny][nx] === color
            ) {
              visited[ny][nx] = true;
              stack.push({ x: nx, y: ny });
            }
          }
        }

        if (size === 1) singles++;
        else if (size === 2) duos++;
        else if (size === 3) triads++;
        else bigClusters += size;
      }
    }

    let sameAdj = 0;
    for (let y = 0; y < visibleHeight; y++) {
      for (let x = 0; x < width; x++) {
        const v = boardState[y][x];
        if (v === C.EMPTY || v === C.GARBAGE) continue;
        if (x + 1 < width && boardState[y][x + 1] === v) sameAdj++;
        if (y + 1 < visibleHeight && boardState[y + 1][x] === v) sameAdj++;
      }
    }

    const emptyVisible = countVisibleEmptyCells(boardState);
    const spacePressure = Math.max(0, 18 - emptyVisible);

    // chain を作りやすい形を強めに評価
    const chainPotential =
      triads * 900 +
      duos * 240 +
      sameAdj * 18 +
      bigClusters * 35 +
      spacePressure * 100 -
      holes * 260 -
      roughness * 20 -
      maxHeight * 18 -
      singles * 18;

    return {
      chainPotential,
      holes,
      roughness,
      maxHeight,
      emptyVisible,
      triads,
      duos,
      singles,
      sameAdj,
      bigClusters,
    };
  }

  function buildSearchSequence() {
    const sequence = [];
    const puyo = getCurrentPuyo();
    if (!puyo) return sequence;

    sequence.push({
      mainColor: puyo.mainColor,
      subColor: puyo.subColor,
      source: 'current',
    });

    const q = (typeof nextQueue !== 'undefined' && Array.isArray(nextQueue))
      ? nextQueue
      : (typeof window.getNextQueue === 'function' ? window.getNextQueue() : []);

    const startIndex = (typeof queueIndex === 'number') ? queueIndex : 0;
    for (let i = 0; sequence.length < AI.LOOKAHEAD_PLIES && startIndex + i < q.length; i++) {
      const pair = q[startIndex + i];
      if (!pair || pair.length < 2) break;
      sequence.push({
        mainColor: pair[1],
        subColor: pair[0],
        source: 'next',
        index: startIndex + i,
      });
    }

    return sequence;
  }

  function scoreNode(node, resolution, depthIndex) {
    const shape = evaluateShape(resolution.board);

    let priority = 0;

    // chain 長を最優先
    const chainBoost = resolution.chainCount > 0 ? (resolution.chainCount * resolution.chainCount * 100000000) : 0;
    priority += chainBoost;

    // その枝で出たスコアも次点で評価
    priority += resolution.score * 400;

    // これまでの最大 chain を強く保持
    priority += node.maxChainTriggered * 10000000;

    // chain がまだ起きていない局面は build-up を重視
    if (node.maxChainTriggered === 0 && resolution.chainCount === 0) {
      priority += shape.chainPotential * 300;
      priority -= shape.holes * 800;
      priority -= shape.roughness * 25;
      priority -= shape.maxHeight * 40;
    } else {
      priority += shape.chainPotential * 40;
      priority -= shape.holes * 200;
      priority -= shape.roughness * 10;
      priority -= shape.maxHeight * 20;
    }

    // 早く強い形に到達した枝を少し優先
    priority += (AI.LOOKAHEAD_PLIES - depthIndex) * 250;

    // 安全なスペースも少し見る
    priority += shape.emptyVisible * 8;

    return priority;
  }

  function searchBestMove() {
    const boardState = getBoard();
    const piece = getCurrentPuyo();

    if (!boardState || !piece || getGameState() !== 'playing') return null;

    const signature = [
      boardKey(boardState),
      piece.mainColor,
      piece.subColor,
      piece.mainX,
      piece.mainY,
      piece.rotation,
      typeof queueIndex === 'number' ? queueIndex : 0,
    ].join(':');

    if (signature === lastPlannedSignature && cachedPlan) {
      return cachedPlan;
    }

    const start = performance.now();
    const sequence = buildSearchSequence();
    if (!sequence.length) return null;

    let frontier = [{
      board: cloneBoard(boardState),
      maxChainTriggered: 0,
      totalScore: 0,
      firstAction: null,
      priority: -Infinity,
    }];

    let bestSeen = null;

    for (let depthIndex = 0; depthIndex < sequence.length; depthIndex++) {
      const nextFrontier = [];
      const currentPiece = sequence[depthIndex];

      for (const node of frontier) {
        const placements = enumerateLandingPlacements(node.board, currentPiece);

        for (const placement of placements) {
          if (sleepLikeBudgetExceeded(start)) {
            break;
          }

          const resolution = simulatePlacementAndResolve(node.board, currentPiece, placement);
          if (!resolution) continue;

          const firstAction = node.firstAction || {
            rotation: placement.rotation,
            mainX: placement.mainX,
          };

          const newNode = {
            board: resolution.board,
            maxChainTriggered: Math.max(node.maxChainTriggered, resolution.chainCount),
            totalScore: node.totalScore + resolution.score,
            firstAction,
            priority: 0,
          };

          newNode.priority = scoreNode(newNode, resolution, depthIndex);

          nextFrontier.push(newNode);

          if (!bestSeen || newNode.priority > bestSeen.priority) {
            bestSeen = newNode;
          }
        }
      }

      if (!nextFrontier.length) break;

      nextFrontier.sort((a, b) => b.priority - a.priority);
      frontier = nextFrontier.slice(0, AI.BEAM_WIDTH);

      if (sleepLikeBudgetExceeded(start)) break;
    }

    const best = frontier[0] || bestSeen;
    const plan = best ? best.firstAction : null;

    lastPlannedSignature = signature;
    cachedPlan = plan;

    if (AI.DEBUG && plan) {
      console.log('[PuyoAI] plan:', plan);
    }

    return plan;
  }

  function pressKey(key) {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
  }

  function rotateToTarget(targetRotation) {
    const piece = getCurrentPuyo();
    if (!piece) return;

    let currentRotation = piece.rotation;
    let cw = (targetRotation - currentRotation + 4) % 4;
    let ccw = (currentRotation - targetRotation + 4) % 4;

    if (cw <= ccw) {
      for (let i = 0; i < cw; i++) pressKey('z');
    } else {
      for (let i = 0; i < ccw; i++) pressKey('x');
    }
  }

  function moveToTargetX(targetX) {
    const piece = getCurrentPuyo();
    if (!piece) return;

    let dx = targetX - piece.mainX;
    if (dx < 0) {
      for (let i = 0; i < Math.abs(dx); i++) pressKey('ArrowLeft');
    } else if (dx > 0) {
      for (let i = 0; i < dx; i++) pressKey('ArrowRight');
    }
  }

  function executePlan(plan) {
    if (!plan) return false;
    if (getGameState() !== 'playing') return false;

    const pieceBefore = getCurrentPuyo();
    if (!pieceBefore) return false;

    // 回転 → 横移動 → ハードドロップ
    rotateToTarget(plan.rotation);

    // 回転キックで mainX が変わることがあるので、毎回再取得
    moveToTargetX(plan.mainX);

    pressKey(' ');
    return true;
  }

  function thinkAndAct() {
    if (searchBusy) return;
    if (getGameState() !== 'playing') return;
    if (!getCurrentPuyo()) return;

    searchBusy = true;
    try {
      const plan = searchBestMove();
      if (plan) {
        executePlan(plan);
      }
    } finally {
      searchBusy = false;
    }
  }

  function startAutoplay() {
    stopAutoplay();
    autoTimer = setInterval(() => {
      if (getGameState() !== 'playing') return;
      if (!getCurrentPuyo()) return;
      thinkAndAct();
    }, AI.AUTO_TICK_MS);
  }

  function stopAutoplay() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  function toggleAutoplay() {
    if (autoTimer) stopAutoplay();
    else startAutoplay();
  }

  function resetCache() {
    lastPlannedSignature = '';
    cachedPlan = null;
  }

  // exposed API
  window.PuyoAI = {
    settings: AI,
    think: searchBestMove,
    act: thinkAndAct,
    startAutoplay,
    stopAutoplay,
    toggleAutoplay,
    resetCache,
    evaluateShape,
    enumerateLandingPlacements,
    simulatePlacementAndResolve,
  };

  // helpers for buttons / console
  window.startPuyoAIAutoplay = startAutoplay;
  window.stopPuyoAIAutoplay = stopAutoplay;
  window.togglePuyoAIAutoplay = toggleAutoplay;
  window.puyoAIThink = searchBestMove;

  if (AI.ENABLE_AUTOPLAY) {
    startAutoplay();
  }
})();
// ===== HTMLボタン対応用 =====
function setAIStatus(text) {
  const el = document.getElementById('ai-status');
  if (el) el.textContent = text;
}

function setAIAutoButtonText(on) {
  const btn = document.getElementById('ai-auto-button');
  if (btn) btn.textContent = on ? 'AI自動: ON' : 'AI自動: OFF';
}

function setAIStepButtonState(disabled) {
  const btn = document.getElementById('ai-step-button');
  if (btn) btn.disabled = !!disabled;
}

function isAIReady() {
  return !!window.PuyoAI && typeof window.PuyoAI.think === 'function';
}

function runPuyoAIInternal() {
  if (!isAIReady()) {
    setAIStatus('AIがまだ読み込まれていません');
    return false;
  }

  if (typeof gameState !== 'undefined' && gameState !== 'playing') {
    setAIStatus('プレイ中のみ実行できます');
    return false;
  }

  if (typeof currentPuyo !== 'undefined' && !currentPuyo) {
    setAIStatus('操作ぷよがありません');
    return false;
  }

  setAIStatus('AI思考中...');
  setAIStepButtonState(true);

  try {
    const plan = window.PuyoAI.think();
    if (!plan) {
      setAIStatus('手が見つかりませんでした');
      return false;
    }

    const piece = typeof currentPuyo !== 'undefined' ? currentPuyo : null;
    if (!piece) {
      setAIStatus('操作ぷよがありません');
      return false;
    }

    // 回転
    const targetRotation = plan.rotation;
    let nowRotation = piece.rotation;
    const cw = (targetRotation - nowRotation + 4) % 4;
    const ccw = (nowRotation - targetRotation + 4) % 4;

    if (cw <= ccw) {
      for (let i = 0; i < cw; i++) {
        if (typeof window.rotatePuyoCW === 'function') window.rotatePuyoCW();
      }
    } else {
      for (let i = 0; i < ccw; i++) {
        if (typeof window.rotatePuyoCCW === 'function') window.rotatePuyoCCW();
      }
    }

    // 横移動
    const updatedPiece = typeof currentPuyo !== 'undefined' ? currentPuyo : null;
    if (updatedPiece) {
      let dx = plan.mainX - updatedPiece.mainX;
      while (dx < 0) {
        if (typeof window.handleInput === 'function') {
          window.handleInput({ key: 'ArrowLeft' });
        } else if (typeof movePuyo === 'function') {
          movePuyo(-1, 0);
        }
        dx++;
      }
      while (dx > 0) {
        if (typeof window.handleInput === 'function') {
          window.handleInput({ key: 'ArrowRight' });
        } else if (typeof movePuyo === 'function') {
          movePuyo(1, 0);
        }
        dx--;
      }
    }

    // ハードドロップ
    if (typeof window.hardDrop === 'function') {
      window.hardDrop();
    } else {
      const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
    }

    setAIStatus('AI完了');
    return true;
  } catch (err) {
    console.error('[PuyoAI] run failed:', err);
    setAIStatus('AI実行エラー');
    return false;
  } finally {
    setAIStepButtonState(false);
  }
}

window.runPuyoAI = function() {
  return runPuyoAIInternal();
};

window.toggleAIAuto = function() {
  if (!isAIReady()) {
    setAIStatus('AIがまだ読み込まれていません');
    return;
  }

  if (window.__puyoAIAutoTimer) {
    clearInterval(window.__puyoAIAutoTimer);
    window.__puyoAIAutoTimer = null;
    setAIAutoButtonText(false);
    setAIStatus('AI待機中');
    return;
  }

  window.__puyoAIAutoTimer = setInterval(() => {
    if (typeof gameState !== 'undefined' && gameState !== 'playing') return;
    if (typeof currentPuyo !== 'undefined' && !currentPuyo) return;
    if (typeof document === 'undefined') return;
    runPuyoAIInternal();
  }, 120);

  setAIAutoButtonText(true);
  setAIStatus('AI自動実行中');
};

// 起動時の表示整備
document.addEventListener('DOMContentLoaded', () => {
  const ready = isAIReady();
  setAIAutoButtonText(false);
  setAIStepButtonState(false);
  setAIStatus(ready ? 'AI待機中' : 'AI読み込み中');
});