/* puyoAI.js
 * WASM direct loader + JS fallback
 * - No worker required
 * - Handles AI error path explicitly
 * - Uses current piece + NEXT1 + NEXT2
 * - Designed for current puyoSim.js globals
 */
(function () {
    'use strict';

    const BOARD_W = 6;
    const BOARD_H = 14;
    const COLORS = typeof window.COLORS !== 'undefined'
        ? window.COLORS
        : { EMPTY: 0, RED: 1, BLUE: 2, GREEN: 3, YELLOW: 4, GARBAGE: 5 };

    const AI_CONFIG = {
        AUTO_TICK_MS: 120,
        SEARCH_BEAM_WIDTH: 8,
        DANGER_X: 2,
        DANGER_Y: 11
    };

    let autoEnabled = false;
    let autoTimer = null;
    let busy = false;

    let wasmModule = null;
    let chooseMove = null;
    let wasmInitPromise = null;

    let uiInitialized = false;

    function setStatus(text) {
        const el = document.getElementById('ai-status');
        if (el) el.textContent = text;
    }

    function updateAutoButton() {
        const btn = document.getElementById('ai-auto-button');
        if (btn) btn.textContent = autoEnabled ? 'AI自動: ON' : 'AI自動: OFF';
    }

    function safeBoard() {
        if (typeof board === 'undefined' || !Array.isArray(board)) return null;
        return board;
    }

    function safeCurrentPuyo() {
        if (typeof currentPuyo === 'undefined' || !currentPuyo) return null;
        return currentPuyo;
    }

    function safeQueue() {
        if (typeof window.getNextQueue === 'function') {
            const q = window.getNextQueue();
            if (Array.isArray(q)) return q;
        }
        if (typeof nextQueue !== 'undefined' && Array.isArray(nextQueue)) return nextQueue;
        return [];
    }

    function safeQueueIndex() {
        if (typeof queueIndex !== 'undefined' && Number.isFinite(queueIndex)) return queueIndex;
        return 0;
    }

    function cloneBoard(src) {
        return src.map(row => row.slice());
    }

    function boardToFlatArray(srcBoard) {
        const flat = new Int32Array(BOARD_W * BOARD_H);
        for (let y = 0; y < BOARD_H; y++) {
            for (let x = 0; x < BOARD_W; x++) {
                flat[y * BOARD_W + x] = srcBoard[y]?.[x] ?? COLORS.EMPTY;
            }
        }
        return flat;
    }

    function getPiecePayload() {
        const cur = safeCurrentPuyo();
        if (!cur) return null;

        const q = safeQueue();
        const idx = safeQueueIndex();
        const p1 = q[idx] || [0, 0];
        const p2 = q[idx + 1] || [0, 0];

        return new Int32Array([
            cur.subColor || 0,
            cur.mainColor || 0,
            p1[0] || 0,
            p1[1] || 0,
            p2[0] || 0,
            p2[1] || 0
        ]);
    }

    function decodePackedMove(packed) {
        return {
            rotation: packed & 0xff,
            x: (packed >> 8) & 0xff,
            y: (packed >> 16) & 0xff
        };
    }

    function coordsFromState(piece, x, y, rotation) {
        let sx = x;
        let sy = y;

        if (rotation === 0) sy = y + 1;
        else if (rotation === 1) sx = x - 1;
        else if (rotation === 2) sy = y - 1;
        else if (rotation === 3) sx = x + 1;

        return [
            { x, y, color: piece.mainColor },
            { x: sx, y: sy, color: piece.subColor }
        ];
    }

    function canPlace(boardState, piece, x, y, rotation) {
        const coords = coordsFromState(piece, x, y, rotation);
        for (const c of coords) {
            if (c.x < 0 || c.x >= BOARD_W || c.y < 0 || c.y >= BOARD_H) return false;
            if (boardState[c.y][c.x] !== COLORS.EMPTY) return false;
        }
        return true;
    }

    function placePiece(boardState, piece, x, y, rotation) {
        const next = cloneBoard(boardState);
        const coords = coordsFromState(piece, x, y, rotation);
        for (const c of coords) {
            if (c.x >= 0 && c.x < BOARD_W && c.y >= 0 && c.y < BOARD_H) {
                next[c.y][c.x] = c.color;
            }
        }
        return next;
    }

    function gravity(boardState) {
        for (let x = 0; x < BOARD_W; x++) {
            const col = [];
            for (let y = 0; y < BOARD_H; y++) {
                if (boardState[y][x] !== COLORS.EMPTY) col.push(boardState[y][x]);
            }
            for (let y = 0; y < BOARD_H; y++) {
                boardState[y][x] = y < col.length ? col[y] : COLORS.EMPTY;
            }
        }
    }

    function findGroups(boardState) {
        const visited = Array.from({ length: BOARD_H }, () => Array(BOARD_W).fill(false));
        const groups = [];

        for (let y = 0; y < BOARD_H; y++) {
            for (let x = 0; x < BOARD_W; x++) {
                const color = boardState[y][x];
                if (color === COLORS.EMPTY || color === COLORS.GARBAGE || visited[y][x]) continue;

                const stack = [{ x, y }];
                visited[y][x] = true;
                const group = [];

                while (stack.length) {
                    const cur = stack.pop();
                    group.push(cur);

                    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
                    for (const [dx, dy] of dirs) {
                        const nx = cur.x + dx;
                        const ny = cur.y + dy;
                        if (
                            nx >= 0 && nx < BOARD_W &&
                            ny >= 0 && ny < BOARD_H &&
                            !visited[ny][nx] &&
                            boardState[ny][nx] === color
                        ) {
                            visited[ny][nx] = true;
                            stack.push({ x: nx, y: ny });
                        }
                    }
                }

                if (group.length >= 4) groups.push({ color, group });
            }
        }

        return groups;
    }

    function clearGarbageNeighbors(boardState, erasedCoords) {
        const toClear = new Set();

        for (const { x, y } of erasedCoords) {
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dx, dy] of dirs) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < BOARD_W && ny >= 0 && ny < BOARD_H) {
                    if (boardState[ny][nx] === COLORS.GARBAGE) {
                        toClear.add(`${nx},${ny}`);
                    }
                }
            }
        }

        for (const key of toClear) {
            const [x, y] = key.split(',').map(Number);
            boardState[y][x] = COLORS.EMPTY;
        }
    }

    function calculateScore(groups, chainNo) {
        const BONUS_TABLE = typeof window.BONUS_TABLE !== 'undefined'
            ? window.BONUS_TABLE
            : {
                CHAIN: [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512],
                GROUP: [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                COLOR: [0, 0, 3, 6, 12]
            };

        let totalPuyos = 0;
        let colorSet = new Set();
        let bonusTotal = 0;

        for (const { color, group } of groups) {
            totalPuyos += group.length;
            colorSet.add(color);
            bonusTotal += BONUS_TABLE.GROUP[Math.min(group.length, BONUS_TABLE.GROUP.length - 1)] || 0;
        }

        const chainIdx = Math.max(0, Math.min(chainNo - 1, BONUS_TABLE.CHAIN.length - 1));
        bonusTotal += BONUS_TABLE.CHAIN[chainIdx] || 0;

        const colorIdx = Math.min(colorSet.size, BONUS_TABLE.COLOR.length - 1);
        bonusTotal += BONUS_TABLE.COLOR[colorIdx] || 0;

        const finalBonus = Math.max(1, Math.min(999, bonusTotal));
        return (10 * totalPuyos) * finalBonus;
    }

    function resolveBoard(boardState) {
        const next = cloneBoard(boardState);
        let chains = 0;
        let score = 0;
        let attack = 0;

        while (true) {
            gravity(next);
            const groups = findGroups(next);
            if (groups.length === 0) break;

            chains++;
            const chainScore = calculateScore(groups, chains);
            score += chainScore;
            attack += Math.floor(Math.max(0, chainScore) / 70);

            const erased = [];
            for (const { group } of groups) {
                for (const p of group) {
                    next[p.y][p.x] = COLORS.EMPTY;
                    erased.push(p);
                }
            }
            clearGarbageNeighbors(next, erased);
        }

        gravity(next);

        let allClear = true;
        for (let y = 0; y < BOARD_H; y++) {
            for (let x = 0; x < BOARD_W; x++) {
                if (next[y][x] !== COLORS.EMPTY) {
                    allClear = false;
                    break;
                }
            }
            if (!allClear) break;
        }

        if (allClear) {
            const ac = typeof window.ALL_CLEAR_SCORE_BONUS !== 'undefined' ? window.ALL_CLEAR_SCORE_BONUS : 2100;
            score += ac;
            attack += Math.floor(Math.max(0, ac) / 70);
        }

        return { board: next, chains, score, attack, allClear };
    }

    function columnHeights(boardState) {
        const heights = Array(BOARD_W).fill(0);
        for (let x = 0; x < BOARD_W; x++) {
            for (let y = BOARD_H - 1; y >= 0; y--) {
                if (boardState[y][x] !== COLORS.EMPTY) {
                    heights[x] = y + 1;
                    break;
                }
            }
        }
        return heights;
    }

    function countHoles(boardState, heights) {
        let holes = 0;
        for (let x = 0; x < BOARD_W; x++) {
            for (let y = 0; y < heights[x]; y++) {
                if (boardState[y][x] === COLORS.EMPTY) holes++;
            }
        }
        return holes;
    }

    function dangerPenalty(boardState) {
        const x = AI_CONFIG.DANGER_X;
        const y = AI_CONFIG.DANGER_Y;
        let penalty = 0;

        if (boardState[y]?.[x] !== COLORS.EMPTY) penalty += 1000000;

        const heights = columnHeights(boardState);
        if (heights[x] >= y + 1) penalty += 250000;
        if (heights[x] >= y - 1) penalty += 80000;

        for (let yy = Math.max(0, y - 2); yy <= y; yy++) {
            if (boardState[yy]?.[x] !== COLORS.EMPTY) penalty += 25000;
        }

        return penalty;
    }

    function seedPotential(boardState) {
        const visited = Array.from({ length: BOARD_H }, () => Array(BOARD_W).fill(false));
        let s = 0;

        for (let y = 0; y < BOARD_H; y++) {
            for (let x = 0; x < BOARD_W; x++) {
                const color = boardState[y][x];
                if (color === COLORS.EMPTY || color === COLORS.GARBAGE || visited[y][x]) continue;

                const stack = [{ x, y }];
                visited[y][x] = true;
                const cells = [];

                while (stack.length) {
                    const cur = stack.pop();
                    cells.push(cur);
                    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
                    for (const [dx, dy] of dirs) {
                        const nx = cur.x + dx;
                        const ny = cur.y + dy;
                        if (
                            nx >= 0 && nx < BOARD_W &&
                            ny >= 0 && ny < BOARD_H &&
                            !visited[ny][nx] &&
                            boardState[ny][nx] === color
                        ) {
                            visited[ny][nx] = true;
                            stack.push({ x: nx, y: ny });
                        }
                    }
                }

                if (cells.length === 2) s += 18;
                else if (cells.length === 3) s += 55;
                else if (cells.length >= 5) s += Math.min(80, cells.length * 8);
            }
        }

        return s;
    }

    function evaluateBoard(boardState) {
        const heights = columnHeights(boardState);
        const holes = countHoles(boardState, heights);
        const maxH = Math.max(...heights);
        const bumpiness = heights.reduce(
            (sum, h, i) => sum + (i > 0 ? Math.abs(h - heights[i - 1]) : 0),
            0
        );

        let score = 0;
        score += seedPotential(boardState) * 14;
        score -= holes * 38;
        score -= bumpiness * 10;
        score -= maxH * 30;
        score -= dangerPenalty(boardState);

        if (maxH >= BOARD_H - 3) score -= 120;
        if (maxH >= BOARD_H - 2) score -= 260;

        return score;
    }

    function dropRestY(boardState, piece, x, rotation) {
        let best = null;
        for (let y = 0; y < BOARD_H; y++) {
            if (!canPlace(boardState, piece, x, y, rotation)) continue;
            if (y === 0 || !canPlace(boardState, piece, x, y - 1, rotation)) {
                best = y;
            }
        }
        return best;
    }

    function generatePlacements(boardState, piece) {
        const placements = [];
        for (let rot = 0; rot < 4; rot++) {
            for (let x = 0; x < BOARD_W; x++) {
                const y = dropRestY(boardState, piece, x, rot);
                if (y !== null && y !== undefined) {
                    placements.push({ x, y, rotation: rot });
                }
            }
        }
        return placements;
    }

    function simulateMove(boardState, piece, move) {
        const placed = placePiece(boardState, piece, move.x, move.y, move.rotation);
        return resolveBoard(placed);
    }

    function chooseBestMoveFallback() {
        const cur = safeCurrentPuyo();
        const b = safeBoard();
        if (!cur || !b) return null;

        const piece = {
            mainColor: cur.mainColor || 0,
            subColor: cur.subColor || 0
        };

        const placements = generatePlacements(b, piece);
        if (!placements.length) return null;

        let best = null;

        for (const mv of placements) {
            const sim = simulateMove(b, piece, mv);
            let value = 0;

            value += sim.score * 12;
            value += sim.attack * 1800;
            value += sim.chains * 250000;
            value += evaluateBoard(sim.board);
            value += sim.allClear ? 250000 : 0;

            if (!best || value > best.value) {
                best = { ...mv, value };
            }
        }

        return best ? { x: best.x, y: best.y, rotation: best.rotation } : null;
    }

    async function ensureWasm() {
        if (chooseMove) return wasmModule;
        if (wasmInitPromise) return wasmInitPromise;

        wasmInitPromise = (async () => {
            const mod = await import('./puyoAI_wasm.mjs');
            const createModule = mod.default;
            wasmModule = await createModule({ noInitialRun: true });
            chooseMove = wasmModule.cwrap('ai_choose_move', 'number', ['number', 'number']);
            return wasmModule;
        })();

        return wasmInitPromise;
    }

    function callWasmSolver(boardFlat, piecesFlat) {
        if (!wasmModule || !chooseMove) {
            throw new Error('WASM solver is not ready');
        }

        const boardPtr = wasmModule._malloc(boardFlat.length * 4);
        const piecesPtr = wasmModule._malloc(piecesFlat.length * 4);

        try {
            wasmModule.HEAP32.set(boardFlat, boardPtr >> 2);
            wasmModule.HEAP32.set(piecesFlat, piecesPtr >> 2);

            const packed = chooseMove(boardPtr, piecesPtr);
            return decodePackedMove(packed);
        } finally {
            wasmModule._free(boardPtr);
            wasmModule._free(piecesPtr);
        }
    }

    function isLegalMove(move) {
        const cur = safeCurrentPuyo();
        const b = safeBoard();
        if (!cur || !b || !move) return false;

        const piece = {
            mainColor: cur.mainColor || 0,
            subColor: cur.subColor || 0
        };

        return canPlace(b, piece, move.x, move.y, move.rotation);
    }

    async function requestMove() {
        if (typeof gameState !== 'undefined' && gameState !== 'playing') {
            throw new Error('not playing');
        }

        const b = safeBoard();
        const pieces = getPiecePayload();
        if (!b || !pieces) {
            throw new Error('snapshot unavailable');
        }

        const boardFlat = boardToFlatArray(b);

        try {
            await ensureWasm();
            const move = callWasmSolver(boardFlat, pieces);
            if (move && isLegalMove(move)) {
                return move;
            }
            throw new Error('WASM returned invalid move');
        } catch (err) {
            console.warn('WASM AI failed, switching to JS fallback:', err);
            setStatus('WASM失敗→JSで思考');
            const fallbackMove = chooseBestMoveFallback();
            if (fallbackMove) return fallbackMove;
            throw err;
        }
    }

    function applyMove(move) {
        const cur = safeCurrentPuyo();
        if (!cur || !move) return false;

        const b = safeBoard();
        if (!b) return false;

        const piece = {
            mainColor: cur.mainColor || 0,
            subColor: cur.subColor || 0
        };

        if (!canPlace(b, piece, move.x, move.y, move.rotation)) {
            return false;
        }

        cur.mainX = move.x;
        cur.mainY = move.y;
        cur.rotation = move.rotation;

        if (typeof renderBoard === 'function') renderBoard();
        return true;
    }

    async function runOnce() {
        if (busy) return;

        if (typeof gameState !== 'undefined' && gameState !== 'playing') {
            setStatus('AI待機中');
            return;
        }

        if (!safeCurrentPuyo()) {
            setStatus('AI待機中');
            return;
        }

        busy = true;
        setStatus('AI思考中...');

        try {
            const move = await requestMove();
            if (!move) {
                setStatus('手なし');
                return;
            }

            if (!applyMove(move)) {
                setStatus('AIエラー');
                return;
            }

            if (typeof hardDrop === 'function') {
                hardDrop();
            }

            setStatus('AI実行完了');
        } catch (err) {
            if (String(err?.message || err).includes('not playing')) {
                setStatus('AI待機中');
            } else {
                console.error('AI error:', err);
                setStatus('AIエラー');
            }
        } finally {
            busy = false;
        }
    }

    function startAuto() {
        stopAuto();
        autoTimer = setInterval(() => {
            if (autoEnabled && !busy) runOnce();
        }, AI_CONFIG.AUTO_TICK_MS);
    }

    function stopAuto() {
        if (autoTimer) {
            clearInterval(autoTimer);
            autoTimer = null;
        }
    }

    function initAIUI() {
        if (uiInitialized) return;
        uiInitialized = true;
        updateAutoButton();
        setStatus('AI待機中');
    }

    window.runPuyoAI = function () {
        runOnce();
    };

    window.toggleAIAuto = function () {
        autoEnabled = !autoEnabled;
        updateAutoButton();

        if (autoEnabled) {
            setStatus('AI自動起動');
            startAuto();
            runOnce();
        } else {
            stopAuto();
            setStatus('AI待機中');
        }
    };

    window.PuyoAI = {
        runOnce,
        requestMove,
        chooseBestMoveFallback,
        evaluateBoard,
        resolveBoard
    };

    function boot() {
        initAIUI();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();