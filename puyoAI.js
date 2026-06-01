/* puyoAI.js
 * GTR-formalized AI + existing beam search fallback
 * - First 4 plies follow GTR-like formalized rules
 * - Then fallback to the existing lookahead search
 * - Works with puyoSim.js globals
 */
(function () {
    'use strict';

    // ------------------------------------------------------------
    // Settings
    // ------------------------------------------------------------
    const AI_CONFIG = {
        SEARCH_DEPTH: 3,
        BEAM_WIDTH: 10,
        AUTO_TICK_MS: 120,
        PSEUDO_COLORS: [1, 2, 3, 4],
        PSEUDO_BRANCH_LIMIT: 6,
        VISUALIZE_DELAY_MS: 0
    };

    const GTR_MAX_PLIES = 4;

    const TEMPLATE_LIBRARY = [
        { name: 'left_stair',   mask: [1, 1, 1, 1, 0, 0], profile: [0, 1, 2, 3, 0, 0], weight: 1.00 },
        { name: 'right_stair',  mask: [0, 0, 1, 1, 1, 1], profile: [0, 0, 3, 2, 1, 0], weight: 1.00 },
        { name: 'left_gtr',     mask: [1, 1, 1, 1, 1, 0], profile: [0, 1, 2, 2, 1, 0], weight: 1.25 },
        { name: 'right_gtr',    mask: [0, 1, 1, 1, 1, 1], profile: [0, 1, 2, 2, 1, 0], weight: 1.25 },
        { name: 'valley',       mask: [1, 1, 1, 1, 1, 1], profile: [2, 1, 0, 0, 1, 2], weight: 1.10 },
        { name: 'center_tower', mask: [0, 1, 1, 1, 1, 0], profile: [0, 1, 2, 3, 2, 1], weight: 1.05 },
        { name: 'bridge',       mask: [1, 1, 1, 1, 1, 1], profile: [1, 2, 1, 1, 2, 1], weight: 0.95 }
    ];

    // ------------------------------------------------------------
    // State
    // ------------------------------------------------------------
    const MEMO = new Map();
    let autoEnabled = false;
    let autoTimer = null;
    let busy = false;
    let uiInitialized = false;

    // ------------------------------------------------------------
    // Basic helpers
    // ------------------------------------------------------------
    const getWidth = () => (typeof WIDTH !== 'undefined' ? WIDTH : 6);
    const getHeight = () => (typeof HEIGHT !== 'undefined' ? HEIGHT : 14);
    const getColors = () => (typeof COLORS !== 'undefined' ? COLORS : {
        EMPTY: 0,
        RED: 1,
        BLUE: 2,
        GREEN: 3,
        YELLOW: 4,
        GARBAGE: 5
    });

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

    function readPieces(n = 4) {
        const cur = safeCurrentPuyo();
        if (!cur) return [];

        const q = safeQueue();
        const idx = safeQueueIndex();
        const pieces = [{ mainColor: cur.mainColor, subColor: cur.subColor }];

        for (let i = 0; i < n - 1; i++) {
            const p = pieceFromPair(q[idx + i]);
            if (p) pieces.push(p);
        }
        return pieces;
    }

    function pieceColors(piece) {
        return [piece.mainColor, piece.subColor];
    }

    function piecePattern(piece, labels) {
        const names = pieceColors(piece).map(c => labelOfColor(c, labels)).sort();
        return names.join('');
    }

    function labelOfColor(color, labels) {
        for (const k of ['A', 'B', 'C', 'D']) {
            if (labels[k] === color) return k;
        }
        return '?';
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
        const C = getColors();
        const coords = getPieceCoords(piece, x, y, rotation);

        for (const c of coords) {
            if (c.x < 0 || c.x >= W || c.y < 0 || c.y >= H) return false;
            if (boardState[c.y][c.x] !== C.EMPTY) return false;
        }
        return true;
    }

    function findRestY(boardState, piece, x, rotation) {
        const H = getHeight();
        let y = H - 2;
        if (!canPlace(boardState, piece, x, y, rotation)) return null;

        while (y > 0 && canPlace(boardState, piece, x, y - 1, rotation)) {
            y--;
        }
        return y;
    }

    function dropPlacements(boardState, piece) {
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
        const C = getColors();

        for (let x = 0; x < W; x++) {
            const col = [];
            for (let y = 0; y < H; y++) {
                if (boardState[y][x] !== C.EMPTY) col.push(boardState[y][x]);
            }
            for (let y = 0; y < H; y++) {
                boardState[y][x] = y < col.length ? col[y] : C.EMPTY;
            }
        }
    }

    function findGroups(boardState) {
        const W = getWidth();
        const H = getHeight();
        const C = getColors();
        const visited = Array.from({ length: H }, () => Array(W).fill(false));
        const groups = [];

        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const color = boardState[y][x];
                if (color === C.EMPTY || color === C.GARBAGE || visited[y][x]) continue;

                const stack = [{ x, y }];
                visited[y][x] = true;
                const group = [];

                while (stack.length) {
                    const cur = stack.pop();
                    group.push(cur);

                    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
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

                if (group.length >= 4) groups.push({ color, group });
            }
        }

        return groups;
    }

    function findGroupsLoose(boardState) {
        const W = getWidth();
        const H = getHeight();
        const C = getColors();
        const visited = Array.from({ length: H }, () => Array(W).fill(false));
        const out = [];

        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const color = boardState[y][x];
                if (color === C.EMPTY || color === C.GARBAGE || visited[y][x]) continue;

                const stack = [{ x, y }];
                visited[y][x] = true;
                const cells = [];

                while (stack.length) {
                    const cur = stack.pop();
                    cells.push(cur);

                    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
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
        const C = getColors();
        const toClear = new Set();

        for (const { x, y } of erasedCoords) {
            for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
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
        const table = (typeof BONUS_TABLE !== 'undefined' && BONUS_TABLE.GROUP)
            ? BONUS_TABLE.GROUP
            : [0,0,0,0,0,2,3,4,5,6,7,8,9,10,11,12];
        return table[Math.min(size, table.length - 1)] || 0;
    }

    function chainBonus(chainNo) {
        const table = (typeof BONUS_TABLE !== 'undefined' && BONUS_TABLE.CHAIN)
            ? BONUS_TABLE.CHAIN
            : [0,8,16,32,64,96,128,160,192,224,256,288,320,352,384,416,448,480,512];
        const idx = Math.max(0, Math.min(chainNo - 1, table.length - 1));
        return table[idx] || 0;
    }

    function colorBonus(colorCount) {
        const table = (typeof BONUS_TABLE !== 'undefined' && BONUS_TABLE.COLOR)
            ? BONUS_TABLE.COLOR
            : [0,0,3,6,12];
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

    function resolveBoard(boardState) {
        const C = getColors();
        const getScoreFn = () => {
            if (typeof scoreToOjama === 'function') return scoreToOjama;
            return (v) => Math.floor(Math.max(0, v) / 70);
        };
        const acBonus = (typeof ALL_CLEAR_SCORE_BONUS !== 'undefined') ? ALL_CLEAR_SCORE_BONUS : 2100;

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
            totalAttack += getScoreFn()(chainScore);

            const erased = [];
            for (const { group } of groups) {
                for (const p of group) {
                    boardState[p.y][p.x] = C.EMPTY;
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
            totalAttack += getScoreFn()(acBonus);
        }

        return {
            board: boardState,
            chains: totalChains,
            score: totalScore,
            attack: totalAttack,
            allClear
        };
    }

    function isBoardEmpty(boardState) {
        const C = getColors();
        for (let y = 0; y < getHeight(); y++) {
            for (let x = 0; x < getWidth(); x++) {
                if (boardState[y][x] !== C.EMPTY) return false;
            }
        }
        return true;
    }

    function columnHeights(boardState) {
        const W = getWidth();
        const H = getHeight();
        const C = getColors();
        const heights = Array(W).fill(0);

        for (let x = 0; x < W; x++) {
            let h = 0;
            for (let y = H - 1; y >= 0; y--) {
                if (boardState[y][x] !== C.EMPTY) {
                    h = y + 1;
                    break;
                }
            }
            heights[x] = h;
        }
        return heights;
    }

    function countHoles(boardState, heights) {
        const C = getColors();
        let holes = 0;
        for (let x = 0; x < getWidth(); x++) {
            for (let y = 0; y < heights[x]; y++) {
                if (boardState[y][x] === C.EMPTY) holes++;
            }
        }
        return holes;
    }

    function openNeighborCount(boardState, cells) {
        const W = getWidth();
        const H = getHeight();
        const C = getColors();
        const seen = new Set();
        let count = 0;

        for (const { x, y } of cells) {
            for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < W && ny >= 0 && ny < H && boardState[ny][nx] === C.EMPTY) {
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

    function seedScore(boardState) {
        const groups = findGroupsLoose(boardState);
        let s = 0;

        for (const g of groups) {
            const size = g.cells.length;
            if (size === 1) s += 1;
            else if (size === 2) s += 12 + openNeighborCount(boardState, g.cells) * 2;
            else if (size === 3) s += 35 + openNeighborCount(boardState, g.cells) * 4;
        }

        const W = getWidth();
        const H = getHeight();
        const C = getColors();
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const c = boardState[y][x];
                if (c === C.EMPTY || c === C.GARBAGE) continue;

                if (x + 2 < W && boardState[y][x + 1] === c && boardState[y][x + 2] === c) {
                    if ((x - 1 >= 0 && boardState[y][x - 1] === C.EMPTY) || (x + 3 < W && boardState[y][x + 3] === C.EMPTY)) {
                        s += 16;
                    }
                }

                if (y + 2 < H && boardState[y + 1][x] === c && boardState[y + 2][x] === c) {
                    if ((y - 1 >= 0 && boardState[y - 1][x] === C.EMPTY) || (y + 3 < H && boardState[y + 3][x] === C.EMPTY)) {
                        s += 16;
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

    function dangerPenalty(boardState) {
        const C = getColors();
        const heights = columnHeights(boardState);
        const x = 2;
        const y = 11;
        let penalty = 0;

        if (boardState[y] && boardState[y][x] !== C.EMPTY) penalty += 1000000;
        if (heights[x] >= y + 1) penalty += 250000;
        if (heights[x] >= y - 1) penalty += 80000;

        for (let yy = Math.max(0, y - 2); yy <= y; yy++) {
            if (boardState[yy] && boardState[yy][x] !== C.EMPTY) penalty += 25000;
        }
        return penalty;
    }

    function evaluateBoard(boardState) {
        const heights = columnHeights(boardState);
        const holes = countHoles(boardState, heights);
        const maxH = Math.max(...heights);
        const bumpiness = heights.reduce((sum, h, i) => sum + (i > 0 ? Math.abs(h - heights[i - 1]) : 0), 0);

        let s = 0;
        s += templateScore(boardState) * 18;
        s += seedScore(boardState) * 10;

        const comps = findGroupsLoose(boardState);
        for (const g of comps) {
            const size = g.cells.length;
            if (size === 2) s += 10;
            else if (size === 3) s += 30 + openNeighborCount(boardState, g.cells) * 3;
            else if (size >= 5) s += Math.min(80, size * 8);
        }

        s -= holes * 38;
        s -= bumpiness * 10;
        s -= maxH * 30;
        s -= dangerPenalty(boardState);

        if (maxH >= getHeight() - 3) s -= 120;
        if (maxH >= getHeight() - 2) s -= 260;

        const counts = [0, 0, 0, 0, 0];
        for (let y = 0; y < getHeight(); y++) {
            for (let x = 0; x < getWidth(); x++) {
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

    function quickPlacementValue(boardState, sim) {
        return evaluateBoard(boardState) + chainOutcomeValue(sim) * 0.01;
    }

    function simulateMove(boardState, piece, x, y, rotation) {
        const placed = placePiece(boardState, piece, x, y, rotation);
        return resolveBoard(placed);
    }

    function leafPseudoDepth4(boardState) {
        let best = evaluateBoard(boardState);

        const allPlays = [];
        for (const color of AI_CONFIG.PSEUDO_COLORS) {
            const dummy = { mainColor: color, subColor: color };
            const placements = dropPlacements(boardState, dummy);

            for (const p of placements) {
                const sim = simulateMove(boardState, dummy, p.x, p.y, p.rotation);
                const value = sim.chains > 0
                    ? chainOutcomeValue(sim) + evaluateBoard(sim.board) * 0.1
                    : evaluateBoard(sim.board) + seedScore(sim.board) * 3;
                allPlays.push({ value, sim });
            }
        }

        allPlays.sort((a, b) => b.value - a.value);
        const limit = Math.min(AI_CONFIG.PSEUDO_BRANCH_LIMIT, allPlays.length);

        for (let i = 0; i < limit; i++) {
            const node = allPlays[i];
            let v = node.value;
            if (node.sim.chains === 0) {
                v += evaluateBoard(node.sim.board) * 0.3;
            }
            if (v > best) best = v;
        }

        return best;
    }

    function searchBest(boardState, pieces, depth, memo, rootMove) {
        const key = `${depth}|${boardToKey(boardState)}|${pieces.map(p => `${p.mainColor}${p.subColor}`).join(',')}`;
        if (memo.has(key)) return memo.get(key);

        if (depth >= pieces.length) {
            const score = leafPseudoDepth4(boardState);
            const ret = { score, move: rootMove || null };
            memo.set(key, ret);
            return ret;
        }

        const piece = pieces[depth];
        const placements = dropPlacements(boardState, piece);
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
            const moveHere = depth === 0 ? { x: c.x, y: c.y, rotation: c.rotation } : rootMove;
            let total;

            if (c.sim.chains > 0) {
                total = chainOutcomeValue(c.sim) + evaluateBoard(c.sim.board) * 0.1;
            } else if (depth + 1 >= pieces.length) {
                total = evaluateBoard(c.sim.board) * 0.25 + leafPseudoDepth4(c.sim.board);
            } else {
                const child = searchBest(c.sim.board, pieces, depth + 1, memo, moveHere);
                total = evaluateBoard(c.sim.board) * 0.25 + child.score;
            }

            if (total > best.score) {
                best = { score: total, move: moveHere };
            }
        }

        memo.set(key, best);
        return best;
    }

    // ------------------------------------------------------------
    // GTR formalization
    // ------------------------------------------------------------
    function countUniqueColors(arr) {
        return new Set(arr).size;
    }

    function firstNonMemberColor(piece, forbiddenSet) {
        for (const c of pieceColors(piece)) {
            if (!forbiddenSet.has(c)) return c;
        }
        return null;
    }

    function pieceSet(piece) {
        return new Set(pieceColors(piece));
    }

    function sharedColor(a, b) {
        const sa = pieceSet(a);
        for (const c of pieceColors(b)) {
            if (sa.has(c)) return c;
        }
        return null;
    }

    function detectFamily(pieces) {
        if (!pieces || pieces.length < 2) return null;
        const p0 = pieces[0];
        const p1 = pieces[1];
        const s0 = pieceSet(p0);
        const s1 = pieceSet(p1);
        const u0 = [...s0];
        const u1 = [...s1];
        const inter = u0.filter(c => s1.has(c));
        const uniq0 = u0.filter(c => !s1.has(c));
        const uniq1 = u1.filter(c => !s0.has(c));

        if (u0.length === 1 && u1.length === 2 && inter.length === 1) return 'AAAB';
        if (u0.length === 1 && u1.length === 1 && u0[0] !== u1[0]) return 'AABB';
        if (u0.length === 2 && u1.length === 2 && inter.length === 2) return 'ABAB';
        if (u0.length === 2 && u1.length === 2 && inter.length === 1) return 'ABAC';
        if (u0.length === 1 && u1.length === 2 && inter.length === 0) return 'AABC';

        // fallbacks
        if (u0.length === 2 && u1.length === 2) {
            if (inter.length === 2) return 'ABAB';
            if (inter.length === 1) return 'ABAC';
        }
        return null;
    }

    function buildLabelsForFamily(family, pieces) {
        const p0 = pieces[0];
        const p1 = pieces[1] || null;
        const p2 = pieces[2] || null;
        const p3 = pieces[3] || null;

        const labels = { A: null, B: null, C: null, D: null };

        if (family === 'AAAB') {
            labels.A = sharedColor(p0, p1);
            labels.B = firstNonMemberColor(p1, new Set([labels.A]));
            if (p2) labels.C = firstNonMemberColor(p2, new Set([labels.A, labels.B]));
            if (p3) labels.D = firstNonMemberColor(p3, new Set([labels.A, labels.B, labels.C].filter(Boolean)));
            return labels.A !== null && labels.B !== null ? labels : null;
        }

        if (family === 'AABB') {
            const c0 = pieceColors(p0)[0];
            const c1 = pieceColors(p1)[0];
            labels.A = c0;
            labels.B = c1;
            if (p2) labels.C = firstNonMemberColor(p2, new Set([labels.A, labels.B]));
            if (p3) labels.D = firstNonMemberColor(p3, new Set([labels.A, labels.B, labels.C].filter(Boolean)));
            return labels.A !== null && labels.B !== null ? labels : null;
        }

        if (family === 'ABAB') {
            labels.A = pieceColors(p0)[0];
            labels.B = pieceColors(p0)[1];
            if (p2) labels.C = firstNonMemberColor(p2, new Set([labels.A, labels.B]));
            if (p3) labels.D = firstNonMemberColor(p3, new Set([labels.A, labels.B, labels.C].filter(Boolean)));
            return labels.A !== null && labels.B !== null ? labels : null;
        }

        if (family === 'ABAC') {
            labels.A = sharedColor(p0, p1);
            labels.B = firstNonMemberColor(p0, new Set([labels.A]));
            labels.C = firstNonMemberColor(p1, new Set([labels.A]));
            if (p2) labels.D = firstNonMemberColor(p2, new Set([labels.A, labels.B, labels.C].filter(Boolean)));
            return labels.A !== null && labels.B !== null && labels.C !== null ? labels : null;
        }

        if (family === 'AABC') {
            labels.A = pieceColors(p0)[0];
            labels.B = pieceColors(p1)[0];
            labels.C = pieceColors(p1)[1];
            if (p2) labels.D = firstNonMemberColor(p2, new Set([labels.A, labels.B, labels.C]));
            return labels.A !== null && labels.B !== null && labels.C !== null ? labels : null;
        }

        return null;
    }

    function makeVRule(col0, bottomColor = null, topColor = null) {
        return { kind: 'V', col: col0, bottomColor, topColor };
    }

    function makeHRule(cols0, leftColor = null, rightColor = null) {
        return { kind: 'H', cols: cols0, leftColor, rightColor };
    }

    function coordsForPlacement(piece, placement) {
        return getPieceCoords(piece, placement.x, placement.y, placement.rotation);
    }

    function matchRule(piece, placement, rule) {
        const coords = coordsForPlacement(piece, placement);
        if (!coords || coords.length !== 2) return false;

        const a = coords[0];
        const b = coords[1];

        if (rule.kind === 'V') {
            if (a.x !== b.x) return false;
            if (a.x !== rule.col) return false;

            const bottom = a.y < b.y ? a : b;
            const top = a.y < b.y ? b : a;

            if (rule.bottomColor !== null && bottom.color !== rule.bottomColor) return false;
            if (rule.topColor !== null && top.color !== rule.topColor) return false;
            return true;
        }

        if (rule.kind === 'H') {
            if (a.y !== b.y) return false;
            const left = a.x < b.x ? a : b;
            const right = a.x < b.x ? b : a;

            const xs = [left.x, right.x].sort((m, n) => m - n);
            const expected = rule.cols.slice().sort((m, n) => m - n);
            if (xs[0] !== expected[0] || xs[1] !== expected[1]) return false;

            if (rule.leftColor !== null && left.color !== rule.leftColor) return false;
            if (rule.rightColor !== null && right.color !== rule.rightColor) return false;
            return true;
        }

        return false;
    }

    function placementsMatchingRules(boardState, piece, rules) {
        if (!rules || !rules.length) return [];
        const legal = dropPlacements(boardState, piece);
        const out = [];
        for (const p of legal) {
            for (const r of rules) {
                if (matchRule(piece, p, r)) {
                    out.push(p);
                    break;
                }
            }
        }
        return out;
    }

    function gtrRulesForTurn(family, turnIndex, labels, pieces) {
        const cur = pieces[turnIndex];
        const next = pieces[turnIndex + 1] || null;
        const prevPat = turnIndex > 0 ? piecePattern(pieces[turnIndex - 1], labels) : null;
        const curPat = cur ? piecePattern(cur, labels) : null;
        const nextPat = next ? piecePattern(next, labels) : null;
        const rules = [];

        // ---------------- AAAB ----------------
        if (family === 'AAAB') {
            if (turnIndex === 0) {
                rules.push(makeHRule([0, 1])); // AA -> 1,2 horizontal
                return rules;
            }

            if (turnIndex === 1) {
                // AB -> 3rd column, B bottom
                rules.push(makeVRule(2, labels.B, null));
                return rules;
            }

            if (turnIndex === 2) {
                switch (curPat) {
                    case 'AA': rules.push(makeHRule([3, 4])); break;
                    case 'AB': rules.push(makeVRule(3, labels.A, null)); break;
                    case 'AC': rules.push(makeVRule(1, labels.C, null)); break;
                    case 'BB': rules.push(makeVRule(3, null, null)); break;
                    case 'BC': rules.push(makeVRule(3, labels.C, null)); break;
                    case 'CC': rules.push(makeHRule([0, 1])); break;
                    case 'CD':
                        if (nextPat === 'CC') {
                            rules.push(makeVRule(5, null, labels.C)); // 6th col vertical, C on top
                        } else if (nextPat === 'BC') {
                            rules.push(makeHRule([4, 5], labels.C, null)); // 5,6 horizontal, C left
                        } else {
                            rules.push(makeHRule([4, 5]));
                            rules.push(makeVRule(5, null, null));
                        }
                        break;
                }
                return rules;
            }

            if (turnIndex === 3) {
                if (prevPat === 'CD') {
                    if (curPat === 'CC') {
                        rules.push(makeVRule(5, null, labels.C));
                        rules.push(makeHRule([3, 4]));
                    } else if (curPat === 'BC') {
                        rules.push(makeHRule([4, 5], labels.C, null));
                    } else if (curPat === 'CD') {
                        rules.push(makeHRule([4, 5]));
                        rules.push(makeVRule(5, null, null));
                    } else {
                        rules.push(makeHRule([4, 5]));
                        rules.push(makeVRule(5, null, null));
                    }
                    return rules;
                }

                switch (curPat) {
                    case 'AA': rules.push(makeHRule([3, 4])); break;
                    case 'AB': rules.push(makeVRule(3, labels.A, null)); break;
                    case 'AC': rules.push(makeVRule(1, labels.C, null)); break;
                    case 'BB': rules.push(makeVRule(3, null, null)); break;
                    case 'BC': rules.push(makeVRule(3, labels.C, null)); break;
                    case 'CC': rules.push(makeHRule([0, 1])); break;
                    case 'CD': rules.push(makeHRule([4, 5])); rules.push(makeVRule(5, null, null)); break;
                    default:
                        rules.push(makeHRule([4, 5]));
                        rules.push(makeVRule(5, null, null));
                }
                return rules;
            }

            return rules;
        }

        // ---------------- ABAB / AABB ----------------
        if (family === 'ABAB' || family === 'AABB') {
            if (turnIndex === 0) {
                if (family === 'AABB') {
                    rules.push(makeHRule([0, 1])); // AA -> 1,2 horizontal
                } else {
                    // ABAB initial two orientations
                    rules.push(makeVRule(0, labels.A, null));
                    rules.push(makeVRule(0, labels.B, null));
                }
                return rules;
            }

            if (turnIndex === 1) {
                if (family === 'AABB') {
                    rules.push(makeHRule([0, 1])); // BB -> 1,2 horizontal
                } else {
                    rules.push(makeVRule(1, labels.A, null));
                    rules.push(makeVRule(1, labels.B, null));
                }
                return rules;
            }

            if (turnIndex === 2) {
                if (curPat === 'AA') rules.push(makeHRule([3, 4]));
                else if (curPat === 'AB') rules.push(makeHRule([0, 1], null, labels.A));
                else if (curPat === 'AC') rules.push(makeVRule(2, labels.C, null));
                else if (curPat === 'BB') rules.push(makeHRule([3, 4]));
                else if (curPat === 'BC') rules.push(makeVRule(0, labels.B, null));
                else if (curPat === 'CC') rules.push(makeHRule([3, 4]));
                else if (curPat === 'CD') {
                    rules.push(makeHRule([4, 5]));
                    rules.push(makeVRule(5, null, null));
                }
                return rules;
            }

            if (turnIndex === 3) {
                if (curPat === 'AA' || curPat === 'BB' || curPat === 'CC') {
                    rules.push(makeHRule([3, 4]));
                } else if (curPat === 'AB') {
                    rules.push(makeHRule([0, 1], null, labels.A));
                } else if (curPat === 'AC') {
                    rules.push(makeVRule(2, labels.C, null));
                } else if (curPat === 'BC') {
                    rules.push(makeVRule(0, labels.B, null));
                } else if (curPat === 'CD') {
                    rules.push(makeHRule([4, 5]));
                    rules.push(makeVRule(5, null, null));
                } else {
                    rules.push(makeHRule([4, 5]));
                    rules.push(makeVRule(5, null, null));
                }
                return rules;
            }

            return rules;
        }

        // ---------------- ABAC ----------------
        if (family === 'ABAC') {
            if (turnIndex === 0) {
                // two opening shapes
                rules.push(makeHRule([1, 2], labels.A, labels.B)); // A-left, 2,3 horizontal
                rules.push(makeVRule(0, labels.A, labels.B));      // A-down, 1st column vertical
                return rules;
            }

            if (turnIndex === 1) {
                // user summary exact groups
                if (curPat === 'AA' || curPat === 'AD' || curPat === 'BC' || curPat === 'DD') {
                    if (curPat === 'AA') rules.push(makeHRule([2, 3]));
                    if (curPat === 'AD') rules.push(makeHRule([2, 3], labels.A, null));
                    if (curPat === 'BC') rules.push(makeVRule(3, labels.B, null));
                    if (curPat === 'DD') rules.push(makeHRule([3, 4]));
                } else if (curPat === 'CC' || curPat === 'BD') {
                    if (curPat === 'CC') rules.push(makeHRule([0, 1]));
                    if (curPat === 'BD') rules.push(makeVRule(0, labels.B, null));
                } else if (curPat === 'CD' || curPat === 'AC' || curPat === 'AB' || curPat === 'BB') {
                    if (curPat === 'CD') rules.push(makeVRule(3, null, labels.C));
                    if (curPat === 'AC') rules.push(makeVRule(2, labels.A, null));
                    if (curPat === 'AB') rules.push(makeHRule([1, 2], labels.A, null));
                    if (curPat === 'BB') rules.push(makeHRule([0, 1]));
                } else {
                    rules.push(makeHRule([1, 2], labels.A, labels.B));
                    rules.push(makeVRule(0, labels.A, labels.B));
                }
                return rules;
            }

            if (turnIndex === 2) {
                if (curPat === 'AA' || curPat === 'AD' || curPat === 'BC' || curPat === 'DD') {
                    if (curPat === 'AA') rules.push(makeHRule([2, 3]));
                    if (curPat === 'AD') rules.push(makeHRule([2, 3], labels.A, null));
                    if (curPat === 'BC') rules.push(makeVRule(3, labels.B, null));
                    if (curPat === 'DD') rules.push(makeHRule([3, 4]));
                } else if (curPat === 'CC' || curPat === 'BD') {
                    if (curPat === 'CC') rules.push(makeHRule([0, 1]));
                    if (curPat === 'BD') rules.push(makeVRule(0, labels.B, null));
                } else if (curPat === 'CD' || curPat === 'AC' || curPat === 'AB' || curPat === 'BB') {
                    if (curPat === 'CD') rules.push(makeVRule(3, null, labels.C));
                    if (curPat === 'AC') rules.push(makeVRule(2, labels.A, null));
                    if (curPat === 'AB') rules.push(makeHRule([1, 2], labels.A, null));
                    if (curPat === 'BB') rules.push(makeHRule([0, 1]));
                } else {
                    rules.push(makeHRule([2, 3]));
                    rules.push(makeVRule(3, null, null));
                }
                return rules;
            }

            if (turnIndex === 3) {
                if (curPat === 'AA' || curPat === 'AD' || curPat === 'BC' || curPat === 'DD') {
                    if (curPat === 'AA') rules.push(makeHRule([2, 3]));
                    if (curPat === 'AD') rules.push(makeHRule([2, 3], labels.A, null));
                    if (curPat === 'BC') rules.push(makeVRule(3, labels.B, null));
                    if (curPat === 'DD') rules.push(makeHRule([3, 4]));
                } else if (curPat === 'CC' || curPat === 'BD') {
                    if (curPat === 'CC') rules.push(makeHRule([0, 1]));
                    if (curPat === 'BD') rules.push(makeVRule(0, labels.B, null));
                } else if (curPat === 'CD' || curPat === 'AC' || curPat === 'AB' || curPat === 'BB') {
                    if (curPat === 'CD') rules.push(makeVRule(3, null, labels.C));
                    if (curPat === 'AC') rules.push(makeVRule(2, labels.A, null));
                    if (curPat === 'AB') rules.push(makeHRule([1, 2], labels.A, null));
                    if (curPat === 'BB') rules.push(makeHRule([0, 1]));
                } else {
                    rules.push(makeHRule([3, 4]));
                    rules.push(makeVRule(3, null, null));
                }
                return rules;
            }

            return rules;
        }

        // ---------------- AABC ----------------
        if (family === 'AABC') {
            if (turnIndex === 0) {
                rules.push(makeHRule([0, 1])); // AA -> 1,2 horizontal
                return rules;
            }

            if (turnIndex === 1) {
                if (curPat === 'AB' || curPat === 'BB' || curPat === 'BC' || curPat === 'BD') {
                    rules.push(makeHRule([2, 3], labels.B, labels.C));
                } else if (curPat === 'AA') {
                    rules.push(makeHRule([1, 2]));
                } else if (curPat === 'AD' || curPat === 'DD') {
                    rules.push(makeHRule([2, 3]));
                } else {
                    rules.push(makeHRule([2, 3], labels.B, labels.C));
                }
                return rules;
            }

            if (turnIndex === 2) {
                if (curPat === 'AB') rules.push(makeHRule([4, 5], labels.B, null));
                else if (curPat === 'BB') rules.push(makeHRule([4, 5]));
                else if (curPat === 'BC') rules.push(makeVRule(4, labels.B, null));
                else if (curPat === 'BD') rules.push(makeHRule([4, 5], labels.B, null));
                else if (curPat === 'AA') rules.push(makeHRule([1, 2]));
                else if (curPat === 'AD') rules.push(makeHRule([1, 2], labels.A, null));
                else if (curPat === 'DD') rules.push(makeHRule([0, 1]));
                else {
                    rules.push(makeHRule([4, 5]));
                    rules.push(makeVRule(4, null, null));
                }
                return rules;
            }

            if (turnIndex === 3) {
                if (curPat === 'AB') rules.push(makeHRule([4, 5], labels.B, null));
                else if (curPat === 'BB') rules.push(makeHRule([4, 5]));
                else if (curPat === 'BC') rules.push(makeVRule(4, labels.B, null));
                else if (curPat === 'BD') rules.push(makeHRule([4, 5], labels.B, null));
                else if (curPat === 'AA') rules.push(makeHRule([1, 2]));
                else if (curPat === 'AD') rules.push(makeHRule([1, 2], labels.A, null));
                else if (curPat === 'DD') rules.push(makeHRule([0, 1]));
                else {
                    rules.push(makeHRule([4, 5]));
                    rules.push(makeVRule(4, null, null));
                }
                return rules;
            }

            return rules;
        }

        return rules;
    }

    function evaluateOpeningHypothesis(boardState, pieces, family, labels, turnIndex = 0, rootMove = null) {
        if (turnIndex >= GTR_MAX_PLIES || turnIndex >= pieces.length) {
            return { score: evaluateBoard(boardState), move: rootMove };
        }

        const cur = pieces[turnIndex];
        const rules = gtrRulesForTurn(family, turnIndex, labels, pieces);
        const placements = placementsMatchingRules(boardState, cur, rules);

        if (!placements.length) {
            return { score: -1e15, move: rootMove };
        }

        let best = { score: -1e15, move: rootMove };

        for (const p of placements) {
            const sim = simulateMove(boardState, cur, p.x, p.y, p.rotation);
            if (!sim || !sim.board) continue;

            const nextRoot = rootMove || { x: p.x, y: p.y, rotation: p.rotation };
            const child = evaluateOpeningHypothesis(sim.board, pieces, family, labels, turnIndex + 1, nextRoot);

            const localEval = evaluateBoard(sim.board);
            const chainEval = chainOutcomeValue(sim);

            // keep GTR shape first, then let evaluation prefer seed-rich boards
            const total = localEval + chainEval * 0.01 + child.score * 0.85;

            if (total > best.score) {
                best = { score: total, move: nextRoot };
            }
        }

        return best;
    }

    function openingHypotheses(pieces) {
        const out = [];
        const family = detectFamily(pieces);
        if (!family) return out;

        const labels = buildLabelsForFamily(family, pieces);
        if (!labels) return out;

        out.push({ family, labels });

        return out;
    }

    function isFreshOpeningBoard(boardState) {
        if (!boardState) return false;
        if (typeof countGarbageCells === 'function' && countGarbageCells(boardState) > 0) return false;
        if (findGroups(boardState).length > 0) return false;
        const maxH = Math.max(...columnHeights(boardState));
        return maxH <= 4;
    }

    function countGarbageCells(boardState) {
        const C = getColors();
        let n = 0;
        for (let y = 0; y < getHeight(); y++) {
            for (let x = 0; x < getWidth(); x++) {
                if (boardState[y][x] === C.GARBAGE) n++;
            }
        }
        return n;
    }

    function chooseGTROpeningMove() {
        const b = safeBoard();
        const cur = safeCurrentPuyo();
        if (!b || !cur) return null;
        if (!isFreshOpeningBoard(b)) return null;

        const pieces = readPieces(4);
        if (pieces.length < 2) return null;

        // try all family hypotheses that fit the first two pieces
        const hyps = openingHypotheses(pieces);
        if (!hyps.length) return null;

        let best = { score: -1e15, move: null };

        for (const hyp of hyps) {
            const res = evaluateOpeningHypothesis(cloneBoard(b), pieces, hyp.family, hyp.labels, 0, null);
            if (res && res.move && res.score > best.score) {
                best = res;
            }
        }

        return best.move;
    }

    // ------------------------------------------------------------
    // Main move choice
    // ------------------------------------------------------------
    function chooseBestMove() {
        const gtrMove = chooseGTROpeningMove();
        if (gtrMove) return gtrMove;

        const cur = safeCurrentPuyo();
        const b = safeBoard();
        if (!cur || !b) return null;
        if (typeof gameState !== 'undefined' && gameState !== 'playing') return null;

        const pieces = readPieces(3);
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
                busy = false;
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

    // ------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------
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
        chooseGTROpeningMove,
        evaluateBoard,
        resolveBoard,
        searchBest,
        templateScore,
        seedScore,
        detectFamily,
        buildLabelsForFamily
    };

    // ------------------------------------------------------------
    // Boot
    // ------------------------------------------------------------
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