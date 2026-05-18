/* puyoAI.js
 * GTR-opening + beam search AI for Puyo Puyo Simulator
 * - First 4 turns: GTR-only policy
 * - After opening: beam search with future-chain evaluation
 * - Uses current piece + NEXT1 + NEXT2
 * - Works with the existing puyoSim.js globals
 */
(function () {
    'use strict';

    // ========= Settings =========
    const AI_CONFIG = {
        AUTO_TICK_MS: 120,
        BEAM_WIDTH: 10,
        LEAF_BRANCH_LIMIT: 6,
        VISUALIZE_DELAY_MS: 0,
        OPENING_TURNS: 4
    };

    const MEMO = new Map();

    let autoEnabled = false;
    let autoTimer = null;
    let busy = false;
    let uiInitialized = false;

    const openingState = {
        turn: 0
    };

    // ========= Safe accessors =========
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

    function safeBoard() {
        return (typeof board !== 'undefined' && Array.isArray(board)) ? board : null;
    }

    function safeCurrentPuyo() {
        return (typeof currentPuyo !== 'undefined' && currentPuyo) ? currentPuyo : null;
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
        if (btn) btn.textContent = autoEnabled ? 'AI自動: ON' : 'AI自動: OFF';
    }

    function cloneBoard(src) {
        return src.map(row => row.slice());
    }

    function boardToKey(b) {
        return b.map(row => row.join('')).join('|');
    }

    function pieceFromPair(pair) {
        if (!Array.isArray(pair) || pair.length < 2) return null;
        return { subColor: pair[0], mainColor: pair[1] };
    }

    function readPieces() {
        const cur = safeCurrentPuyo();
        if (!cur) return [];
        const q = safeQueue();
        const idx = safeQueueIndex();

        const pieces = [{ mainColor: cur.mainColor, subColor: cur.subColor }];

        for (let i = 0; i < 2; i++) {
            const p = pieceFromPair(q[idx + i]);
            if (p) pieces.push(p);
        }
        return pieces;
    }

    // ========= Geometry =========
    // rotation:
    // 0 = sub above main
    // 1 = sub left of main
    // 2 = sub below main
    // 3 = sub right of main
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

    // ========= Core simulation =========
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

                if (group.length >= 4) groups.push({ color, group });
            }
        }

        return groups;
    }

    function clearGarbageNeighbors(boardState, erasedCoords) {
        const W = getWidth();
        const H = getHeight();
        const C = getColors();
        const toClear = new Set();

        for (const { x, y } of erasedCoords) {
            const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
            for (const [dx, dy] of dirs) {
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

    function isBoardEmpty(boardState) {
        const C = getColors();
        for (let y = 0; y < getHeight(); y++) {
            for (let x = 0; x < getWidth(); x++) {
                if (boardState[y][x] !== C.EMPTY) return false;
            }
        }
        return true;
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
        const scoreFn = (typeof scoreToOjama === 'function')
            ? scoreToOjama
            : (v) => Math.floor(Math.max(0, v) / 70);

        const acBonus = (typeof ALL_CLEAR_SCORE_BONUS !== 'undefined')
            ? ALL_CLEAR_SCORE_BONUS
            : 2100;

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
            totalAttack += scoreFn(chainScore);

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
            totalAttack += scoreFn(acBonus);
        }

        return {
            board: boardState,
            chains: totalChains,
            score: totalScore,
            attack: totalAttack,
            allClear
        };
    }

    function simulateMove(boardState, piece, x, y, rotation) {
        const placed = placePiece(boardState, piece, x, y, rotation);
        return resolveBoard(placed);
    }

    // ========= Evaluation =========
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
            const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
            for (const [dx, dy] of dirs) {
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

    function dangerPenalty(boardState) {
        const C = getColors();
        const heights = columnHeights(boardState);

        let penalty = 0;
        const x = 2;
        const y = 11;

        if (boardState[y][x] !== C.EMPTY) penalty += 1000000;
        if (heights[x] >= y + 1) penalty += 250000;
        if (heights[x] >= y - 1) penalty += 80000;

        for (let yy = Math.max(0, y - 2); yy <= y; yy++) {
            if (boardState[yy][x] !== C.EMPTY) penalty += 25000;
        }

        return penalty;
    }

    const TEMPLATE_LIBRARY = [
        { name: 'left_stair',   mask: [1, 1, 1, 1, 0, 0], profile: [0, 1, 2, 3, 0, 0], weight: 1.00 },
        { name: 'right_stair',  mask: [0, 0, 1, 1, 1, 1], profile: [0, 0, 3, 2, 1, 0], weight: 1.00 },
        { name: 'left_gtr',     mask: [1, 1, 1, 1, 1, 0], profile: [0, 1, 2, 2, 1, 0], weight: 1.25 },
        { name: 'right_gtr',    mask: [0, 1, 1, 1, 1, 1], profile: [0, 1, 2, 2, 1, 0], weight: 1.25 },
        { name: 'valley',       mask: [1, 1, 1, 1, 1, 1], profile: [2, 1, 0, 0, 1, 2], weight: 1.10 },
        { name: 'center_tower', mask: [0, 1, 1, 1, 1, 0], profile: [0, 1, 2, 3, 2, 1], weight: 1.05 },
        { name: 'bridge',       mask: [1, 1, 1, 1, 1, 1], profile: [1, 2, 1, 1, 2, 1], weight: 0.95 }
    ];

    function templateScore(boardState) {
        const heights = columnHeights(boardState);
        let best1 = 0;
        let best2 = 0;

        for (const t of TEMPLATE_LIBRARY) {
            const masked = [];
            for (let x = 0; x < getWidth(); x++) if (t.mask[x]) masked.push(x);
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
                    if ((x - 1 >= 0 && boardState[y][x - 1] === C.EMPTY) ||
                        (x + 3 < W && boardState[y][x + 3] === C.EMPTY)) {
                        s += 16;
                    }
                }

                if (y + 2 < H && boardState[y + 1][x] === c && boardState[y + 2][x] === c) {
                    if ((y - 1 >= 0 && boardState[y - 1][x] === C.EMPTY) ||
                        (y + 3 < H && boardState[y + 3][x] === C.EMPTY)) {
                        s += 16;
                    }
                }

                if (x + 1 < W && y + 1 < H) {
                    if (boardState[y][x] === c && boardState[y][x + 1] === c && boardState[y + 1][x] === c) {
                        s += 20;
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

    function leafPseudoDepth(boardState) {
        let best = evaluateBoard(boardState);

        const allPlays = [];
        for (const color of [1, 2, 3, 4]) {
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

        const limit = Math.min(AI_CONFIG.LEAF_BRANCH_LIMIT, allPlays.length);
        for (let i = 0; i < limit; i++) {
            const node = allPlays[i];
            let v = node.value;
            if (node.sim.chains === 0) v += evaluateBoard(node.sim.board) * 0.3;
            if (v > best) best = v;
        }

        return best;
    }

    function searchBest(boardState, pieces, depth, memo, rootMove) {
        const key = `${depth}|${boardToKey(boardState)}|${pieces.map(p => `${p.mainColor}${p.subColor}`).join(',')}`;
        if (memo.has(key)) return memo.get(key);

        if (depth >= pieces.length) {
            const score = leafPseudoDepth(boardState);
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
                total = evaluateBoard(c.sim.board) * 0.25 + leafPseudoDepth(c.sim.board);
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

    // ========= Opening (GTR-only) =========
    function colorLettersForPieces(pieces) {
        const map = new Map();
        const letters = ['A', 'B', 'C', 'D'];
        let next = 0;

        function letterOf(color) {
            if (!map.has(color)) {
                map.set(color, letters[Math.min(next, letters.length - 1)]);
                next++;
            }
            return map.get(color);
        }

        return pieces.map(p => ({
            code: `${letterOf(p.subColor)}${letterOf(p.mainColor)}`
        }));
    }

    function openingPatternName(codes) {
        const a = codes[0]?.code || '';
        const b = codes[1]?.code || '';
        const c = codes[2]?.code || '';

        if (a === 'AA' && b.startsWith('A') && b[1] !== 'A') return 'AAAB';
        if (a === 'AA' && b === 'BB') return 'AABB';
        if ((a === 'AB' && b === 'AB') || (a === 'AB' && b === 'BA')) return 'ABAB';
        if (a === 'AB' && b === 'AC') return 'ABAC';
        if (a === 'AA' && (b === 'AB' || b === 'BB' || b === 'BC' || b === 'BD')) return 'AABC';
        if (c === 'BB') return 'AAAB';
        return 'GTR';
    }

    function legalFromSpecs(boardState, piece, specs) {
        for (const spec of specs) {
            const x = spec.x;
            const rot = spec.rotation;
            const y = findRestY(boardState, piece, x, rot);
            if (y !== null) return { x, y, rotation: rot };
        }
        return null;
    }

    function openingSpecs(pattern, turn, codes) {
        const c0 = codes[0]?.code || '';
        const c1 = codes[1]?.code || '';
        const c2 = codes[2]?.code || '';
        const specs = [];

        // 0-based columns:
        // 1,2 -> x=0
        // 2,3 -> x=1
        // 3 -> x=2
        // 4,5 -> x=3
        // 5,6 -> x=4
        // 6 -> x=5

        if (pattern === 'AAAB') {
            if (turn === 0) {
                specs.push({ x: 0, rotation: 3 }); // 1,2 横
                specs.push({ x: 1, rotation: 1 }); // 1,2 横(逆)
            } else if (turn === 1) {
                specs.push({ x: 2, rotation: 0 }); // 3列目, B下
                specs.push({ x: 2, rotation: 2 }); // 3列目, A下(保険)
            } else if (turn === 2) {
                if (c2 === 'AA') {
                    specs.push({ x: 3, rotation: 3 }); // 4,5 横
                } else if (c2 === 'AB') {
                    specs.push({ x: 3, rotation: 2 }); // 4列目, A下
                } else if (c2 === 'AC') {
                    specs.push({ x: 1, rotation: 2 }); // 2列目, C下
                } else if (c2 === 'BB') {
                    specs.push({ x: 3, rotation: 0 }); // 4列目, 縦
                    specs.push({ x: 3, rotation: 2 });
                } else if (c2 === 'BC') {
                    specs.push({ x: 3, rotation: 2 }); // 4列目, C下
                } else if (c2 === 'CC') {
                    specs.push({ x: 0, rotation: 3 }); // 1,2 横
                } else if (c2 === 'CD') {
                    specs.push({ x: 4, rotation: 3 }); // 5,6 横
                    specs.push({ x: 5, rotation: 0 }); // 6列目 縦
                } else {
                    specs.push({ x: 4, rotation: 3 });
                    specs.push({ x: 5, rotation: 0 });
                }
            } else {
                // 4手目: できるだけGTR土台の継続
                if (c2 === 'CC') {
                    specs.push({ x: 3, rotation: 3 }); // 4,5 横
                } else if (c2 === 'BC') {
                    specs.push({ x: 4, rotation: 3 }); // 5,6 横
                } else if (c2 === 'CD') {
                    specs.push({ x: 3, rotation: 3 });
                    specs.push({ x: 5, rotation: 0 });
                } else {
                    specs.push({ x: 3, rotation: 3 });
                    specs.push({ x: 4, rotation: 3 });
                    specs.push({ x: 5, rotation: 0 });
                }
            }
        }

        if (pattern === 'AABB') {
            if (turn === 0) {
                specs.push({ x: 0, rotation: 3 }); // 1,2 横
            } else if (turn === 1) {
                specs.push({ x: 0, rotation: 3 }); // 1,2 横
            } else if (turn === 2) {
                if (c2 === 'AA') {
                    specs.push({ x: 3, rotation: 3 }); // 4,5 横
                } else if (c2 === 'AB') {
                    specs.push({ x: 0, rotation: 3 }); // 1,2 横(A右)
                } else if (c2 === 'AC') {
                    specs.push({ x: 2, rotation: 0 }); // 3列目 C下
                } else if (c2 === 'BB') {
                    specs.push({ x: 3, rotation: 3 }); // 4,5 横
                } else if (c2 === 'BC') {
                    specs.push({ x: 0, rotation: 2 }); // 1列目 B下
                } else if (c2 === 'CC') {
                    specs.push({ x: 3, rotation: 3 }); // 4,5 横
                } else if (c2 === 'CD') {
                    specs.push({ x: 2, rotation: 3 }); // 3,4 横
                    specs.push({ x: 5, rotation: 0 }); // 6列目 縦
                } else {
                    specs.push({ x: 3, rotation: 3 });
                }
            } else {
                if (c2 === 'BC') {
                    specs.push({ x: 2, rotation: 3 }); // 3,4 横
                    specs.push({ x: 4, rotation: 3 }); // 5,6 横
                } else if (c2 === 'CD') {
                    specs.push({ x: 2, rotation: 3 }); // 3,4 横
                    specs.push({ x: 1, rotation: 2 }); // 2列目 縦
                } else if (c2 === 'CC') {
                    specs.push({ x: 3, rotation: 3 }); // 4,5 横
                } else {
                    specs.push({ x: 4, rotation: 3 });
                    specs.push({ x: 5, rotation: 0 });
                }
            }
        }

        if (pattern === 'ABAB') {
            if (turn === 0) {
                specs.push({ x: 0, rotation: 2 }); // 1列目 A下
                specs.push({ x: 0, rotation: 0 }); // 1列目 B下(保険)
            } else if (turn === 1) {
                specs.push({ x: 1, rotation: 2 }); // 2列目 A下
                specs.push({ x: 1, rotation: 0 }); // 2列目 B下
            } else {
                // 3手目以降は GTR の土台へ寄せる
                if (c2 === 'AA') {
                    specs.push({ x: 3, rotation: 3 });
                } else if (c2 === 'AB') {
                    specs.push({ x: 0, rotation: 3 }); // A右
                } else if (c2 === 'AC') {
                    specs.push({ x: 2, rotation: 0 }); // C下
                } else if (c2 === 'BB') {
                    specs.push({ x: 3, rotation: 3 });
                } else if (c2 === 'BC') {
                    specs.push({ x: 0, rotation: 2 }); // B下
                } else if (c2 === 'CC') {
                    specs.push({ x: 3, rotation: 3 });
                } else if (c2 === 'CD') {
                    specs.push({ x: 2, rotation: 3 });
                    specs.push({ x: 5, rotation: 0 });
                } else {
                    specs.push({ x: 3, rotation: 3 });
                }
            }
        }

        if (pattern === 'ABAC') {
            if (turn === 0) {
                specs.push({ x: 1, rotation: 3 }); // 2,3 横（A左）
                specs.push({ x: 0, rotation: 0 }); // 1列目 縦（A下）
            } else if (turn === 1) {
                // 2通りのうち、今の盤面に合うほうを後段で選ぶ
                if (c1 === 'AA' || c1 === 'AD' || c1 === 'BC' || c1 === 'DD') {
                    specs.push({ x: 2, rotation: 3 }); // 3,4 横
                    specs.push({ x: 3, rotation: 2 }); // 4列目 縦
                } else if (c1 === 'CC' || c1 === 'BD') {
                    specs.push({ x: 0, rotation: 3 }); // 1,2 横
                    specs.push({ x: 0, rotation: 2 }); // 1列目 縦
                } else {
                    specs.push({ x: 2, rotation: 3 });
                    specs.push({ x: 0, rotation: 0 });
                }
            } else if (turn === 2) {
                if (c2 === 'AA') {
                    specs.push({ x: 2, rotation: 3 }); // 3,4 横
                } else if (c2 === 'AD') {
                    specs.push({ x: 2, rotation: 3 }); // 3,4 横
                } else if (c2 === 'BC') {
                    specs.push({ x: 3, rotation: 2 }); // 4列目 B下
                } else if (c2 === 'DD') {
                    specs.push({ x: 3, rotation: 3 }); // 4,5 横
                } else if (c2 === 'CC') {
                    specs.push({ x: 0, rotation: 3 }); // 1,2 横
                } else if (c2 === 'BD') {
                    specs.push({ x: 0, rotation: 2 }); // 1列目 B下
                } else if (c2 === 'CD') {
                    specs.push({ x: 3, rotation: 0 }); // 4列目 D下(= main下)
                } else if (c2 === 'AC') {
                    specs.push({ x: 2, rotation: 2 }); // 3列目 A下
                } else if (c2 === 'AB') {
                    specs.push({ x: 1, rotation: 3 }); // 2,3 横
                } else if (c2 === 'BB') {
                    specs.push({ x: 0, rotation: 3 }); // 1,2 横
                } else {
                    specs.push({ x: 2, rotation: 3 });
                    specs.push({ x: 3, rotation: 3 });
                }
            } else {
                specs.push({ x: 3, rotation: 3 });
                specs.push({ x: 4, rotation: 3 });
                specs.push({ x: 5, rotation: 0 });
            }
        }

        if (pattern === 'AABC') {
            if (turn === 0) {
                specs.push({ x: 0, rotation: 3 }); // 1,2 横
            } else if (turn === 1) {
                if (c1 === 'AB') {
                    specs.push({ x: 4, rotation: 1 }); // 5,6 横 (B right)
                } else if (c1 === 'BB') {
                    specs.push({ x: 4, rotation: 3 }); // 5,6 横
                } else if (c1 === 'BC') {
                    specs.push({ x: 4, rotation: 2 }); // 5列目 縦 (B down)
                } else if (c1 === 'BD') {
                    specs.push({ x: 4, rotation: 1 }); // 5,6 横 (B left)
                } else {
                    specs.push({ x: 1, rotation: 3 });
                    specs.push({ x: 4, rotation: 3 });
                }
            } else if (turn === 2) {
                if (c2 === 'AA') {
                    specs.push({ x: 1, rotation: 3 }); // 2,3 横
                } else if (c2 === 'AD') {
                    specs.push({ x: 1, rotation: 3 }); // 2,3 横
                } else if (c2 === 'DD') {
                    specs.push({ x: 0, rotation: 3 }); // 1,2 横
                } else {
                    specs.push({ x: 1, rotation: 3 });
                    specs.push({ x: 3, rotation: 3 });
                }
            } else {
                specs.push({ x: 3, rotation: 3 });
                specs.push({ x: 4, rotation: 3 });
                specs.push({ x: 5, rotation: 0 });
            }
        }

        if (pattern === 'GTR') {
            if (turn === 0) {
                specs.push({ x: 0, rotation: 3 });
                specs.push({ x: 0, rotation: 0 });
            } else if (turn === 1) {
                specs.push({ x: 2, rotation: 0 });
                specs.push({ x: 1, rotation: 3 });
            } else if (turn === 2) {
                specs.push({ x: 3, rotation: 3 });
                specs.push({ x: 3, rotation: 2 });
                specs.push({ x: 4, rotation: 3 });
                specs.push({ x: 5, rotation: 0 });
            } else {
                specs.push({ x: 3, rotation: 3 });
                specs.push({ x: 4, rotation: 3 });
                specs.push({ x: 5, rotation: 0 });
            }
        }

        return specs;
    }

    function openingFallbackSpecs(turn) {
        if (turn === 0) {
            return [
                { x: 0, rotation: 3 },
                { x: 0, rotation: 0 },
                { x: 1, rotation: 3 }
            ];
        }
        if (turn === 1) {
            return [
                { x: 2, rotation: 0 },
                { x: 1, rotation: 3 },
                { x: 0, rotation: 0 }
            ];
        }
        if (turn === 2) {
            return [
                { x: 3, rotation: 3 },
                { x: 3, rotation: 0 },
                { x: 4, rotation: 3 },
                { x: 5, rotation: 0 }
            ];
        }
        return [
            { x: 3, rotation: 3 },
            { x: 4, rotation: 3 },
            { x: 5, rotation: 0 }
        ];
    }

    function chooseOpeningMove() {
        const cur = safeCurrentPuyo();
        const b = safeBoard();
        if (!cur || !b) return null;
        if (openingState.turn >= AI_CONFIG.OPENING_TURNS) return null;

        const pieces = readPieces();
        if (!pieces.length) return null;

        const codes = colorLettersForPieces(pieces);
        const pattern = openingPatternName(codes);

        const turn = openingState.turn;
        const specs = openingSpecs(pattern, turn, codes);
        const allSpecs = specs.concat(openingFallbackSpecs(turn));

        // まず完全一致の候補を優先
        for (const spec of allSpecs) {
            const y = findRestY(b, cur, spec.x, spec.rotation);
            if (y !== null) {
                return { x: spec.x, y, rotation: spec.rotation };
            }
        }

        // 最後の保険: opening の間は seedScore を使わず、
        // GTRっぽい低い列・危険マス回避を優先
        const placements = dropPlacements(b, cur);
        if (!placements.length) return null;

        let best = null;
        let bestScore = -1e18;

        for (const p of placements) {
            const sim = simulateMove(b, cur, p.x, p.y, p.rotation);
            const heights = columnHeights(sim.board);
            const maxH = Math.max(...heights);
            let score = 0;

            // 左側・中央寄りのGTR土台を優先
            if (p.x <= 3) score += 5000;
            if (p.x === 0 || p.x === 1) score += 2500;
            if (p.x === 2 || p.x === 3) score += 1500;

            // 開幕は3つつなぎ種の評価をしない
            score += templateScore(sim.board) * 12;

            // 危険列を強く避ける
            score -= dangerPenalty(sim.board);

            // 高すぎる置き方を避ける
            score -= maxH * 25;

            if (score > bestScore) {
                bestScore = score;
                best = p;
            }
        }

        return best ? { x: best.x, y: best.y, rotation: best.rotation } : null;
    }

    // ========= General search =========
    function chooseBestMove() {
        const cur = safeCurrentPuyo();
        const b = safeBoard();
        if (!cur || !b) return null;
        if (typeof gameState !== 'undefined' && gameState !== 'playing') return null;

        // 開幕4手はGTRのみ
        if (openingState.turn < AI_CONFIG.OPENING_TURNS) {
            const openingMove = chooseOpeningMove();
            return openingMove;
        }

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
                busy = false;
                return;
            }

            applyMove(move);

            const finish = () => {
                if (typeof hardDrop === 'function') hardDrop();
                if (openingState.turn < AI_CONFIG.OPENING_TURNS) openingState.turn++;
                updateStatus('AI実行完了');
                busy = false;
            };

            if (AI_CONFIG.VISUALIZE_DELAY_MS > 0) {
                setTimeout(finish, AI_CONFIG.VISUALIZE_DELAY_MS);
            } else {
                finish();
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

    function resetAIState() {
        openingState.turn = 0;
        MEMO.clear();
        busy = false;
        updateStatus('AI待機中');
        updateAutoButton();
    }

    function initAIUI() {
        if (uiInitialized) return;
        uiInitialized = true;
        updateAutoButton();
        updateStatus('AI待機中');
    }

    // ========= Public API =========
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
        chooseOpeningMove,
        resetAIState
    };

    // ========= Hook reset/rematch =========
    const prevResetGame = window.resetGame;
    window.resetGame = function () {
        if (typeof prevResetGame === 'function') prevResetGame();
        resetAIState();
    };

    if (typeof window.prepareForRematch === 'function') {
        const prevPrepare = window.prepareForRematch;
        window.prepareForRematch = function () {
            if (typeof prevPrepare === 'function') prevPrepare();
            resetAIState();
        };
    }

    // ========= Init =========
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