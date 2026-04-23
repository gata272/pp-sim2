/* puyoAI.js
 * Chain-first AI for Puyo Puyo Simulator
 * - current piece + NEXT1 + NEXT2
 * - beam search
 * - pseudo-depth rollout
 * - template matching + chain seed evaluation
 * - danger-cell avoidance
 * - works with puyoSim.js globals
 */
(function () {
    'use strict';

    // ---------- Settings ----------
    const AI_CONFIG = {
        SEARCH_DEPTH: 3,            // current + next1 + next2
        BEAM_WIDTH: 14,
        LEAF_BEAM_WIDTH: 6,
        AUTO_TICK_MS: 120,
        PSEUDO_BRANCH_LIMIT: 6,
        PSEUDO_ROLLOUT_DEPTH: 2,
        VISUALIZE_DELAY_MS: 0
    };

    // ゲームオーバー直結マス（左から3列目・下から12段目）
    const DANGER_CELL_X = 2;
    const DANGER_CELL_Y = 11;

    const TEMPLATE_LIBRARY = [
        { name: 'left_stair',   mask: [1, 1, 1, 1, 0, 0], profile: [0, 1, 2, 3, 0, 0], weight: 1.00 },
        { name: 'right_stair',  mask: [0, 0, 1, 1, 1, 1], profile: [0, 0, 3, 2, 1, 0], weight: 1.00 },
        { name: 'left_gtr',     mask: [1, 1, 1, 1, 1, 0], profile: [0, 1, 2, 2, 1, 0], weight: 1.25 },
        { name: 'right_gtr',    mask: [0, 1, 1, 1, 1, 1], profile: [0, 1, 2, 2, 1, 0], weight: 1.25 },
        { name: 'valley',       mask: [1, 1, 1, 1, 1, 1], profile: [2, 1, 0, 0, 1, 2], weight: 1.10 },
        { name: 'center_tower', mask: [0, 1, 1, 1, 1, 0], profile: [0, 1, 2, 3, 2, 1], weight: 1.05 },
        { name: 'bridge',       mask: [1, 1, 1, 1, 1, 1], profile: [1, 2, 1, 1, 2, 1], weight: 0.95 }
    ];

    const MEMO = new Map();

    let autoEnabled = false;
    let autoTimer = null;
    let busy = false;
    let uiInitialized = false;

    // ---------- Small helpers ----------
    const getWidth = () => (typeof WIDTH !== 'undefined' ? WIDTH : 6);
    const getHeight = () => (typeof HEIGHT !== 'undefined' ? HEIGHT : 14);
    const getHiddenRows = () => (typeof HIDDEN_ROWS !== 'undefined' ? HIDDEN_ROWS : 2);

    const getColors = () => (typeof COLORS !== 'undefined' ? COLORS : {
        EMPTY: 0,
        RED: 1,
        BLUE: 2,
        GREEN: 3,
        YELLOW: 4,
        GARBAGE: 5
    });

    const C = () => getColors();

    function cloneBoard(src) {
        return src.map(row => row.slice());
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
            return nextQueue.map(p => p.slice());
        }
        return [];
    }

    function safeQueueIndex() {
        if (typeof queueIndex !== 'undefined' && Number.isFinite(queueIndex)) return queueIndex;
        return 0;
    }

    function updateStatus(text) {
        const el = document.getElementById('ai-status');
        if (el) el.textContent = text;
    }

    function updateAutoButton() {
        const btn = document.getElementById('ai-auto-button');
        if (!btn) return;
        btn.textContent = autoEnabled ? 'AI自動: ON' : 'AI自動: OFF';
    }

    function boardToKey(b) {
        return b.map(row => row.join('')).join('|');
    }

    function pieceFromPair(pair) {
        if (!pair || !Array.isArray(pair) || pair.length < 2) return null;
        return { subColor: pair[0], mainColor: pair[1] };
    }

    function readPieces() {
        const cur = safeCurrentPuyo();
        if (!cur) return [];

        const q = safeQueue();
        const idx = safeQueueIndex();

        const pieces = [
            { mainColor: cur.mainColor, subColor: cur.subColor }
        ];

        for (let i = 0; i < 2; i++) {
            const p = pieceFromPair(q[idx + i]);
            if (p) pieces.push(p);
        }
        return pieces;
    }

    function getPieceCoords(piece, x, y, rotation) {
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
        const W = getWidth();
        const H = getHeight();
        const coords = getPieceCoords(piece, x, y, rotation);

        for (const c of coords) {
            if (c.x < 0 || c.x >= W || c.y < 0 || c.y >= H) return false;
            if (boardState[c.y][c.x] !== C().EMPTY) return false;
        }
        return true;
    }

    function findRestY(boardState, piece, x, rotation) {
        const H = getHeight();

        let y = H - 1;
        while (y >= 0 && !canPlace(boardState, piece, x, y, rotation)) {
            y--;
        }
        if (y < 0) return null;

        while (y > 0 && canPlace(boardState, piece, x, y - 1, rotation)) {
            y--;
        }
        return y;
    }

    function placementsForPiece(boardState, piece) {
        const W = getWidth();
        const placements = [];

        for (let rot = 0; rot < 4; rot++) {
            for (let x = 0; x < W; x++) {
                const y = findRestY(boardState, piece, x, rot);
                if (y !== null) placements.push({ x, y, rotation: rot });
            }
        }
        return placements;
    }

    function placePiece(boardState, piece, x, y, rotation) {
        const next = cloneBoard(boardState);
        const coords = getPieceCoords(piece, x, y, rotation);

        for (const c of coords) {
            if (c.x >= 0 && c.x < getWidth() && c.y >= 0 && c.y < getHeight()) {
                next[c.y][c.x] = c.color;
            }
        }
        return next;
    }

    function gravityOn(boardState) {
        const W = getWidth();
        const H = getHeight();
        const EMPTY = C().EMPTY;

        for (let x = 0; x < W; x++) {
            const col = [];
            for (let y = 0; y < H; y++) {
                if (boardState[y][x] !== EMPTY) col.push(boardState[y][x]);
            }
            for (let y = 0; y < H; y++) {
                boardState[y][x] = y < col.length ? col[y] : EMPTY;
            }
        }
    }

    function findGroups(boardState, visibleOnly = true) {
        const W = getWidth();
        const H = getHeight();
        const limitY = visibleOnly ? H - getHiddenRows() : H;
        const EMPTY = C().EMPTY;
        const GARBAGE = C().GARBAGE;

        const visited = Array.from({ length: H }, () => Array(W).fill(false));
        const groups = [];

        for (let y = 0; y < limitY; y++) {
            for (let x = 0; x < W; x++) {
                const color = boardState[y][x];
                if (color === EMPTY || color === GARBAGE || visited[y][x]) continue;

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
                        if (
                            nx >= 0 && nx < W &&
                            ny >= 0 && ny < limitY &&
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

    function findGroupsLoose(boardState) {
        const W = getWidth();
        const H = getHeight();
        const EMPTY = C().EMPTY;
        const GARBAGE = C().GARBAGE;

        const visited = Array.from({ length: H }, () => Array(W).fill(false));
        const out = [];

        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const color = boardState[y][x];
                if (color === EMPTY || color === GARBAGE || visited[y][x]) continue;

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
                        if (
                            nx >= 0 && nx < W &&
                            ny >= 0 && ny < H &&
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

    function clearGarbageNeighbors(boardState, erasedCoords) {
        const W = getWidth();
        const H = getHeight();
        const EMPTY = C().EMPTY;
        const GARBAGE = C().GARBAGE;
        const toClear = new Set();

        for (const { x, y } of erasedCoords) {
            const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
            for (const [dx, dy] of dirs) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
                    if (boardState[ny][nx] === GARBAGE) toClear.add(`${nx},${ny}`);
                }
            }
        }

        for (const key of toClear) {
            const [x, y] = key.split(',').map(Number);
            boardState[y][x] = EMPTY;
        }
    }

    function groupBonus(size) {
        const table = (typeof BONUS_TABLE !== 'undefined' && BONUS_TABLE.GROUP)
            ? BONUS_TABLE.GROUP
            : [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        return table[Math.min(size, table.length - 1)] || 0;
    }

    function chainBonus(chainNo) {
        const table = (typeof BONUS_TABLE !== 'undefined' && BONUS_TABLE.CHAIN)
            ? BONUS_TABLE.CHAIN
            : [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512];
        const idx = Math.max(0, Math.min(chainNo - 1, table.length - 1));
        return table[idx] || 0;
    }

    function colorBonus(colorCount) {
        const table = (typeof BONUS_TABLE !== 'undefined' && BONUS_TABLE.COLOR)
            ? BONUS_TABLE.COLOR
            : [0, 0, 3, 6, 12];
        return table[Math.min(colorCount, table.length - 1)] || 0;
    }

    function scoreToOjamaFallback(scoreValue) {
        return Math.floor(Math.max(0, scoreValue) / 70);
    }

    function scoreToOjamaFn() {
        if (typeof scoreToOjama === 'function') return scoreToOjama;
        return scoreToOjamaFallback;
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
        if (bonusTotal > 999) bonusTotal = 999;

        return 10 * totalPuyos * bonusTotal;
    }

    function isBoardEmpty(boardState) {
        const EMPTY = C().EMPTY;
        for (let y = 0; y < getHeight(); y++) {
            for (let x = 0; x < getWidth(); x++) {
                if (boardState[y][x] !== EMPTY) return false;
            }
        }
        return true;
    }

    function resolveBoard(boardState) {
        const scoreFn = scoreToOjamaFn();
        const allClearBonus = (typeof ALL_CLEAR_SCORE_BONUS !== 'undefined' ? ALL_CLEAR_SCORE_BONUS : 2100);
        const EMPTY = C().EMPTY;

        let totalChains = 0;
        let totalScore = 0;
        let totalAttack = 0;

        while (true) {
            gravityOn(boardState);
            const groups = findGroups(boardState, true);
            if (groups.length === 0) break;

            totalChains++;
            const chainScore = calculateScore(groups, totalChains);
            totalScore += chainScore;
            totalAttack += scoreFn(chainScore);

            const erased = [];
            for (const { group } of groups) {
                for (const p of group) {
                    boardState[p.y][p.x] = EMPTY;
                    erased.push(p);
                }
            }
            clearGarbageNeighbors(boardState, erased);
        }

        gravityOn(boardState);

        let allClear = false;
        if (isBoardEmpty(boardState)) {
            allClear = true;
            totalScore += allClearBonus;
            totalAttack += scoreFn(allClearBonus);
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
        const W = getWidth();
        const H = getHeight();
        const EMPTY = C().EMPTY;
        const heights = Array(W).fill(0);

        for (let x = 0; x < W; x++) {
            let h = 0;
            for (let y = H - 1; y >= 0; y--) {
                if (boardState[y][x] !== EMPTY) {
                    h = y + 1;
                    break;
                }
            }
            heights[x] = h;
        }
        return heights;
    }

    function countHoles(boardState, heights) {
        const W = getWidth();
        const EMPTY = C().EMPTY;
        let holes = 0;

        for (let x = 0; x < W; x++) {
            for (let y = 0; y < heights[x]; y++) {
                if (boardState[y][x] === EMPTY) holes++;
            }
        }
        return holes;
    }

    function openNeighborCount(boardState, cells) {
        const W = getWidth();
        const H = getHeight();
        const EMPTY = C().EMPTY;
        const seen = new Set();
        let count = 0;

        for (const { x, y } of cells) {
            const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
            for (const [dx, dy] of dirs) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < W && ny >= 0 && ny < H && boardState[ny][nx] === EMPTY) {
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

    function colorCounts(boardState) {
        const counts = [0, 0, 0, 0, 0];
        for (let y = 0; y < getHeight(); y++) {
            for (let x = 0; x < getWidth(); x++) {
                const v = boardState[y][x];
                if (v >= 1 && v <= 4) counts[v]++;
            }
        }
        return counts;
    }

    function dangerPenalty(boardState) {
        const heights = columnHeights(boardState);
        const EMPTY = C().EMPTY;

        let penalty = 0;

        if (boardState[DANGER_CELL_Y][DANGER_CELL_X] !== EMPTY) {
            penalty += 1000000;
        }

        if (heights[DANGER_CELL_X] >= DANGER_CELL_Y + 1) {
            penalty += 250000;
        }

        if (heights[DANGER_CELL_X] >= DANGER_CELL_Y - 1) {
            penalty += 80000;
        }

        for (let y = Math.max(0, DANGER_CELL_Y - 2); y <= DANGER_CELL_Y; y++) {
            if (boardState[y][DANGER_CELL_X] !== EMPTY) {
                penalty += 25000;
            }
        }

        return penalty;
    }

    function fragmentationPenalty(boardState) {
        const comps = findGroupsLoose(boardState);
        const perColor = [0, 0, 0, 0, 0];
        let small = 0;

        for (const comp of comps) {
            if (comp.color >= 1 && comp.color <= 4) {
                perColor[comp.color]++;
            }
            if (comp.cells.length <= 2) small++;
        }

        let penalty = small * 7;
        for (let c = 1; c <= 4; c++) {
            if (perColor[c] > 4) penalty += (perColor[c] - 4) * 14;
        }
        return penalty;
    }

    function templateScore(boardState) {
        const heights = columnHeights(boardState);
        let best1 = 0;
        let best2 = 0;

        for (const t of TEMPLATE_LIBRARY) {
            const masked = [];
            for (let x = 0; x < getWidth(); x++) {
                if (t.mask[x]) masked.push(x);
            }
            if (!masked.length) continue;

            let base = Infinity;
            for (const x of masked) {
                base = Math.min(base, heights[x] - t.profile[x]);
            }
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

    function triggerHeightScore(boardState) {
        const h = columnHeights(boardState);
        const EMPTY = C().EMPTY;

        // 中央を少し高め、左右をなだらかにする GTR 系の形を軽く誘導
        const target = [0, 1, 2, 2, 1, 0];
        let s = 0;

        for (let x = 0; x < getWidth(); x++) {
            const diff = Math.abs(h[x] - target[x]);
            s += Math.max(0, 12 - diff * 3);
        }

        // 左右端が高すぎるのを少し嫌う
        if (h[0] >= 6) s -= 12;
        if (h[5] >= 6) s -= 12;

        // 危険列はここでも軽く嫌う
        if (boardState[DANGER_CELL_Y][DANGER_CELL_X] !== EMPTY) s -= 30;

        return s;
    }

    function seedScore(boardState) {
        const comps = findGroupsLoose(boardState);
        let s = 0;

        for (const g of comps) {
            const size = g.cells.length;
            if (size === 1) s += 1;
            else if (size === 2) s += 14 + openNeighborCount(boardState, g.cells) * 3;
            else if (size === 3) s += 42 + openNeighborCount(boardState, g.cells) * 5;
        }

        // 連結しやすい 2/3 個塊を少し押し上げる
        const counts = colorCounts(boardState);
        const dominant = counts.slice(1).sort((a, b) => b - a);
        s += Math.max(0, dominant[0] - dominant[2]) * 0.15;

        return s;
    }

    function evaluateBoard(boardState) {
        const heights = columnHeights(boardState);
        const holes = countHoles(boardState, heights);
        const maxH = Math.max(...heights);
        const bumpiness = heights.reduce((sum, h, i) => sum + (i > 0 ? Math.abs(h - heights[i - 1]) : 0), 0);

        let s = 0;

        // ama の「pattern / trigger height / chain extension」寄り
        s += templateScore(boardState) * 22;
        s += triggerHeightScore(boardState) * 18;
        s += seedScore(boardState) * 14;

        // 盤面の壊れやすさを嫌う
        s -= fragmentationPenalty(boardState) * 10;
        s -= holes * 48;
        s -= bumpiness * 12;
        s -= maxH * 34;

        // 危険列を強烈に避ける
        s -= dangerPenalty(boardState);

        // 盤面上端寄りはさらに嫌う
        if (maxH >= getHeight() - 3) s -= 120;
        if (maxH >= getHeight() - 2) s -= 280;
        if (maxH >= getHeight() - 1) s -= 900;

        return s;
    }

    function chainOutcomeValue(sim) {
        const chainPart = Math.pow(Math.max(0, sim.chains), 2.45) * 42000;
        const scorePart = sim.score * 6;
        const attackPart = sim.attack * 2500;
        const clearPart = sim.allClear ? 180000 : 0;
        return chainPart + scorePart + attackPart + clearPart;
    }

    function quickPlacementValue(boardState, sim) {
        return evaluateBoard(boardState) + chainOutcomeValue(sim) * 0.018 - dangerPenalty(boardState) * 0.12;
    }

    function simulateMove(boardState, piece, x, y, rotation) {
        const placed = placePiece(boardState, piece, x, y, rotation);
        return resolveBoard(placed);
    }

    function candidateVirtualPieces(boardState) {
        const counts = colorCounts(boardState);
        const order = [1, 2, 3, 4].sort((a, b) => counts[b] - counts[a]);

        const a = order[0] || 1;
        const b = order[1] || 2;
        const c = order[2] || 3;
        const d = order[3] || 4;

        const pieces = [
            [a, a],
            [b, b],
            [a, b],
            [a, c],
            [b, c],
            [c, d]
        ];

        const seen = new Set();
        const out = [];
        for (const [subColor, mainColor] of pieces) {
            const key = `${subColor},${mainColor}`;
            if (!seen.has(key)) {
                seen.add(key);
                out.push({ subColor, mainColor });
            }
        }
        return out;
    }

    function pseudoRolloutScore(boardState, depth) {
        const base = evaluateBoard(boardState);
        if (depth <= 0) return base;

        const virtualPieces = candidateVirtualPieces(boardState);
        let best = base * 0.55;

        for (const piece of virtualPieces) {
            const placements = placementsForPiece(boardState, piece);
            if (!placements.length) continue;

            const scored = placements
                .map(p => {
                    const sim = simulateMove(boardState, piece, p.x, p.y, p.rotation);
                    return {
                        sim,
                        quick: quickPlacementValue(sim.board, sim)
                    };
                })
                .sort((a, b) => b.quick - a.quick)
                .slice(0, AI_CONFIG.PSEUDO_BRANCH_LIMIT);

            for (const cand of scored) {
                const immediate = cand.sim.chains > 0
                    ? chainOutcomeValue(cand.sim) + evaluateBoard(cand.sim.board) * 0.12
                    : evaluateBoard(cand.sim.board);

                const future = pseudoRolloutScore(cand.sim.board, depth - 1) * 0.55;
                const total = immediate * 0.85 + future;

                if (total > best) best = total;
            }
        }

        return best;
    }

    function searchBest(boardState, pieces, depth, memo, rootMove) {
        const key = `${depth}|${boardToKey(boardState)}|${pieces.map(p => `${p.subColor},${p.mainColor}`).join('|')}`;
        if (memo.has(key)) return memo.get(key);

        if (depth >= pieces.length) {
            const score = pseudoRolloutScore(boardState, AI_CONFIG.PSEUDO_ROLLOUT_DEPTH);
            const ret = { score, move: rootMove || null };
            memo.set(key, ret);
            return ret;
        }

        const piece = pieces[depth];
        const placements = placementsForPiece(boardState, piece);
        if (!placements.length) {
            const ret = { score: -1e15, move: rootMove || null };
            memo.set(key, ret);
            return ret;
        }

        const candidates = [];
        for (const p of placements) {
            const sim = simulateMove(boardState, piece, p.x, p.y, p.rotation);
            const quick = quickPlacementValue(sim.board, sim);
            candidates.push({ ...p, sim, quick });
        }

        candidates.sort((a, b) => b.quick - a.quick);
        const beam = candidates.slice(0, AI_CONFIG.BEAM_WIDTH);

        let best = { score: -1e15, move: rootMove || null };

        for (const c of beam) {
            const moveHere = depth === 0
                ? { x: c.x, y: c.y, rotation: c.rotation }
                : rootMove;

            let total;
            if (c.sim.chains > 0) {
                total = chainOutcomeValue(c.sim) + evaluateBoard(c.sim.board) * 0.12 + pseudoRolloutScore(c.sim.board, 1) * 0.2;
            } else if (depth + 1 >= pieces.length) {
                total = evaluateBoard(c.sim.board) * 0.20 + pseudoRolloutScore(c.sim.board, AI_CONFIG.PSEUDO_ROLLOUT_DEPTH);
            } else {
                const child = searchBest(c.sim.board, pieces, depth + 1, memo, moveHere);
                total = evaluateBoard(c.sim.board) * 0.20 + child.score;
            }

            if (total > best.score) {
                best = { score: total, move: moveHere };
            }
        }

        memo.set(key, best);
        return best;
    }

    function chooseBestMove() {
        const cur = safeCurrentPuyo();
        const b = safeBoard();

        if (!cur || !b) return null;
        if (typeof gameState !== 'undefined' && gameState !== 'playing') return null;

        const pieces = readPieces();
        if (!pieces.length) return null;

        MEMO.clear();
        const snapshot = cloneBoard(b);
        const result = searchBest(snapshot, pieces, 0, MEMO, null);
        return result.move;
    }

    function applyMove(move) {
        const cur = safeCurrentPuyo();
        if (!cur || !move) return false;

        cur.mainX = move.x;
        cur.mainY = move.y;
        cur.rotation = move.rotation;

        if (typeof renderBoard === 'function') renderBoard();
        return true;
    }

    function doAI() {
        if (busy) return;

        if (typeof gameState !== 'undefined' && gameState !== 'playing') {
            updateStatus('AI待機中');
            return;
        }

        const cur = safeCurrentPuyo();
        if (!cur) {
            updateStatus('AI待機中');
            return;
        }

        busy = true;
        try {
            updateStatus('AI思考中...');

            const move = chooseBestMove();
            if (!move) {
                updateStatus('手が見つかりません');
                return;
            }

            applyMove(move);

            if (AI_CONFIG.VISUALIZE_DELAY_MS > 0) {
                setTimeout(() => {
                    if (typeof hardDrop === 'function') hardDrop();
                    updateStatus('AI実行完了');
                    busy = false;
                }, AI_CONFIG.VISUALIZE_DELAY_MS);
            } else {
                if (typeof hardDrop === 'function') hardDrop();
                updateStatus('AI実行完了');
                busy = false;
            }
        } catch (err) {
            console.error('AI error:', err);
            updateStatus('AIエラー');
            busy = false;
        }
    }

    function tickAuto() {
        if (!autoEnabled || busy) return;

        if (typeof gameState !== 'undefined' && gameState !== 'playing') {
            updateStatus('AI待機中');
            return;
        }

        if (!safeCurrentPuyo()) {
            updateStatus('AI待機中');
            return;
        }

        doAI();
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
        updateStatus('AI待機中');
    }

    // ---------- Public API ----------
    window.runPuyoAI = function () {
        doAI();
    };

    window.toggleAIAuto = function () {
        autoEnabled = !autoEnabled;
        updateAutoButton();

        if (autoEnabled) {
            updateStatus('AI自動起動');
            startAutoLoop();
            tickAuto();
        } else {
            stopAutoLoop();
            updateStatus('AI待機中');
        }
    };

    window.PuyoAI = {
        chooseBestMove,
        evaluateBoard,
        resolveBoard,
        searchBest,
        templateScore,
        seedScore,
        dangerPenalty,
        pseudoRolloutScore
    };

    // ---------- Init ----------
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