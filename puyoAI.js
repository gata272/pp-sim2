/* puyoAI.js
 * Robust long-chain AI for Puyo Puyo Simulator
 * - Current + NEXT1 + NEXT2
 * - Uses module worker + wasm when available
 * - Falls back to pure JS search when worker/wasm fails
 * - Avoids the load-time HIDDEN_ROWS self-reference bug
 */
(function () {
    'use strict';

    // ---------- Config ----------
    const AI_CONFIG = {
        AUTO_TICK_MS: 120,
        SEARCH_BEAM_WIDTH: 12,
        LEAF_BEAM_WIDTH: 6,
        SEARCH_DEPTH: 3,        // current + NEXT1 + NEXT2
        PSEUDO_EXTENSION: 1,
        WORKER_TIMEOUT_MS: 12000,
        DANGER_X: 2,
        DANGER_Y: 11,
        PSEUDO_DELAY_MS: 0
    };

    const BOARD_W = typeof WIDTH !== 'undefined' ? WIDTH : 6;
    const BOARD_H = typeof HEIGHT !== 'undefined' ? HEIGHT : 14;
    const HIDDEN_ROWS = 2; // fixed in puyoSim.js, do not self-reference here

    const C = typeof COLORS !== 'undefined'
        ? COLORS
        : { EMPTY: 0, RED: 1, BLUE: 2, GREEN: 3, YELLOW: 4, GARBAGE: 5 };

    const BONUS_TABLE = typeof window.BONUS_TABLE !== 'undefined'
        ? window.BONUS_TABLE
        : {
            CHAIN: [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512],
            GROUP: [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            COLOR: [0, 0, 3, 6, 12]
        };

    // ---------- State ----------
    let autoEnabled = false;
    let autoTimer = null;
    let busy = false;
    let uiInitialized = false;

    // Worker / wasm acceleration
    let worker = null;
    let workerReady = false;
    let workerInitAttempted = false;
    let pendingResolve = null;
    let pendingReject = null;
    let workerTimeout = null;

    // ---------- Helpers ----------
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

    function boardKey(src) {
        return src.map(row => row.join('')).join('|');
    }

    function getPieceList() {
        const cur = safeCurrentPuyo();
        if (!cur) return [];

        const q = safeQueue();
        const idx = safeQueueIndex();

        const pieces = [
            { mainColor: cur.mainColor | 0, subColor: cur.subColor | 0 }
        ];

        const p1 = q[idx];
        const p2 = q[idx + 1];

        if (Array.isArray(p1) && p1.length >= 2) {
            pieces.push({ mainColor: p1[1] | 0, subColor: p1[0] | 0 });
        }
        if (Array.isArray(p2) && p2.length >= 2) {
            pieces.push({ mainColor: p2[1] | 0, subColor: p2[0] | 0 });
        }

        return pieces;
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
            if (c.x < 0 || c.x >= BOARD_W) return false;
            if (c.y < 0 || c.y >= BOARD_H) return false;

            // Hidden rows do not block movement in the simulator.
            if (c.y < BOARD_H - HIDDEN_ROWS && boardState[c.y][c.x] !== C.EMPTY) return false;
        }
        return true;
    }

    function dropY(boardState, piece, x, rotation) {
        let y = BOARD_H - 2;
        if (!canPlace(boardState, piece, x, y, rotation)) return null;

        while (y > 0 && canPlace(boardState, piece, x, y - 1, rotation)) {
            y--;
        }
        return y;
    }

    function generatePlacements(boardState, piece) {
        const placements = [];
        for (let rot = 0; rot < 4; rot++) {
            for (let x = 0; x < BOARD_W; x++) {
                const y = dropY(boardState, piece, x, rot);
                if (y !== null && y !== undefined) {
                    placements.push({ x, y, rotation: rot });
                }
            }
        }
        return placements;
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

    function gravity(src) {
        for (let x = 0; x < BOARD_W; x++) {
            const col = [];
            for (let y = 0; y < BOARD_H; y++) {
                if (src[y][x] !== C.EMPTY) col.push(src[y][x]);
            }
            for (let y = 0; y < BOARD_H; y++) {
                src[y][x] = y < col.length ? col[y] : C.EMPTY;
            }
        }
    }

    function findGroups(boardState) {
        const visited = Array.from({ length: BOARD_H }, () => Array(BOARD_W).fill(false));
        const groups = [];

        for (let y = 0; y < BOARD_H; y++) {
            for (let x = 0; x < BOARD_W; x++) {
                const color = boardState[y][x];
                if (color === C.EMPTY || color === C.GARBAGE || visited[y][x]) continue;

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

    function groupBonus(size) {
        return BONUS_TABLE.GROUP[Math.min(size, BONUS_TABLE.GROUP.length - 1)] || 0;
    }

    function chainBonus(chainNo) {
        const idx = Math.max(0, Math.min(chainNo - 1, BONUS_TABLE.CHAIN.length - 1));
        return BONUS_TABLE.CHAIN[idx] || 0;
    }

    function colorBonus(colorCount) {
        return BONUS_TABLE.COLOR[Math.min(colorCount, BONUS_TABLE.COLOR.length - 1)] || 0;
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
                    next[p.y][p.x] = C.EMPTY;
                    erased.push(p);
                }
            }
            clearGarbageNeighbors(next, erased);
        }

        gravity(next);

        let allClear = true;
        for (let y = 0; y < BOARD_H; y++) {
            for (let x = 0; x < BOARD_W; x++) {
                if (next[y][x] !== C.EMPTY) {
                    allClear = false;
                    break;
                }
            }
            if (!allClear) break;
        }

        if (allClear) {
            const ac = typeof ALL_CLEAR_SCORE_BONUS !== 'undefined' ? ALL_CLEAR_SCORE_BONUS : 2100;
            score += ac;
            attack += Math.floor(Math.max(0, ac) / 70);
        }

        return { board: next, chains, score, attack, allClear };
    }

    function columnHeights(boardState) {
        const heights = Array(BOARD_W).fill(0);
        for (let x = 0; x < BOARD_W; x++) {
            for (let y = BOARD_H - 1; y >= 0; y--) {
                if (boardState[y][x] !== C.EMPTY) {
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
                if (boardState[y][x] === C.EMPTY) holes++;
            }
        }
        return holes;
    }

    function openNeighborCount(boardState, cells) {
        const seen = new Set();
        let count = 0;

        for (const { x, y } of cells) {
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dx, dy] of dirs) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < BOARD_W && ny >= 0 && ny < BOARD_H && boardState[ny][nx] === C.EMPTY) {
                    const k = `${nx},${ny}`;
                    if (!seen.has(k)) {
                        seen.add(k);
                        count++;
                    }
                }
            }
        }

        return count;
    }

    function findGroupsLoose(boardState) {
        const visited = Array.from({ length: BOARD_H }, () => Array(BOARD_W).fill(false));
        const out = [];

        for (let y = 0; y < BOARD_H; y++) {
            for (let x = 0; x < BOARD_W; x++) {
                const color = boardState[y][x];
                if (color === C.EMPTY || color === C.GARBAGE || visited[y][x]) continue;

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

    function dangerPenalty(boardState) {
        const x = AI_CONFIG.DANGER_X;
        const y = AI_CONFIG.DANGER_Y;
        let penalty = 0;

        if (boardState[y]?.[x] !== C.EMPTY) penalty += 1000000;

        const heights = columnHeights(boardState);
        if (heights[x] >= y + 1) penalty += 250000;
        if (heights[x] >= y - 1) penalty += 80000;

        for (let yy = Math.max(0, y - 2); yy <= y; yy++) {
            if (boardState[yy]?.[x] !== C.EMPTY) penalty += 25000;
        }

        return penalty;
    }

    function templateScore(boardState) {
        const heights = columnHeights(boardState);
        const templates = [
            { mask: [1, 1, 1, 1, 1, 1], profile: [0, 1, 2, 2, 1, 0], weight: 1.30 },
            { mask: [1, 1, 1, 1, 1, 1], profile: [0, 1, 2, 3, 2, 1], weight: 1.10 },
            { mask: [1, 1, 1, 1, 1, 1], profile: [1, 2, 1, 1, 2, 1], weight: 0.95 },
            { mask: [1, 1, 1, 1, 1, 1], profile: [2, 1, 0, 0, 1, 2], weight: 1.00 },
            { mask: [1, 1, 1, 1, 0, 0], profile: [0, 1, 2, 3, 0, 0], weight: 0.90 },
            { mask: [0, 0, 1, 1, 1, 1], profile: [0, 0, 3, 2, 1, 0], weight: 0.90 }
        ];

        let best = 0;

        for (const t of templates) {
            const cols = [];
            for (let x = 0; x < BOARD_W; x++) {
                if (t.mask[x]) cols.push(x);
            }
            if (!cols.length) continue;

            let base = Infinity;
            for (const x of cols) {
                base = Math.min(base, heights[x] - t.profile[x]);
            }
            if (!Number.isFinite(base)) continue;

            let s = 0;
            let occupied = 0;

            for (const x of cols) {
                const target = base + t.profile[x];
                const diff = Math.abs(heights[x] - target);
                s += Math.max(0, 10 - diff * 3);
                if (heights[x] > 0) occupied++;
            }

            s += occupied * 2;
            s *= t.weight;
            if (s > best) best = s;
        }

        return best;
    }

    function seedPotential(boardState) {
        const comps = findGroupsLoose(boardState);
        let s = 0;

        for (const g of comps) {
            const size = g.cells.length;
            const open = openNeighborCount(boardState, g.cells);

            if (size === 1) {
                s += 1;
            } else if (size === 2) {
                s += 20 + open * 2;
            } else if (size === 3) {
                s += 60 + open * 4;
            } else if (size >= 5) {
                s += Math.min(120, size * 10);
            }
        }

        for (let y = 0; y < BOARD_H; y++) {
            for (let x = 0; x < BOARD_W; x++) {
                const c = boardState[y][x];
                if (c === C.EMPTY || c === C.GARBAGE) continue;

                if (x + 2 < BOARD_W && boardState[y][x + 1] === c && boardState[y][x + 2] === c) {
                    if ((x - 1 >= 0 && boardState[y][x - 1] === C.EMPTY) || (x + 3 < BOARD_W && boardState[y][x + 3] === C.EMPTY)) {
                        s += 18;
                    }
                }

                if (y + 2 < BOARD_H && boardState[y + 1][x] === c && boardState[y + 2][x] === c) {
                    if ((y - 1 >= 0 && boardState[y - 1][x] === C.EMPTY) || (y + 3 < BOARD_H && boardState[y + 3][x] === C.EMPTY)) {
                        s += 18;
                    }
                }

                if (x + 1 < BOARD_W && y + 1 < BOARD_H) {
                    if (boardState[y][x] === c && boardState[y][x + 1] === c && boardState[y + 1][x] === c) {
                        s += 22;
                    }
                }
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
        score += seedPotential(boardState) * 16;
        score += templateScore(boardState) * 20;

        const centerCols = [1, 2, 3, 4];
        let trigger = 0;
        for (const x of centerCols) {
            const h = heights[x];
            trigger += Math.max(0, 8 - Math.abs(h - 5)) * 3;
        }
        score += trigger * 8;

        score -= holes * 44;
        score -= bumpiness * 12;
        score -= maxH * 34;
        score -= dangerPenalty(boardState);

        if (maxH >= BOARD_H - 3) score -= 150;
        if (maxH >= BOARD_H - 2) score -= 320;

        const counts = [0, 0, 0, 0, 0];
        for (let y = 0; y < BOARD_H; y++) {
            for (let x = 0; x < BOARD_W; x++) {
                const v = boardState[y][x];
                if (v >= 1 && v <= 4) counts[v]++;
            }
        }
        const sorted = counts.slice(1).sort((a, b) => b - a);
        score += (sorted[0] + sorted[1]) * 0.5;
        score -= (sorted[2] + sorted[3]) * 0.9;

        return score;
    }

    function chainOutcomeValue(sim) {
        const chainPart = Math.pow(sim.chains, 2.35) * 65000;
        const scorePart = sim.score * 7;
        const attackPart = sim.attack * 2000;
        const allClearPart = sim.allClear ? 200000 : 0;
        return chainPart + scorePart + attackPart + allClearPart;
    }

    function quiescenceScore(boardState, remainingPieces) {
        let best = evaluateBoard(boardState);
        if (!remainingPieces.length) return best;

        const piece = remainingPieces[0];
        const placements = generatePlacements(boardState, piece)
            .map(p => {
                const placed = placePiece(boardState, piece, p.x, p.y, p.rotation);
                const sim = resolveBoard(placed);
                return { p, sim };
            })
            .sort((a, b) => {
                const va = (a.sim.chains > 0 ? chainOutcomeValue(a.sim) : evaluateBoard(a.sim.board));
                const vb = (b.sim.chains > 0 ? chainOutcomeValue(b.sim) : evaluateBoard(b.sim.board));
                return vb - va;
            })
            .slice(0, AI_CONFIG.LEAF_BEAM_WIDTH);

        for (const node of placements) {
            const value = node.sim.chains > 0
                ? chainOutcomeValue(node.sim) + evaluateBoard(node.sim.board) * 0.15
                : evaluateBoard(node.sim.board) + seedPotential(node.sim.board) * 4;

            if (value > best) best = value;
        }

        return best;
    }

    function searchBest(boardState, pieces, depth, rootMove, memo) {
        const key = `${depth}|${boardKey(boardState)}|${pieces.map(p => `${p.mainColor},${p.subColor}`).join('|')}`;
        if (memo.has(key)) return memo.get(key);

        if (depth >= pieces.length) {
            const score = quiescenceScore(boardState, pieces.slice(depth));
            const ret = { score, move: rootMove || null };
            memo.set(key, ret);
            return ret;
        }

        const piece = pieces[depth];
        const placements = generatePlacements(boardState, piece);

        if (!placements.length) {
            const ret = { score: -1e15, move: rootMove || null };
            memo.set(key, ret);
            return ret;
        }

        const candidates = [];
        for (const p of placements) {
            const placed = placePiece(boardState, piece, p.x, p.y, p.rotation);
            const sim = resolveBoard(placed);

            const quick = sim.chains > 0
                ? chainOutcomeValue(sim)
                : evaluateBoard(sim.board) + seedPotential(sim.board) * 3;

            candidates.push({ ...p, sim, quick });
        }

        candidates.sort((a, b) => b.quick - a.quick);
        const beam = candidates.slice(0, AI_CONFIG.SEARCH_BEAM_WIDTH);

        let best = { score: -1e15, move: rootMove || null };

        for (const c of beam) {
            const nextMove = depth === 0 ? { x: c.x, y: c.y, rotation: c.rotation } : rootMove;

            let total;
            if (c.sim.chains > 0) {
                total = chainOutcomeValue(c.sim) + evaluateBoard(c.sim.board) * 0.12;
                if (depth + 1 < pieces.length) {
                    const child = searchBest(c.sim.board, pieces, depth + 1, nextMove, memo);
                    total += child.score * 0.35;
                }
            } else {
                const local = evaluateBoard(c.sim.board);
                const child = (depth + 1 < pieces.length)
                    ? searchBest(c.sim.board, pieces, depth + 1, nextMove, memo)
                    : { score: quiescenceScore(c.sim.board, pieces.slice(depth + 1)) };

                total = local * 2.0 + child.score * 1.2 + seedPotential(c.sim.board) * 8;
            }

            if (total > best.score) {
                best = { score: total, move: nextMove };
            }
        }

        memo.set(key, best);
        return best;
    }

    function localChooseBestMove() {
        const cur = safeCurrentPuyo();
        const b = safeBoard();
        if (!cur || !b) return null;
        if (typeof gameState !== 'undefined' && gameState !== 'playing') return null;

        const pieces = getPieceList();
        if (!pieces.length) return null;

        const memo = new Map();
        const snapshot = cloneBoard(b);
        const result = searchBest(snapshot, pieces, 0, null, memo);
        return result.move;
    }

    function applyMove(move) {
        const cur = safeCurrentPuyo();
        const b = safeBoard();
        if (!cur || !move || !b) return false;

        const piece = { mainColor: cur.mainColor, subColor: cur.subColor };
        if (!canPlace(b, piece, move.x, move.y, move.rotation)) return false;

        cur.mainX = move.x;
        cur.mainY = move.y;
        cur.rotation = move.rotation;

        if (typeof renderBoard === 'function') renderBoard();
        return true;
    }

    function hardDropCurrent() {
        if (typeof hardDrop === 'function') {
            hardDrop();
        } else if (typeof lockPuyo === 'function') {
            lockPuyo();
        }
    }

    // ---------- Worker acceleration ----------
    function ensureWorker() {
        if (worker) return worker;
        if (workerInitAttempted) return null;
        workerInitAttempted = true;

        try {
            worker = new Worker('./puyo-ai-worker.js', { type: 'module' });
            worker.onmessage = (event) => {
                const data = event.data;
                if (!data) return;

                if (data.type === 'result') {
                    workerReady = true;
                    if (workerTimeout) {
                        clearTimeout(workerTimeout);
                        workerTimeout = null;
                    }
                    if (pendingResolve) {
                        pendingResolve(data.move || null);
                        pendingResolve = null;
                        pendingReject = null;
                    }
                } else if (data.type === 'error') {
                    if (workerTimeout) {
                        clearTimeout(workerTimeout);
                        workerTimeout = null;
                    }
                    if (pendingReject) {
                        pendingReject(new Error(data.message || 'AI worker error'));
                        pendingResolve = null;
                        pendingReject = null;
                    } else {
                        setStatus('AIエラー');
                        console.error(data.message);
                    }
                }
            };

            worker.onerror = (err) => {
                console.error('AI worker error:', err);
                workerReady = false;
                if (workerTimeout) {
                    clearTimeout(workerTimeout);
                    workerTimeout = null;
                }
                if (pendingReject) {
                    pendingReject(err);
                    pendingResolve = null;
                    pendingReject = null;
                } else {
                    setStatus('AIエラー');
                }
            };

            return worker;
        } catch (err) {
            console.warn('Worker unavailable, falling back to local solver:', err);
            worker = null;
            workerReady = false;
            return null;
        }
    }

    function requestWorkerMove() {
        return new Promise((resolve, reject) => {
            const cur = safeCurrentPuyo();
            const b = safeBoard();
            if (!cur || !b) {
                reject(new Error('snapshot unavailable'));
                return;
            }

            const w = ensureWorker();
            if (!w) {
                reject(new Error('worker unavailable'));
                return;
            }

            const pieces = getPieceList();
            if (pieces.length < 1) {
                reject(new Error('no pieces'));
                return;
            }

            const flatBoard = new Int32Array(BOARD_W * BOARD_H);
            for (let y = 0; y < BOARD_H; y++) {
                for (let x = 0; x < BOARD_W; x++) {
                    flatBoard[y * BOARD_W + x] = b[y]?.[x] ?? C.EMPTY;
                }
            }

            const flatPieces = new Int32Array([
                cur.subColor || 0,
                cur.mainColor || 0,
                pieces[1]?.subColor || 0,
                pieces[1]?.mainColor || 0,
                pieces[2]?.subColor || 0,
                pieces[2]?.mainColor || 0
            ]);

            pendingResolve = resolve;
            pendingReject = reject;

            workerTimeout = setTimeout(() => {
                workerTimeout = null;
                if (pendingReject) {
                    pendingReject(new Error('worker timeout'));
                    pendingResolve = null;
                    pendingReject = null;
                }
            }, AI_CONFIG.WORKER_TIMEOUT_MS);

            worker.postMessage(
                { type: 'solve', board: flatBoard, pieces: flatPieces },
                [flatBoard.buffer, flatPieces.buffer]
            );
        });
    }

    async function chooseBestMove() {
        try {
            const move = await requestWorkerMove();
            if (move && Number.isFinite(move.x) && Number.isFinite(move.y) && Number.isFinite(move.rotation)) {
                return move;
            }
        } catch (err) {
            // fall back to JS solver
            console.warn('Worker solve failed, using local solver:', err);
        }
        return localChooseBestMove();
    }

    // ---------- Main action ----------
    async function runOnce() {
        if (busy) return;

        if (typeof gameState !== 'undefined' && gameState !== 'playing') {
            setStatus('AI待機中');
            return;
        }

        const cur = safeCurrentPuyo();
        if (!cur) {
            setStatus('AI待機中');
            return;
        }

        busy = true;
        setStatus('AI思考中...');

        try {
            const move = await chooseBestMove();
            if (!move) {
                setStatus('手なし');
                return;
            }

            if (!applyMove(move)) {
                // fallback once with local solver if worker returned a bad move
                const fallback = localChooseBestMove();
                if (!fallback || !applyMove(fallback)) {
                    setStatus('AIエラー');
                    return;
                }
            }

            if (AI_CONFIG.PSEUDO_DELAY_MS > 0) {
                await new Promise(r => setTimeout(r, AI_CONFIG.PSEUDO_DELAY_MS));
            }

            hardDropCurrent();
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

    function initAIUI() {
        if (uiInitialized) return;
        uiInitialized = true;
        updateAutoButton();
        setStatus('AI待機中');
    }

    // ---------- Public API ----------
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
        chooseBestMove,
        localChooseBestMove,
        evaluateBoard,
        resolveBoard,
        searchBest,
        quiescenceScore,
        chainOutcomeValue,
        seedPotential,
        templateScore
    };

    function boot() {
        initAIUI();
        if (autoEnabled) startAutoLoop();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();