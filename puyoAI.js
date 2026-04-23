/* puyoAI.js
 * WASM + Worker AI wrapper with JS fallback
 * - Works with current puyoSim.js globals
 * - Uses current piece + NEXT1 + NEXT2
 * - Falls back to JS search if worker/WASM fails
 */
(function () {
    'use strict';

    const AI_CONFIG = {
        AUTO_TICK_MS: 120,
        WORKER_TIMEOUT_MS: 5000,
        BEAM_WIDTH: 8,
        SEARCH_DEPTH: 3
    };

    const BOARD_W = typeof WIDTH !== 'undefined' ? WIDTH : 6;
    const BOARD_H = typeof HEIGHT !== 'undefined' ? HEIGHT : 14;
    const DANGER_CELL_X = 2;
    const DANGER_CELL_Y = 11;

    let worker = null;
    let pendingJob = null;
    let autoEnabled = false;
    let autoTimer = null;
    let busy = false;
    let booted = false;

    const TEMPLATE_LIBRARY = [
        { mask: [1, 1, 1, 1, 0, 0], profile: [0, 1, 2, 3, 0, 0], weight: 1.00 },
        { mask: [0, 0, 1, 1, 1, 1], profile: [0, 0, 3, 2, 1, 0], weight: 1.00 },
        { mask: [1, 1, 1, 1, 1, 0], profile: [0, 1, 2, 2, 1, 0], weight: 1.20 },
        { mask: [0, 1, 1, 1, 1, 1], profile: [0, 1, 2, 2, 1, 0], weight: 1.20 },
        { mask: [1, 1, 1, 1, 1, 1], profile: [2, 1, 0, 0, 1, 2], weight: 1.05 },
        { mask: [0, 1, 1, 1, 1, 0], profile: [0, 1, 2, 3, 2, 1], weight: 1.00 }
    ];

    const C = () => (typeof COLORS !== 'undefined' ? COLORS : {
        EMPTY: 0,
        RED: 1,
        BLUE: 2,
        GREEN: 3,
        YELLOW: 4,
        GARBAGE: 5
    });

    const cloneBoard = (src) => src.map((row) => row.slice());
    const boardToKey = (boardState) => boardState.map((row) => row.join('')).join('|');

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
            return Array.isArray(q) ? q : [];
        }
        if (typeof nextQueue !== 'undefined' && Array.isArray(nextQueue)) {
            return nextQueue.map((p) => p.slice());
        }
        return [];
    }

    function safeQueueIndex() {
        return typeof queueIndex === 'number' ? queueIndex : 0;
    }

    function getBoardFlat() {
        const b = safeBoard();
        if (!b) return null;

        const flat = new Int32Array(BOARD_W * BOARD_H);
        for (let y = 0; y < BOARD_H; y++) {
            for (let x = 0; x < BOARD_W; x++) {
                flat[y * BOARD_W + x] = b[y]?.[x] ?? 0;
            }
        }
        return flat;
    }

    function pieceFromPair(pair) {
        if (!Array.isArray(pair) || pair.length < 2) return null;
        return { subColor: pair[0] | 0, mainColor: pair[1] | 0 };
    }

    function getPiecePayload() {
        const cur = safeCurrentPuyo();
        if (!cur) return null;

        const q = safeQueue();
        if (q.length < 2) return null;

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

    function getCoordsFromState(puyoState) {
        const { mainX, mainY, rotation } = puyoState;
        let subX = mainX;
        let subY = mainY;

        if (rotation === 0) subY = mainY + 1;
        else if (rotation === 1) subX = mainX - 1;
        else if (rotation === 2) subY = mainY - 1;
        else if (rotation === 3) subX = mainX + 1;

        return [
            { x: mainX, y: mainY, color: puyoState.mainColor },
            { x: subX, y: subY, color: puyoState.subColor }
        ];
    }

    function checkCollisionLocal(coords, boardState) {
        const colors = C();
        for (const p of coords) {
            if (p.x < 0 || p.x >= BOARD_W || p.y < 0 || p.y >= BOARD_H) return true;
            if (boardState[p.y][p.x] !== colors.EMPTY) return true;
        }
        return false;
    }

    function canPlace(boardState, piece, x, y, rotation) {
        const coords = getCoordsFromState({
            mainX: x,
            mainY: y,
            rotation,
            mainColor: piece.mainColor,
            subColor: piece.subColor
        });
        return !checkCollisionLocal(coords, boardState);
    }

    function dropY(boardState, piece, x, rotation) {
        if (!canPlace(boardState, piece, x, BOARD_H - 2, rotation)) return null;

        let y = BOARD_H - 2;
        while (y > 0 && canPlace(boardState, piece, x, y - 1, rotation)) y--;
        return y;
    }

    function placements(boardState, piece) {
        const out = [];
        for (let rotation = 0; rotation < 4; rotation++) {
            for (let x = 0; x < BOARD_W; x++) {
                const y = dropY(boardState, piece, x, rotation);
                if (y !== null) out.push({ x, y, rotation });
            }
        }
        return out;
    }

    function placePiece(boardState, piece, placement) {
        const next = cloneBoard(boardState);
        const coords = getCoordsFromState({
            mainX: placement.x,
            mainY: placement.y,
            rotation: placement.rotation,
            mainColor: piece.mainColor,
            subColor: piece.subColor
        });

        for (const p of coords) {
            if (p.x >= 0 && p.x < BOARD_W && p.y >= 0 && p.y < BOARD_H) {
                next[p.y][p.x] = p.color;
            }
        }
        return next;
    }

    function gravityOn(boardState) {
        const colors = C();
        for (let x = 0; x < BOARD_W; x++) {
            const col = [];
            for (let y = 0; y < BOARD_H; y++) {
                if (boardState[y][x] !== colors.EMPTY) col.push(boardState[y][x]);
            }
            for (let y = 0; y < BOARD_H; y++) {
                boardState[y][x] = y < col.length ? col[y] : colors.EMPTY;
            }
        }
    }

    function findGroups(boardState) {
        const colors = C();
        const visited = Array.from({ length: BOARD_H }, () => Array(BOARD_W).fill(false));
        const groups = [];

        for (let y = 0; y < BOARD_H; y++) {
            for (let x = 0; x < BOARD_W; x++) {
                const color = boardState[y][x];
                if (color === colors.EMPTY || color === colors.GARBAGE || visited[y][x]) continue;

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
        const colors = C();
        const toClear = new Set();

        for (const { x, y } of erasedCoords) {
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dx, dy] of dirs) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < BOARD_W && ny >= 0 && ny < BOARD_H) {
                    if (boardState[ny][nx] === colors.GARBAGE) toClear.add(`${nx},${ny}`);
                }
            }
        }

        for (const key of toClear) {
            const [x, y] = key.split(',').map(Number);
            boardState[y][x] = colors.EMPTY;
        }
    }

    function groupBonus(size) {
        const table = typeof BONUS_TABLE !== 'undefined' && BONUS_TABLE.GROUP
            ? BONUS_TABLE.GROUP
            : [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        return table[Math.min(size, table.length - 1)] || 0;
    }

    function chainBonus(chainNo) {
        const table = typeof BONUS_TABLE !== 'undefined' && BONUS_TABLE.CHAIN
            ? BONUS_TABLE.CHAIN
            : [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512];
        const idx = Math.max(0, Math.min(chainNo - 1, table.length - 1));
        return table[idx] || 0;
    }

    function colorBonus(colorCount) {
        const table = typeof BONUS_TABLE !== 'undefined' && BONUS_TABLE.COLOR
            ? BONUS_TABLE.COLOR
            : [0, 0, 3, 6, 12];
        return table[Math.min(colorCount, table.length - 1)] || 0;
    }

    function calculateScore(groups, chainNo) {
        let totalPuyos = 0;
        const colorSet = new Set();
        let bonusTotal = 0;

        for (const { color, group } of groups) {
            totalPuyos += group.length;
            colorSet.add(color);
            bonusTotal += groupBonus(group.length);
        }

        bonusTotal += chainBonus(chainNo);
        bonusTotal += colorBonus(colorSet.size);

        if (bonusTotal <= 0) bonusTotal = 1;
        return 10 * totalPuyos * bonusTotal;
    }

    function isBoardEmpty(boardState) {
        const colors = C();
        for (let y = 0; y < BOARD_H; y++) {
            for (let x = 0; x < BOARD_W; x++) {
                if (boardState[y][x] !== colors.EMPTY) return false;
            }
        }
        return true;
    }

    function resolveBoard(boardState) {
        const colors = C();
        const acBonus = typeof ALL_CLEAR_SCORE_BONUS !== 'undefined' ? ALL_CLEAR_SCORE_BONUS : 2100;

        let totalChains = 0;
        let totalScore = 0;
        let totalAttack = 0;

        while (true) {
            gravityOn(boardState);
            const groups = findGroups(boardState);
            if (groups.length === 0) break;

            totalChains++;
            const chainScore = calculateScore(groups, totalChains);
            totalScore += chainScore;
            totalAttack += Math.floor(Math.max(0, chainScore) / 70);

            const erased = [];
            for (const { group } of groups) {
                for (const p of group) {
                    boardState[p.y][p.x] = colors.EMPTY;
                    erased.push(p);
                }
            }
            clearGarbageNeighbors(boardState, erased);
        }

        gravityOn(boardState);

        let allClear = false;
        if (isBoardEmpty(boardState)) {
            allClear = true;
            totalScore += acBonus;
            totalAttack += Math.floor(Math.max(0, acBonus) / 70);
        }

        return {
            board: boardState,
            chains: totalChains,
            score: totalScore,
            attack: totalAttack,
            allClear
        };
    }

    function columnHeights(boardState) {
        const colors = C();
        const heights = Array(BOARD_W).fill(0);

        for (let x = 0; x < BOARD_W; x++) {
            let h = 0;
            for (let y = BOARD_H - 1; y >= 0; y--) {
                if (boardState[y][x] !== colors.EMPTY) {
                    h = y + 1;
                    break;
                }
            }
            heights[x] = h;
        }
        return heights;
    }

    function countHoles(boardState, heights) {
        const colors = C();
        let holes = 0;
        for (let x = 0; x < BOARD_W; x++) {
            for (let y = 0; y < heights[x]; y++) {
                if (boardState[y][x] === colors.EMPTY) holes++;
            }
        }
        return holes;
    }

    function bumpiness(heights) {
        let sum = 0;
        for (let i = 1; i < heights.length; i++) sum += Math.abs(heights[i] - heights[i - 1]);
        return sum;
    }

    function openNeighborCount(boardState, cells) {
        const colors = C();
        const seen = new Set();
        let count = 0;

        for (const { x, y } of cells) {
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dx, dy] of dirs) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < BOARD_W && ny >= 0 && ny < BOARD_H && boardState[ny][nx] === colors.EMPTY) {
                    const key = `${nx},${ny}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        count++;
                    }
                }
            }
        }
        return count;
    }

    function findLooseComponents(boardState) {
        const colors = C();
        const visited = Array.from({ length: BOARD_H }, () => Array(BOARD_W).fill(false));
        const out = [];

        for (let y = 0; y < BOARD_H; y++) {
            for (let x = 0; x < BOARD_W; x++) {
                const color = boardState[y][x];
                if (color === colors.EMPTY || color === colors.GARBAGE || visited[y][x]) continue;

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

                out.push({ color, cells });
            }
        }

        return out;
    }

    function seedScore(boardState) {
        const comps = findLooseComponents(boardState);
        let s = 0;

        for (const comp of comps) {
            const size = comp.cells.length;
            if (size === 1) s += 1;
            else if (size === 2) s += 12 + openNeighborCount(boardState, comp.cells) * 2;
            else if (size === 3) s += 35 + openNeighborCount(boardState, comp.cells) * 4;
        }

        for (let y = 0; y < BOARD_H; y++) {
            for (let x = 0; x < BOARD_W; x++) {
                const c = boardState[y][x];
                if (c === 0 || c === 5) continue;

                if (x + 2 < BOARD_W && boardState[y][x + 1] === c && boardState[y][x + 2] === c) {
                    if ((x - 1 >= 0 && boardState[y][x - 1] === 0) || (x + 3 < BOARD_W && boardState[y][x + 3] === 0)) {
                        s += 16;
                    }
                }

                if (y + 2 < BOARD_H && boardState[y + 1][x] === c && boardState[y + 2][x] === c) {
                    if ((y - 1 >= 0 && boardState[y - 1][x] === 0) || (y + 3 < BOARD_H && boardState[y + 3][x] === 0)) {
                        s += 16;
                    }
                }

                if (x + 1 < BOARD_W && y + 1 < BOARD_H) {
                    if (
                        boardState[y][x] === c &&
                        boardState[y][x + 1] === c &&
                        boardState[y + 1][x] === c
                    ) {
                        s += 20;
                    }
                }
            }
        }

        return s;
    }

    function templateScore(boardState) {
        const heights = columnHeights(boardState);
        let best1 = 0;
        let best2 = 0;

        for (const t of TEMPLATE_LIBRARY) {
            const masked = [];
            for (let x = 0; x < BOARD_W; x++) if (t.mask[x]) masked.push(x);
            if (!masked.length) continue;

            let base = Infinity;
            for (const x of masked) base = Math.min(base, heights[x] - t.profile[x]);
            if (!Number.isFinite(base)) continue;

            let s = 0;
            let occupied = 0;
            for (const x of masked) {
                const target = base + t.profile[x];
                const diff = Math.abs(heights[x] - target);
                s += Math.max(0, 8 - diff * 3);
                if (heights[x] > 0) occupied++;
            }

            s += occupied * 2;
            s *= t.weight;

            if (s > best1) {
                best2 = best1;
                best1 = s;
            } else if (s > best2) {
                best2 = s;
            }
        }

        return best1 + best2 * 0.5;
    }

    function dangerPenalty(boardState) {
        const heights = columnHeights(boardState);
        let penalty = 0;

        if (boardState[DANGER_CELL_Y]?.[DANGER_CELL_X] !== 0) penalty += 1000000;
        if (heights[DANGER_CELL_X] >= DANGER_CELL_Y + 1) penalty += 250000;
        if (heights[DANGER_CELL_X] >= DANGER_CELL_Y - 1) penalty += 80000;

        for (let y = Math.max(0, DANGER_CELL_Y - 2); y <= DANGER_CELL_Y; y++) {
            if (boardState[y]?.[DANGER_CELL_X] !== 0) penalty += 25000;
        }

        return penalty;
    }

    function evaluateBoard(boardState) {
        const heights = columnHeights(boardState);
        const holes = countHoles(boardState, heights);
        const maxH = Math.max(...heights);
        const rough = bumpiness(heights);

        let s = 0;
        s += templateScore(boardState) * 20;
        s += seedScore(boardState) * 18;

        const comps = findLooseComponents(boardState);
        for (const comp of comps) {
            const size = comp.cells.length;
            if (size === 2) s += 10;
            else if (size === 3) s += 30 + openNeighborCount(boardState, comp.cells) * 3;
            else if (size >= 5) s += Math.min(80, size * 8);
        }

        s -= holes * 50;
        s -= rough * 12;
        s -= maxH * 30;
        s -= dangerPenalty(boardState);

        if (maxH >= BOARD_H - 3) s -= 120;
        if (maxH >= BOARD_H - 2) s -= 260;

        const counts = [0, 0, 0, 0, 0];
        for (let y = 0; y < BOARD_H; y++) {
            for (let x = 0; x < BOARD_W; x++) {
                const v = boardState[y][x];
                if (v >= 1 && v <= 4) counts[v]++;
            }
        }
        const sorted = counts.slice(1).sort((a, b) => b - a);
        s += (sorted[0] + sorted[1]) * 0.6;
        s -= (sorted[2] + sorted[3]) * 0.8;

        return s;
    }

    function chainOutcomeValue(sim) {
        const chainPart = Math.pow(sim.chains, 2.1) * 35000;
        const scorePart = sim.score * 8;
        const attackPart = sim.attack * 1800;
        const allClearPart = sim.allClear ? 250000 : 0;
        return chainPart + scorePart + attackPart + allClearPart;
    }

    function simulatePlacement(boardState, piece, placement) {
        const placed = placePiece(boardState, piece, placement);
        return resolveBoard(placed);
    }

    function searchBest(boardState, pieces, depth, rootMove, memo) {
        const key = `${depth}|${boardToKey(boardState)}|${pieces.map((p) => `${p.mainColor}${p.subColor}`).join(',')}`;
        if (memo.has(key)) return memo.get(key);

        if (depth >= pieces.length) {
            const ret = { score: evaluateBoard(boardState), move: rootMove };
            memo.set(key, ret);
            return ret;
        }

        const piece = pieces[depth];
        const allPlacements = placements(boardState, piece);
        if (!allPlacements.length) {
            const ret = { score: -1e15, move: rootMove };
            memo.set(key, ret);
            return ret;
        }

        const candidates = allPlacements.map((p) => {
            const sim = simulatePlacement(boardState, piece, p);
            const quick = evaluateBoard(sim.board) + chainOutcomeValue(sim) * 0.01;
            return { ...p, sim, quick };
        }).sort((a, b) => b.quick - a.quick).slice(0, AI_CONFIG.BEAM_WIDTH);

        let best = { score: -1e15, move: rootMove };

        for (const c of candidates) {
            const nextRoot = depth === 0 ? { x: c.x, y: c.y, rotation: c.rotation } : rootMove;
            let total = c.sim.chains > 0
                ? chainOutcomeValue(c.sim) + evaluateBoard(c.sim.board) * 0.15
                : evaluateBoard(c.sim.board) * 0.35;

            if (depth + 1 < pieces.length) {
                const child = searchBest(c.sim.board, pieces, depth + 1, nextRoot, memo);
                total += child.score * 0.85;
            } else {
                total += evaluateBoard(c.sim.board) * 0.25;
            }

            if (total > best.score) {
                best = { score: total, move: nextRoot };
            }
        }

        memo.set(key, best);
        return best;
    }

    function chooseBestMoveFallback() {
        const cur = safeCurrentPuyo();
        const b = safeBoard();
        if (!cur || !b) return null;
        if (typeof gameState !== 'undefined' && gameState !== 'playing') return null;

        const q = safeQueue();
        const idx = safeQueueIndex();
        const pieces = [
            { mainColor: cur.mainColor || 0, subColor: cur.subColor || 0 }
        ];

        const p1 = pieceFromPair(q[idx]);
        const p2 = pieceFromPair(q[idx + 1]);
        if (p1) pieces.push(p1);
        if (p2) pieces.push(p2);

        const memo = new Map();
        const snapshot = cloneBoard(b);
        const result = searchBest(snapshot, pieces, 0, null, memo);
        return result.move;
    }

    function applyMove(move) {
        const cur = safeCurrentPuyo();
        const b = safeBoard();
        if (!cur || !move || !b) return false;

        const test = {
            mainX: move.x,
            mainY: move.y,
            rotation: move.rotation,
            mainColor: cur.mainColor,
            subColor: cur.subColor
        };
        const coords = getCoordsFromState(test);
        if (checkCollisionLocal(coords, b)) return false;

        cur.mainX = move.x;
        cur.mainY = move.y;
        cur.rotation = move.rotation;

        if (typeof renderBoard === 'function') renderBoard();
        return true;
    }

    function terminateWorker() {
        if (worker) {
            try { worker.terminate(); } catch (_) {}
        }
        worker = null;
    }

    function clearPendingJob(reason) {
        if (!pendingJob) return;
        if (pendingJob.timer) clearTimeout(pendingJob.timer);
        const job = pendingJob;
        pendingJob = null;
        if (reason instanceof Error) {
            job.reject(reason);
        } else if (reason) {
            job.reject(new Error(String(reason)));
        }
    }

    function ensureWorker() {
        if (worker) return worker;

        try {
            worker = new Worker('./puyo-ai-worker.js', { type: 'module' });

            worker.onmessage = (event) => {
                const data = event.data || {};
                if (data.type === 'ready') return;
                if (!pendingJob) return;

                if (pendingJob.timer) clearTimeout(pendingJob.timer);
                const job = pendingJob;
                pendingJob = null;

                if (data.type === 'result') {
                    job.resolve(data.move || null);
                } else {
                    job.reject(new Error(data.message || 'AI worker error'));
                }
            };

            worker.onerror = (err) => {
                console.error('AI worker error:', err);
                clearPendingJob(err instanceof Error ? err : new Error('AI worker error'));
                terminateWorker();
                setStatus('AIエラー');
            };

            worker.onmessageerror = (err) => {
                console.error('AI worker message error:', err);
                clearPendingJob(new Error('AI worker message error'));
                terminateWorker();
                setStatus('AIエラー');
            };
        } catch (err) {
            console.error('Failed to create AI worker:', err);
            terminateWorker();
        }

        return worker;
    }

    function requestMoveFromWorker(timeoutMs = AI_CONFIG.WORKER_TIMEOUT_MS) {
        return new Promise((resolve, reject) => {
            if (typeof gameState !== 'undefined' && gameState !== 'playing') {
                reject(new Error('not playing'));
                return;
            }

            const w = ensureWorker();
            const b = getBoardFlat();
            const pieces = getPiecePayload();

            if (!w) {
                reject(new Error('worker unavailable'));
                return;
            }
            if (!b || !pieces) {
                reject(new Error('snapshot unavailable'));
                return;
            }

            const timer = setTimeout(() => {
                if (pendingJob) pendingJob = null;
                terminateWorker();
                reject(new Error('worker timeout'));
            }, timeoutMs);

            pendingJob = { resolve, reject, timer };

            try {
                w.postMessage(
                    { type: 'solve', board: b, pieces },
                    [b.buffer, pieces.buffer]
                );
            } catch (err) {
                clearTimeout(timer);
                pendingJob = null;
                reject(err);
            }
        });
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
            let move = null;

            try {
                move = await requestMoveFromWorker();
            } catch (err) {
                console.warn('Falling back to JS AI:', err);
                move = chooseBestMoveFallback();
            }

            if (!move) {
                setStatus('手なし');
                return;
            }

            if (!applyMove(move)) {
                const fallbackMove = chooseBestMoveFallback();
                if (!fallbackMove || !applyMove(fallbackMove)) {
                    setStatus('手なし');
                    return;
                }
            }

            if (typeof hardDrop === 'function') {
                hardDrop();
            }

            setStatus('AI実行完了');
        } catch (err) {
            console.error('AI error:', err);
            setStatus('AIエラー');
        } finally {
            busy = false;
        }
    }

    function tickAuto() {
        if (!autoEnabled || busy) return;
        if (typeof gameState !== 'undefined' && gameState !== 'playing') {
            setStatus('AI待機中');
            return;
        }
        if (!safeCurrentPuyo()) {
            setStatus('AI待機中');
            return;
        }
        runOnce();
    }

    function startAutoLoop() {
        stopAutoLoop();
        autoTimer = setInterval(tickAuto, AI_CONFIG.AUTO_TICK_MS);
    }

    function stopAutoLoop() {
        if (autoTimer) {
            clearInterval(autoTimer);
            autoTimer = null;
        }
    }

    function boot() {
        if (booted) return;
        booted = true;
        updateAutoButton();
        setStatus('AI待機中');
        ensureWorker();
    }

    window.runPuyoAI = function () {
        runOnce();
    };

    window.toggleAIAuto = function () {
        autoEnabled = !autoEnabled;
        updateAutoButton();

        if (autoEnabled) {
            setStatus('AI自動起動');
            startAutoLoop();
            runOnce();
        } else {
            stopAutoLoop();
            setStatus('AI待機中');
        }
    };

    window.PuyoAI = {
        chooseBestMove: chooseBestMoveFallback,
        evaluateBoard,
        resolveBoard,
        requestMoveFromWorker,
        runOnce
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();