/* puyo-ai-worker.js
 * Pure-JS worker solver
 * - Same heuristic tables / search shape as the pasted AI
 * - No main-thread blocking
 */
'use strict';

const W = 6;
const H = 14;
const HIDDEN_ROWS = 2;
const BOARD_GAMEOVER_X = 2;
const BOARD_GAMEOVER_Y = 11;

const COLORS = {
    EMPTY: 0,
    RED: 1,
    BLUE: 2,
    GREEN: 3,
    YELLOW: 4,
    GARBAGE: 5
};

const BONUS_TABLE = {
    CHAIN: [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512],
    GROUP: [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    COLOR: [0, 0, 3, 6, 12]
};

const AI_CONFIG = {
    SEARCH_DEPTH: 3,
    BEAM_WIDTH: 10,
    PSEUDO_COLORS: [1, 2, 3, 4],
    PSEUDO_BRANCH_LIMIT: 6
};

const TEMPLATE_LIBRARY = [
    { name: 'left_stair',   mask: [1, 1, 1, 1, 0, 0], profile: [0, 1, 2, 3, 0, 0], weight: 1.00 },
    { name: 'right_stair',  mask: [0, 0, 1, 1, 1, 1], profile: [0, 0, 3, 2, 1, 0], weight: 1.00 },
    { name: 'left_gtr',     mask: [1, 1, 1, 1, 1, 0], profile: [0, 1, 2, 2, 1, 0], weight: 1.25 },
    { name: 'right_gtr',    mask: [0, 1, 1, 1, 1, 1], profile: [0, 1, 2, 2, 1, 0], weight: 1.25 },
    { name: 'valley',       mask: [1, 1, 1, 1, 1, 1], profile: [2, 1, 0, 0, 1, 2], weight: 1.10 },
    { name: 'center_tower', mask: [0, 1, 1, 1, 1, 0], profile: [0, 1, 2, 3, 2, 1], weight: 1.05 },
    { name: 'bridge',       mask: [1, 1, 1, 1, 1, 1], profile: [1, 2, 1, 1, 2, 1], weight: 0.95 }
];

function cloneBoard(src) {
    return src.map(row => row.slice());
}

function flatToBoard(flat) {
    const board = [];
    for (let y = 0; y < H; y++) {
        board.push(Array.from(flat.slice(y * W, (y + 1) * W)));
    }
    return board;
}

function piecesFromFlat(flat) {
    const arr = flat instanceof Int32Array ? flat : Int32Array.from(flat || []);
    return [
        { subColor: arr[0] | 0, mainColor: arr[1] | 0 },
        { subColor: arr[2] | 0, mainColor: arr[3] | 0 },
        { subColor: arr[4] | 0, mainColor: arr[5] | 0 }
    ].filter(p => Number.isFinite(p.subColor) && Number.isFinite(p.mainColor));
}

function boardToKey(boardState) {
    return boardState.map(row => row.join('')).join('|');
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

function checkCollision(coords, boardState) {
    for (const p of coords) {
        if (p.x < 0 || p.x >= W || p.y < 0 || p.y >= H) return true;
        if (boardState[p.y][p.x] !== COLORS.EMPTY) return true;
    }
    return false;
}

function canPlace(boardState, piece, x, y, rotation) {
    return !checkCollision(getCoordsFromState({
        mainX: x,
        mainY: y,
        rotation,
        mainColor: piece.mainColor,
        subColor: piece.subColor
    }), boardState);
}

function findRestY(boardState, piece, x, rotation) {
    let y = H - 2;
    if (!canPlace(boardState, piece, x, y, rotation)) return null;
    while (y > 0 && canPlace(boardState, piece, x, y - 1, rotation)) y--;
    return y;
}

function dropPlacements(boardState, piece) {
    const out = [];
    for (let rot = 0; rot < 4; rot++) {
        for (let x = 0; x < W; x++) {
            const y = findRestY(boardState, piece, x, rot);
            if (y !== null) out.push({ x, y, rotation: rot });
        }
    }
    return out;
}

function placePiece(boardState, piece, x, y, rotation) {
    const next = cloneBoard(boardState);
    const coords = getCoordsFromState({
        mainX: x,
        mainY: y,
        rotation,
        mainColor: piece.mainColor,
        subColor: piece.subColor
    });
    for (const c of coords) {
        if (c.x >= 0 && c.x < W && c.y >= 0 && c.y < H) {
            next[c.y][c.x] = c.color;
        }
    }
    return next;
}

function gravityOn(boardState) {
    for (let x = 0; x < W; x++) {
        const col = [];
        for (let y = 0; y < H; y++) {
            if (boardState[y][x] !== COLORS.EMPTY) col.push(boardState[y][x]);
        }
        for (let y = 0; y < H; y++) {
            boardState[y][x] = y < col.length ? col[y] : COLORS.EMPTY;
        }
    }
}

function findGroups(boardState) {
    const visited = Array.from({ length: H }, () => Array(W).fill(false));
    const groups = [];

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
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
    const toClear = new Set();

    for (const { x, y } of erasedCoords) {
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dy] of dirs) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
                if (boardState[ny][nx] === COLORS.GARBAGE) toClear.add(`${nx},${ny}`);
            }
        }
    }

    for (const key of toClear) {
        const [x, y] = key.split(',').map(Number);
        boardState[y][x] = COLORS.EMPTY;
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
    return 10 * totalPuyos * bonusTotal;
}

function isBoardEmpty(boardState) {
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (boardState[y][x] !== COLORS.EMPTY) return false;
        }
    }
    return true;
}

function resolveBoard(boardState) {
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
                boardState[p.y][p.x] = COLORS.EMPTY;
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
    const heights = Array(W).fill(0);

    for (let x = 0; x < W; x++) {
        let h = 0;
        for (let y = H - 1; y >= 0; y--) {
            if (boardState[y][x] !== COLORS.EMPTY) {
                h = y + 1;
                break;
            }
        }
        heights[x] = h;
    }
    return heights;
}

function countHoles(boardState, heights) {
    let holes = 0;
    for (let x = 0; x < W; x++) {
        for (let y = 0; y < heights[x]; y++) {
            if (boardState[y][x] === COLORS.EMPTY) holes++;
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
    const seen = new Set();
    let count = 0;

    for (const { x, y } of cells) {
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dy] of dirs) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < W && ny >= 0 && ny < H && boardState[ny][nx] === COLORS.EMPTY) {
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
    const visited = Array.from({ length: H }, () => Array(W).fill(false));
    const out = [];

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
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

function seedScore(boardState) {
    const groups = findGroupsLoose(boardState);
    let s = 0;

    for (const g of groups) {
        const size = g.cells.length;
        if (size === 1) s += 1;
        else if (size === 2) s += 12 + openNeighborCount(boardState, g.cells) * 2;
        else if (size === 3) s += 35 + openNeighborCount(boardState, g.cells) * 4;
    }

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const c = boardState[y][x];
            if (c === COLORS.EMPTY || c === COLORS.GARBAGE) continue;

            if (x + 2 < W && boardState[y][x + 1] === c && boardState[y][x + 2] === c) {
                if (
                    (x - 1 >= 0 && boardState[y][x - 1] === COLORS.EMPTY) ||
                    (x + 3 < W && boardState[y][x + 3] === COLORS.EMPTY)
                ) {
                    s += 16;
                }
            }

            if (y + 2 < H && boardState[y + 1][x] === c && boardState[y + 2][x] === c) {
                if (
                    (y - 1 >= 0 && boardState[y - 1][x] === COLORS.EMPTY) ||
                    (y + 3 < H && boardState[y + 3][x] === COLORS.EMPTY)
                ) {
                    s += 16;
                }
            }

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

function templateScore(boardState) {
    const heights = columnHeights(boardState);
    let best1 = 0;
    let best2 = 0;

    for (const t of TEMPLATE_LIBRARY) {
        const masked = [];
        for (let x = 0; x < W; x++) {
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
    const heights = columnHeights(boardState);
    let penalty = 0;

    if (boardState[BOARD_GAMEOVER_Y]?.[BOARD_GAMEOVER_X] !== COLORS.EMPTY) {
        penalty += 1000000;
    }

    if (heights[BOARD_GAMEOVER_X] >= BOARD_GAMEOVER_Y + 1) {
        penalty += 250000;
    }

    if (heights[BOARD_GAMEOVER_X] >= BOARD_GAMEOVER_Y - 1) {
        penalty += 80000;
    }

    for (let y = Math.max(0, BOARD_GAMEOVER_Y - 2); y <= BOARD_GAMEOVER_Y; y++) {
        if (boardState[y]?.[BOARD_GAMEOVER_X] !== COLORS.EMPTY) {
            penalty += 25000;
        }
    }

    return penalty;
}

function evaluateBoard(boardState) {
    const heights = columnHeights(boardState);
    const holes = countHoles(boardState, heights);
    const maxH = Math.max(...heights);
    const rough = bumpiness(heights);

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
    s -= rough * 10;
    s -= maxH * 30;
    s -= dangerPenalty(boardState);

    if (maxH >= H - 3) s -= 120;
    if (maxH >= H - 2) s -= 260;

    const counts = [0, 0, 0, 0, 0];
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
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

function simulateMove(boardState, piece, placement) {
    const placed = placePiece(boardState, piece, placement.x, placement.y, placement.rotation);
    return resolveBoard(placed);
}

function quickPlacementValue(boardState, sim) {
    return evaluateBoard(boardState) + chainOutcomeValue(sim) * 0.01;
}

function leafPseudoDepth4(boardState) {
    let best = evaluateBoard(boardState);

    const allPlays = [];
    for (const color of AI_CONFIG.PSEUDO_COLORS) {
        const dummy = { mainColor: color, subColor: color };
        const ps = dropPlacements(boardState, dummy);

        for (const p of ps) {
            const sim = simulateMove(boardState, dummy, p);
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
        const ret = { score: leafPseudoDepth4(boardState), move: rootMove || null };
        memo.set(key, ret);
        return ret;
    }

    const piece = pieces[depth];
    const allPlacements = dropPlacements(boardState, piece);

    if (!allPlacements.length) {
        const ret = { score: -1e15, move: rootMove || null };
        memo.set(key, ret);
        return ret;
    }

    const candidates = allPlacements.map(p => {
        const sim = simulateMove(boardState, piece, p);
        const quick = quickPlacementValue(sim.board, sim);
        return { ...p, sim, quick };
    }).sort((a, b) => b.quick - a.quick).slice(0, AI_CONFIG.BEAM_WIDTH);

    let best = { score: -1e15, move: rootMove || null };

    for (const c of candidates) {
        const nextRoot = depth === 0 ? { x: c.x, y: c.y, rotation: c.rotation } : rootMove;

        let total;
        if (c.sim.chains > 0) {
            total = chainOutcomeValue(c.sim) + evaluateBoard(c.sim.board) * 0.1;
        } else if (depth + 1 >= pieces.length) {
            total = evaluateBoard(c.sim.board) * 0.25 + leafPseudoDepth4(c.sim.board);
        } else {
            const child = searchBest(c.sim.board, pieces, depth + 1, memo, nextRoot);
            total = evaluateBoard(c.sim.board) * 0.25 + child.score;
        }

        if (total > best.score) {
            best = { score: total, move: nextRoot };
        }
    }

    memo.set(key, best);
    return best;
}

function chooseBestMove(boardFlat, piecesFlat) {
    const b = flatToBoard(boardFlat);
    const pieces = piecesFromFlat(piecesFlat);

    if (!pieces.length) return null;

    const memo = new Map();
    const result = searchBest(b, pieces, 0, memo, null);
    return result.move || null;
}

self.onmessage = (event) => {
    const data = event.data || {};
    if (data.type !== 'solve') return;

    try {
        const boardFlat = data.board instanceof Int32Array ? data.board : Int32Array.from(data.board || []);
        const piecesFlat = data.pieces instanceof Int32Array ? data.pieces : Int32Array.from(data.pieces || []);
        const move = chooseBestMove(boardFlat, piecesFlat);

        self.postMessage({
            type: 'result',
            move
        });
    } catch (err) {
        self.postMessage({
            type: 'error',
            message: err?.message || String(err)
        });
    }
};

self.postMessage({ type: 'ready' });