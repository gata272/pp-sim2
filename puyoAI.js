/* puyoAI.js
 * Worker-based long-chain AI for Puyo Puyo Simulator
 * - current piece + NEXT1 + NEXT2
 * - off-main-thread search for responsiveness
 * - long-chain oriented evaluation
 * - no HTML changes required
 */
(function () {
    'use strict';

    const AI_CONFIG = {
        AUTO_TICK_MS: 140,
        THINK_TIMEOUT_MS: 15000,
        SEARCH_BEAM_WIDTH: 14,
        LEAF_BEAM_WIDTH: 5,
        PSEUDO_EXTENSION_DEPTH: 2,
        PSEUDO_BRANCH_LIMIT: 5,
        DANGER_X: 2,
        DANGER_Y: 11
    };

    let autoEnabled = false;
    let autoTimer = null;
    let busy = false;
    let uiInitialized = false;

    let worker = null;
    let workerReady = false;
    let requestSeq = 0;
    let activeRequestId = 0;
    let activeRequestToken = null;
    let pendingResolve = null;
    let pendingReject = null;
    let requestTimeoutTimer = null;

    const W = typeof WIDTH !== 'undefined' ? WIDTH : 6;
    const H = typeof HEIGHT !== 'undefined' ? HEIGHT : 14;

    function getColors() {
        return typeof COLORS !== 'undefined'
            ? COLORS
            : { EMPTY: 0, RED: 1, BLUE: 2, GREEN: 3, YELLOW: 4, GARBAGE: 5 };
    }

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

    function makeWorker() {
        if (typeof Worker === 'undefined') return null;

        const workerMain = function () {
            'use strict';

            const AI_CONFIG = {
                SEARCH_BEAM_WIDTH: 14,
                LEAF_BEAM_WIDTH: 5,
                PSEUDO_EXTENSION_DEPTH: 2,
                PSEUDO_BRANCH_LIMIT: 5,
                DANGER_X: 2,
                DANGER_Y: 11
            };

            function getColors() {
                return { EMPTY: 0, RED: 1, BLUE: 2, GREEN: 3, YELLOW: 4, GARBAGE: 5 };
            }

            const C = getColors();
            const BONUS_TABLE = {
                CHAIN: [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512],
                GROUP: [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                COLOR: [0, 0, 3, 6, 12]
            };

            const TEMPLATE_LIBRARY = [
                { mask: [1, 1, 1, 1, 1, 1], profile: [0, 1, 2, 2, 1, 0], weight: 1.30 },
                { mask: [1, 1, 1, 1, 1, 1], profile: [0, 1, 2, 3, 2, 1], weight: 1.15 },
                { mask: [1, 1, 1, 1, 1, 1], profile: [1, 2, 1, 1, 2, 1], weight: 1.00 },
                { mask: [1, 1, 1, 1, 1, 1], profile: [2, 1, 0, 0, 1, 2], weight: 1.08 },
                { mask: [1, 1, 1, 1, 0, 0], profile: [0, 1, 2, 3, 0, 0], weight: 0.92 },
                { mask: [0, 0, 1, 1, 1, 1], profile: [0, 0, 3, 2, 1, 0], weight: 0.92 }
            ];

            function cloneBoard(src) {
                return src.map(row => row.slice());
            }

            function boardKey(src) {
                return src.map(row => row.join('')).join('|');
            }

            function getScoreToOjamaFn() {
                return (v) => Math.floor(Math.max(0, v) / 70);
            }

            function getAllClearBonus(snapshot) {
                return snapshot.allClearBonus || 2100;
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
                    if (c.x < 0 || c.x >= 6 || c.y < 0 || c.y >= 14) return false;
                    if (c.y < 12 && boardState[c.y][c.x] !== C.EMPTY) return false;
                }
                return true;
            }

            function findRestY(boardState, piece, x, rotation) {
                let y = 13;
                if (!canPlace(boardState, piece, x, y, rotation)) return null;
                while (y > 0 && canPlace(boardState, piece, x, y - 1, rotation)) {
                    y--;
                }
                return y;
            }

            function generatePlacements(boardState, piece) {
                const placements = [];
                for (let rot = 0; rot < 4; rot++) {
                    for (let x = 0; x < 6; x++) {
                        const y = findRestY(boardState, piece, x, rot);
                        if (y !== null) placements.push({ x, y, rotation: rot });
                    }
                }
                return placements;
            }

            function placePiece(boardState, piece, x, y, rotation) {
                const next = cloneBoard(boardState);
                const coords = coordsFromState(piece, x, y, rotation);
                for (const c of coords) {
                    if (c.x >= 0 && c.x < 6 && c.y >= 0 && c.y < 14) {
                        next[c.y][c.x] = c.color;
                    }
                }
                return next;
            }

            function gravityOn(boardState) {
                for (let x = 0; x < 6; x++) {
                    const col = [];
                    for (let y = 0; y < 14; y++) {
                        if (boardState[y][x] !== C.EMPTY) col.push(boardState[y][x]);
                    }
                    for (let y = 0; y < 14; y++) {
                        boardState[y][x] = y < col.length ? col[y] : C.EMPTY;
                    }
                }
            }

            function findGroups(boardState) {
                const visited = Array.from({ length: 14 }, () => Array(6).fill(false));
                const groups = [];

                for (let y = 0; y < 14; y++) {
                    for (let x = 0; x < 6; x++) {
                        const color = boardState[y][x];
                        if (color === C.EMPTY || color === C.GARBAGE || visited[y][x]) continue;

                        const stack = [{ x, y }];
                        visited[y][x] = true;
                        const group = [];

                        while (stack.length) {
                            const cur = stack.pop();
                            group.push(cur);

                            const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
                            for (const [dx, dy] of dirs) {
                                const nx = cur.x + dx;
                                const ny = cur.y + dy;
                                if (nx >= 0 && nx < 6 && ny >= 0 && ny < 14 &&
                                    !visited[ny][nx] && boardState[ny][nx] === color) {
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
                    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
                    for (const [dx, dy] of dirs) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < 6 && ny >= 0 && ny < 14) {
                            if (boardState[ny][nx] === C.GARBAGE) toClear.add(`${nx},${ny}`);
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

                if (bonusTotal <= 0) bonusTotal = 1;
                return (10 * totalPuyos) * bonusTotal;
            }

            function isBoardEmpty(boardState) {
                for (let y = 0; y < 14; y++) {
                    for (let x = 0; x < 6; x++) {
                        if (boardState[y][x] !== C.EMPTY) return false;
                    }
                }
                return true;
            }

            function resolveBoard(boardState) {
                const next = cloneBoard(boardState);
                let chains = 0;
                let scoreSum = 0;
                let attack = 0;

                while (true) {
                    gravityOn(next);
                    const groups = findGroups(next);
                    if (groups.length === 0) break;

                    chains++;
                    const chainScore = calculateScore(groups, chains);
                    scoreSum += chainScore;
                    attack += getScoreToOjamaFn()(chainScore);

                    const erased = [];
                    for (const { group } of groups) {
                        for (const p of group) {
                            next[p.y][p.x] = C.EMPTY;
                            erased.push(p);
                        }
                    }
                    clearGarbageNeighbors(next, erased);
                }

                gravityOn(next);

                const allClear = isBoardEmpty(next);
                if (allClear) {
                    const ac = getAllClearBonus({});
                    scoreSum += ac;
                    attack += getScoreToOjamaFn()(ac);
                }

                return { board: next, chains, score: scoreSum, attack, allClear };
            }

            function columnHeights(boardState) {
                const heights = Array(6).fill(0);
                for (let x = 0; x < 6; x++) {
                    for (let y = 13; y >= 0; y--) {
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
                for (let x = 0; x < 6; x++) {
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
                    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
                    for (const [dx, dy] of dirs) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < 6 && ny >= 0 && ny < 14 && boardState[ny][nx] === C.EMPTY) {
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

            function findGroupsLoose(boardState) {
                const visited = Array.from({ length: 14 }, () => Array(6).fill(false));
                const out = [];

                for (let y = 0; y < 14; y++) {
                    for (let x = 0; x < 6; x++) {
                        const color = boardState[y][x];
                        if (color === C.EMPTY || color === C.GARBAGE || visited[y][x]) continue;

                        const stack = [{ x, y }];
                        visited[y][x] = true;
                        const cells = [];

                        while (stack.length) {
                            const cur = stack.pop();
                            cells.push(cur);

                            const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
                            for (const [dx, dy] of dirs) {
                                const nx = cur.x + dx;
                                const ny = cur.y + dy;
                                if (nx >= 0 && nx < 6 && ny >= 0 && ny < 14 &&
                                    !visited[ny][nx] && boardState[ny][nx] === color) {
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
                if (!boardState[y]) return 0;

                if (boardState[y][x] !== C.EMPTY) penalty += 1000000;

                const heights = columnHeights(boardState);
                if (heights[x] >= y + 1) penalty += 260000;
                if (heights[x] >= y - 1) penalty += 90000;

                for (let yy = Math.max(0, y - 2); yy <= y; yy++) {
                    if (boardState[yy][x] !== C.EMPTY) penalty += 25000;
                }
                return penalty;
            }

            function templateScore(boardState) {
                const heights = columnHeights(boardState);
                let best1 = 0;
                let best2 = 0;

                for (const t of TEMPLATE_LIBRARY) {
                    const cols = [];
                    for (let x = 0; x < 6; x++) {
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

                    if (s > best1) {
                        best2 = best1;
                        best1 = s;
                    } else if (s > best2) {
                        best2 = s;
                    }
                }

                return best1 + best2 * 0.5;
            }

            function seedPotential(boardState) {
                const comps = findGroupsLoose(boardState);
                let s = 0;

                for (const g of comps) {
                    const size = g.cells.length;
                    const open = openNeighborCount(boardState, g.cells);

                    if (size === 1) s += 1;
                    else if (size === 2) s += 24 + open * 4;
                    else if (size === 3) s += 80 + open * 8;
                    else if (size >= 5) s += Math.min(140, size * 12);
                }

                for (let y = 0; y < 14; y++) {
                    for (let x = 0; x < 6; x++) {
                        const c = boardState[y][x];
                        if (c === C.EMPTY || c === C.GARBAGE) continue;

                        if (x + 2 < 6 && boardState[y][x + 1] === c && boardState[y][x + 2] === c) {
                            if ((x - 1 >= 0 && boardState[y][x - 1] === C.EMPTY) || (x + 3 < 6 && boardState[y][x + 3] === C.EMPTY)) {
                                s += 18;
                            }
                        }

                        if (y + 2 < 14 && boardState[y + 1][x] === c && boardState[y + 2][x] === c) {
                            if ((y - 1 >= 0 && boardState[y - 1][x] === C.EMPTY) || (y + 3 < 14 && boardState[y + 3][x] === C.EMPTY)) {
                                s += 18;
                            }
                        }

                        if (x + 1 < 6 && y + 1 < 14) {
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
                const bumpiness = heights.reduce((sum, h, i) => sum + (i > 0 ? Math.abs(h - heights[i - 1]) : 0), 0);

                let s = 0;

                s += seedPotential(boardState) * 18;
                s += templateScore(boardState) * 22;

                const centerCols = [1, 2, 3, 4];
                let centerBalance = 0;
                for (const x of centerCols) {
                    const h = heights[x];
                    centerBalance += Math.max(0, 7 - Math.abs(h - 5)) * 4;
                }
                s += centerBalance * 6;

                s -= holes * 44;
                s -= bumpiness * 12;
                s -= maxH * 34;
                s -= dangerPenalty(boardState);

                if (maxH >= 11) s -= 150;
                if (maxH >= 12) s -= 320;

                const counts = [0, 0, 0, 0, 0];
                for (let y = 0; y < 14; y++) {
                    for (let x = 0; x < 6; x++) {
                        const v = boardState[y][x];
                        if (v >= 1 && v <= 4) counts[v]++;
                    }
                }
                const sorted = counts.slice(1).sort((a, b) => b - a);
                s += (sorted[0] + sorted[1]) * 0.6;
                s -= (sorted[2] + sorted[3]) * 1.0;

                return s;
            }

            function chainOutcomeValue(sim) {
                const chainPart = Math.pow(sim.chains, 2.25) * 42000;
                const scorePart = sim.score * 2.0;
                const attackPart = sim.attack * 1500;
                const allClearPart = sim.allClear ? 160000 : 0;
                return chainPart + scorePart + attackPart + allClearPart;
            }

            function placementQuickValue(sim) {
                if (sim.chains > 0) {
                    return chainOutcomeValue(sim) * 1.0 + seedPotential(sim.board) * 10 + evaluateBoard(sim.board) * 0.15;
                }
                return evaluateBoard(sim.board) * 1.0 + seedPotential(sim.board) * 18 + templateScore(sim.board) * 8;
            }

            function pseudoForecast(boardState, depth) {
                let best = evaluateBoard(boardState) * 0.6 + seedPotential(boardState) * 8;
                if (depth <= 0) return best;

                const pseudoPieces = [
                    { mainColor: 1, subColor: 1 },
                    { mainColor: 2, subColor: 2 },
                    { mainColor: 3, subColor: 3 },
                    { mainColor: 4, subColor: 4 },
                    { mainColor: 1, subColor: 2 },
                    { mainColor: 2, subColor: 3 },
                    { mainColor: 3, subColor: 4 },
                    { mainColor: 4, subColor: 1 }
                ];

                for (const piece of pseudoPieces) {
                    const placements = generatePlacements(boardState, piece);
                    if (!placements.length) continue;

                    const nodes = [];
                    for (const p of placements) {
                        const sim = simulateMove(boardState, piece, p.x, p.y, p.rotation);
                        nodes.push({ sim, quick: placementQuickValue(sim) });
                    }

                    nodes.sort((a, b) => b.quick - a.quick);
                    const beam = nodes.slice(0, AI_CONFIG.PSEUDO_BRANCH_LIMIT);

                    for (const node of beam) {
                        const future = pseudoForecast(node.sim.board, depth - 1);
                        const value =
                            (node.sim.chains > 0 ? chainOutcomeValue(node.sim) : 0) +
                            evaluateBoard(node.sim.board) * 0.35 +
                            seedPotential(node.sim.board) * 14 +
                            future * 0.75;

                        if (value > best) best = value;
                    }
                }

                return best;
            }

            function leafScore(boardState) {
                return evaluateBoard(boardState) * 1.0 + pseudoForecast(boardState, AI_CONFIG.PSEUDO_EXTENSION_DEPTH);
            }

            function searchBest(boardState, pieces, depth, memo, rootMove) {
                const key = depth + '|' + boardKey(boardState) + '|' + pieces.map(p => p.mainColor + ',' + p.subColor).join('|');
                if (memo.has(key)) return memo.get(key);

                if (depth >= pieces.length) {
                    const score = leafScore(boardState);
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
                    const sim = simulateMove(boardState, piece, p.x, p.y, p.rotation);
                    candidates.push({
                        ...p,
                        sim,
                        quick: placementQuickValue(sim)
                    });
                }

                candidates.sort((a, b) => b.quick - a.quick);
                const beam = candidates.slice(0, AI_CONFIG.SEARCH_BEAM_WIDTH);

                let best = { score: -1e15, move: rootMove || null };

                for (const c of beam) {
                    const nextMove = depth === 0 ? { x: c.x, y: c.y, rotation: c.rotation } : rootMove;

                    let tailScore = 0;
                    if (depth + 1 < pieces.length) {
                        const child = searchBest(c.sim.board, pieces, depth + 1, memo, nextMove);
                        tailScore = child.score;
                    } else {
                        tailScore = leafScore(c.sim.board);
                    }

                    let total;
                    if (c.sim.chains > 0) {
                        total =
                            chainOutcomeValue(c.sim) * 0.80 +
                            seedPotential(c.sim.board) * 22 +
                            templateScore(c.sim.board) * 10 +
                            evaluateBoard(c.sim.board) * 0.10 +
                            tailScore * 0.95;
                    } else {
                        total =
                            evaluateBoard(c.sim.board) * 1.10 +
                            seedPotential(c.sim.board) * 24 +
                            templateScore(c.sim.board) * 12 +
                            tailScore * 1.05;
                    }

                    if (total > best.score) {
                        best = { score: total, move: nextMove };
                    }
                }

                memo.set(key, best);
                return best;
            }

            function chooseBestMove(snapshot) {
                const boardState = snapshot.board;
                const pieces = snapshot.pieces;
                if (!boardState || !pieces || !pieces.length) return null;

                const memo = new Map();
                const result = searchBest(cloneBoard(boardState), pieces, 0, memo, null);
                return result.move || null;
            }

            self.onmessage = function (ev) {
                const data = ev.data;
                if (!data || data.type !== 'solve') return;

                try {
                    const move = chooseBestMove(data.snapshot);
                    self.postMessage({
                        type: 'solved',
                        id: data.id,
                        move
                    });
                } catch (err) {
                    self.postMessage({
                        type: 'error',
                        id: data.id,
                        message: err && err.message ? err.message : String(err)
                    });
                }
            };
        };

        const src = `(${workerMain.toString()})()`;
        const blob = new Blob([src], { type: 'text/javascript' });
        const url = URL.createObjectURL(blob);
        const w = new Worker(url);
        return w;
    }

    function ensureWorker() {
        if (workerReady && worker) return worker;
        try {
            worker = makeWorker();
            if (!worker) return null;

            worker.onmessage = (ev) => {
                const data = ev.data;
                if (!data) return;

                if (data.type === 'solved') {
                    if (data.id !== activeRequestId) return;

                    clearTimeout(requestTimeoutTimer);
                    requestTimeoutTimer = null;

                    const resolve = pendingResolve;
                    pendingResolve = null;
                    pendingReject = null;

                    if (resolve) resolve(data.move || null);
                } else if (data.type === 'error') {
                    if (data.id !== activeRequestId) return;

                    clearTimeout(requestTimeoutTimer);
                    requestTimeoutTimer = null;

                    const reject = pendingReject;
                    pendingResolve = null;
                    pendingReject = null;

                    if (reject) reject(new Error(data.message || 'AI worker error'));
                }
            };

            worker.onerror = (err) => {
                console.error('AI worker error:', err);
                workerReady = false;
                setStatus('AIワーカーエラー');
            };

            workerReady = true;
            return worker;
        } catch (e) {
            console.error('Failed to create AI worker:', e);
            workerReady = false;
            worker = null;
            return null;
        }
    }

    function buildSnapshot() {
        const cur = safeCurrentPuyo();
        const b = safeBoard();
        if (!cur || !b) return null;

        const q = safeQueue();
        const idx = safeQueueIndex();

        const pieces = [
            { mainColor: cur.mainColor | 0, subColor: cur.subColor | 0 }
        ];

        for (let i = 0; i < 2; i++) {
            const pair = q[idx + i];
            if (Array.isArray(pair) && pair.length >= 2) {
                pieces.push({ mainColor: pair[1] | 0, subColor: pair[0] | 0 });
            }
        }

        return {
            board: cloneBoard(b),
            pieces,
            allClearBonus: typeof ALL_CLEAR_SCORE_BONUS !== 'undefined' ? ALL_CLEAR_SCORE_BONUS : 2100,
            gameState: typeof gameState !== 'undefined' ? gameState : 'playing'
        };
    }

    function requestBestMove() {
        const w = ensureWorker();
        const snapshot = buildSnapshot();
        if (!w || !snapshot) return Promise.resolve(null);

        return new Promise((resolve, reject) => {
            activeRequestId = ++requestSeq;
            pendingResolve = resolve;
            pendingReject = reject;

            requestTimeoutTimer = setTimeout(() => {
                if (pendingResolve || pendingReject) {
                    const r = pendingReject;
                    pendingResolve = null;
                    pendingReject = null;
                    requestTimeoutTimer = null;
                    if (r) r(new Error('AI timed out'));
                }
            }, AI_CONFIG.THINK_TIMEOUT_MS);

            w.postMessage({
                type: 'solve',
                id: activeRequestId,
                snapshot
            });
        });
    }

    function applyMove(move) {
        const cur = safeCurrentPuyo();
        const b = safeBoard();
        if (!cur || !move || !b) return false;

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

    function sameCurrentPiece(token) {
        const cur = safeCurrentPuyo();
        if (!cur || !token) return false;
        return cur.mainColor === token.mainColor && cur.subColor === token.subColor;
    }

    async function doAI() {
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

        const token = {
            mainColor: cur.mainColor,
            subColor: cur.subColor
        };
        activeRequestToken = token;

        try {
            const move = await requestBestMove();

            if (!sameCurrentPiece(token)) {
                setStatus('AI待機中');
                return;
            }

            if (!move) {
                setStatus('手が見つかりません');
                return;
            }

            if (!applyMove(move)) {
                setStatus('AIエラー');
                return;
            }

            if (typeof requestAnimationFrame === 'function') {
                await new Promise(resolve => requestAnimationFrame(resolve));
            }

            hardDropCurrent();
            setStatus('AI実行完了');
        } catch (err) {
            console.error('AI error:', err);
            setStatus('AIエラー');
        } finally {
            busy = false;
            activeRequestToken = null;
        }
    }

    function scheduleAutoTick(delay) {
        if (!autoEnabled) return;
        clearTimeout(autoTimer);
        autoTimer = setTimeout(async () => {
            if (!autoEnabled) return;
            if (busy) {
                scheduleAutoTick(60);
                return;
            }
            await doAI();
            if (autoEnabled) scheduleAutoTick(AI_CONFIG.AUTO_TICK_MS);
        }, delay);
    }

    function stopAutoLoop() {
        clearTimeout(autoTimer);
        autoTimer = null;
    }

    function initAIUI() {
        if (uiInitialized) return;
        uiInitialized = true;
        updateAutoButton();
        setStatus('AI待機中');
    }

    // ---------- Public API ----------
    window.runPuyoAI = async function () {
        await doAI();
    };

    window.toggleAIAuto = function () {
        autoEnabled = !autoEnabled;
        updateAutoButton();

        if (autoEnabled) {
            setStatus('AI自動起動');
            scheduleAutoTick(0);
        } else {
            stopAutoLoop();
            setStatus('AI待機中');
        }
    };

    window.PuyoAI = {
        requestBestMove,
        applyMove,
        doAI
    };

    // ---------- Init ----------
    function boot() {
        initAIUI();
        if (autoEnabled) scheduleAutoTick(0);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();