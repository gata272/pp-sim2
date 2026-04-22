/* puyoAI.js
 * PMS/TMS-inspired AI for Puyo Puyo Simulator
 * - Uses current piece + NEXT1 + NEXT2
 * - Beam search with pseudo-depth 4 optimistic extension
 * - Template matching + future-chain seed evaluation
 * - Works with the existing puyoSim.js globals
 */
(function () {
    'use strict';

    // ---------- Settings ----------
    const AI_CONFIG = {
        SEARCH_DEPTH: 3,
        BEAM_WIDTH: 10,
        LEAF_BEAM_WIDTH: 6,
        AUTO_TICK_MS: 120,
        MAX_PLACE_CANDIDATES: 22,
        PSEUDO_COLORS: [1, 2, 3, 4],
        PSEUDO_BRANCH_LIMIT: 6,
        VISUALIZE_DELAY_MS: 0
    };
    // ゲームオーバー直結マス（左から3列目・下から12段目）
    const DANGER_CELL_X = 2;
    const DANGER_CELL_Y = 11; // board[11][2]
    // この列が危険域に入ったときの強ペナルティ
    function dangerPenalty(boardState) {
        const C = getColors();
        const heights = columnHeights(boardState);
        let penalty = 0;
        // そのマス自体が埋まっていたら、最優先で避ける
        if (boardState[DANGER_CELL_Y][DANGER_CELL_X] !== C.EMPTY) {
            penalty += 500000;
        }
        // その列が gameover ラインまで到達しているだけでも強く減点
        if (heights[DANGER_CELL_X] >= DANGER_CELL_Y + 1) {
            penalty += 250000;
        }
        // その列の上部が高いほどさらに減点
        if (heights[DANGER_CELL_X] >= DANGER_CELL_Y - 1) {
            penalty += 80000;
        }
        // 近傍も少しだけ嫌う
        for (let y = Math.max(0, DANGER_CELL_Y - 2); y <= DANGER_CELL_Y; y++) {
            if (boardState[y][DANGER_CELL_X] !== C.EMPTY) {
                penalty += 25000;
            }
        }
        return penalty;
    }

    // Approximate board templates inspired by common chain structures
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
    const noop = () => {};
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
        if (typeof nextQueue !== 'undefined' && Array.isArray(nextQueue)) return nextQueue.map(p => p.slice());
        return [];
    }

    function safeQueueIndex() {
        if (typeof queueIndex !== 'undefined' && Number.isFinite(queueIndex)) return queueIndex;
        return 0;
    }

    function getScoreFn() {
        if (typeof scoreToOjama === 'function') return scoreToOjama;
        return (v) => Math.floor(Math.max(0, v) / 70);
    }

    function getAllClearBonus() {
        if (typeof ALL_CLEAR_SCORE_BONUS !== 'undefined') return ALL_CLEAR_SCORE_BONUS;
        return 2100;
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
        if (!pair) return null;
        if (!Array.isArray(pair) || pair.length < 2) return null;
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
        const coords = [{ x, y, color: piece.mainColor }, { x, y, color: piece.subColor }];
        let sx = x;
        let sy = y;

        if (rotation === 0) sy = y + 1;
        else if (rotation === 1) sx = x - 1;
        else if (rotation === 2) sy = y - 1;
        else if (rotation === 3) sx = x + 1;

        coords[0] = { x, y, color: piece.mainColor };
        coords[1] = { x: sx, y: sy, color: piece.subColor };
        return coords;
    }

    function canPlace(boardState, piece, x, y, rotation) {
        const W = getWidth();
        const H = getHeight();
        const coords = getPieceCoords(piece, x, y, rotation);

        for (const c of coords) {
            if (c.x < 0 || c.x >= W || c.y < 0 || c.y >= H) return false;
            if (boardState[c.y][c.x] !== getColors().EMPTY) return false;
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

    function groupBonus(size) {
        const table = (typeof BONUS_TABLE !== 'undefined' && BONUS_TABLE.GROUP) ? BONUS_TABLE.GROUP : [0,0,0,0,0,2,3,4,5,6,7,8,9,10,11,12];
        return table[Math.min(size, table.length - 1)] || 0;
    }

    function chainBonus(chainNo) {
        const table = (typeof BONUS_TABLE !== 'undefined' && BONUS_TABLE.CHAIN) ? BONUS_TABLE.CHAIN : [0,8,16,32,64,96,128,160,192,224,256,288,320,352,384,416,448,480,512];
        const idx = Math.max(0, Math.min(chainNo - 1, table.length - 1));
        return table[idx] || 0;
    }

    function colorBonus(colorCount) {
        const table = (typeof BONUS_TABLE !== 'undefined' && BONUS_TABLE.COLOR) ? BONUS_TABLE.COLOR : [0,0,3,6,12];
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
        const scoreFn = getScoreFn();
        const acBonus = getAllClearBonus();

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

        const empty = isBoardEmpty(boardState);
        let allClear = false;
        if (empty) {
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
        const W = getWidth();
        const C = getColors();
        let holes = 0;

        for (let x = 0; x < W; x++) {
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

    function seedScore(boardState) {
        const groups = findGroupsLoose(boardState);
        let s = 0;

        for (const g of groups) {
            const size = g.cells.length;
            if (size === 1) s += 1;
            else if (size === 2) s += 12 + openNeighborCount(boardState, g.cells) * 2;
            else if (size === 3) s += 35 + openNeighborCount(boardState, g.cells) * 4;
        }

        // Horizontal / vertical triples with one missing extension cell
        const W = getWidth();
        const H = getHeight();
        const C = getColors();
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const c = boardState[y][x];
                if (c === C.EMPTY || c === C.GARBAGE) continue;

                // horizontal triple
                if (x + 2 < W && boardState[y][x + 1] === c && boardState[y][x + 2] === c) {
                    if ((x - 1 >= 0 && boardState[y][x - 1] === C.EMPTY) || (x + 3 < W && boardState[y][x + 3] === C.EMPTY)) {
                        s += 16;
                    }
                }

                // vertical triple
                if (y + 2 < H && boardState[y + 1][x] === c && boardState[y + 2][x] === c) {
                    if ((y - 1 >= 0 && boardState[y - 1][x] === C.EMPTY) || (y + 3 < H && boardState[y + 3][x] === C.EMPTY)) {
                        s += 16;
                    }
                }

                // L-shape seed
                if (x + 1 < W && y + 1 < H) {
                    const a = boardState[y][x];
                    const b = boardState[y][x + 1];
                    const d = boardState[y + 1][x];
                    if (a === c && b === c && d === c) s += 20;
                }
            }
        }

        return s;
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

            // Favor patterns that are not too empty
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

    function evaluateBoard(boardState) {
        const heights = columnHeights(boardState);
        const holes = countHoles(boardState, heights);
        const maxH = Math.max(...heights);
        const bumpiness = heights.reduce((sum, h, i) => sum + (i > 0 ? Math.abs(h - heights[i - 1]) : 0), 0);

        let s = 0;

        // structural / template part
        s += templateScore(boardState) * 18;

        // future-chain seed part
        s += seedScore(boardState) * 10;

        // connected-components part
        const comps = findGroupsLoose(boardState);
        for (const g of comps) {
            const size = g.cells.length;
            if (size === 2) s += 10;
            else if (size === 3) s += 30 + openNeighborCount(boardState, g.cells) * 3;
            else if (size >= 5) s += Math.min(80, size * 8);
        }

        // height / roughness penalty
        s -= holes * 38;
        s -= bumpiness * 10;
        s -= maxH * 30;

        // Near-top penalty
        if (maxH >= getHeight() - 3) s -= 120;
        if (maxH >= getHeight() - 2) s -= 260;

        // color balance: favor two dominant colors and avoid four-color clutter
        const counts = [0, 0, 0, 0, 0];
        const C = getColors();
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
        // Make longer chains clearly preferred, but keep setup potential relevant.
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
        const resolved = resolveBoard(placed);
        return resolved;
    }

    function leafPseudoDepth4(boardState) {
        let best = evaluateBoard(boardState) * 1.0;

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
        seedScore
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