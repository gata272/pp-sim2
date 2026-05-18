/* puyo-ai-worker.js
 * Search engine for pp-sim2 AI
 * - receives packed board/pieces
 * - beam search on current + NEXT1 + NEXT2
 * - template / seed / danger evaluation
 */
(function () {
    'use strict';

    const DEFAULT_COLORS = {
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

    const CONFIG = {
        BEAM_WIDTH: 14,
        LEAF_BEAM_WIDTH: 8,
        ROOT_CANDIDATE_LIMIT: 24,
        DANGER_X: 2,
        DANGER_Y: 11
    };

    const TEMPLATE_LIBRARY = [
        { name: 'left_stair',   mask: [1, 1, 1, 1, 0, 0], profile: [0, 1, 2, 3, 0, 0], weight: 1.00 },
        { name: 'right_stair',  mask: [0, 0, 1, 1, 1, 1], profile: [0, 0, 3, 2, 1, 0], weight: 1.00 },
        { name: 'left_gtr',     mask: [1, 1, 1, 1, 1, 0], profile: [0, 1, 2, 2, 1, 0], weight: 1.30 },
        { name: 'right_gtr',    mask: [0, 1, 1, 1, 1, 1], profile: [0, 1, 2, 2, 1, 0], weight: 1.30 },
        { name: 'valley',       mask: [1, 1, 1, 1, 1, 1], profile: [2, 1, 0, 0, 1, 2], weight: 1.10 },
        { name: 'center_tower', mask: [0, 1, 1, 1, 1, 0], profile: [0, 1, 2, 3, 2, 1], weight: 1.05 },
        { name: 'bridge',       mask: [1, 1, 1, 1, 1, 1], profile: [1, 2, 1, 1, 2, 1], weight: 0.95 }
    ];

    function C() {
        return typeof self.COLORS !== 'undefined' ? self.COLORS : DEFAULT_COLORS;
    }

    function cloneBoard(src) {
        return src.map(row => row.slice());
    }

    function boardKey(boardState) {
        return boardState.map(row => row.join('')).join('|');
    }

    function unpackState(raw) {
        const width = raw.width | 0;
        const height = raw.height | 0;
        const hiddenRows = (raw.hiddenRows | 0) || 2;

        const flat = raw.boardBuffer instanceof Uint8Array
            ? raw.boardBuffer
            : new Uint8Array(raw.boardBuffer || []);

        const boardState = Array.from({ length: height }, (_, y) => {
            const row = Array(width);
            for (let x = 0; x < width; x++) {
                row[x] = flat[y * width + x] | 0;
            }
            return row;
        });

        const pieceBuffer = raw.pieceBuffer instanceof Uint8Array
            ? raw.pieceBuffer
            : new Uint8Array(raw.pieceBuffer || []);

        const pieces = [];
        for (let i = 0; i < 3; i++) {
            const mainColor = pieceBuffer[i * 2] | 0;
            const subColor = pieceBuffer[i * 2 + 1] | 0;
            if (mainColor > 0 || subColor > 0) {
                pieces.push({ mainColor, subColor });
            }
        }

        return {
            width,
            height,
            hiddenRows,
            boardState,
            pieces,
            pendingOjama: raw.pendingOjama | 0
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

    function canPlace(boardState, piece, x, y, rotation, width, height, hiddenRows) {
        const cells = coordsFromState(piece, x, y, rotation);
        const limitY = height - hiddenRows;

        for (const c of cells) {
            if (c.x < 0 || c.x >= width) return false;
            if (c.y < 0 || c.y >= height) return false;
            if (c.y < limitY && boardState[c.y][c.x] !== C().EMPTY) return false;
        }
        return true;
    }

    function dropY(boardState, piece, x, rotation, width, height, hiddenRows) {
        let y = height - 2;
        if (!canPlace(boardState, piece, x, y, rotation, width, height, hiddenRows)) return null;

        while (y > 0 && canPlace(boardState, piece, x, y - 1, rotation, width, height, hiddenRows)) {
            y--;
        }
        return y;
    }

    function generatePlacements(boardState, piece, width, height, hiddenRows) {
        const placements = [];
        for (let rot = 0; rot < 4; rot++) {
            for (let x = 0; x < width; x++) {
                const y = dropY(boardState, piece, x, rot, width, height, hiddenRows);
                if (y !== null && y !== undefined) {
                    placements.push({ x, y, rotation: rot });
                }
            }
        }
        return placements;
    }

    function placePiece(boardState, piece, x, y, rotation, width, height) {
        const next = cloneBoard(boardState);
        const cells = coordsFromState(piece, x, y, rotation);
        const col = C();

        for (const c of cells) {
            if (c.x >= 0 && c.x < width && c.y >= 0 && c.y < height) {
                next[c.y][c.x] = c.color;
            }
        }
        return next;
    }

    function gravity(boardState, width, height) {
        const col = C();
        for (let x = 0; x < width; x++) {
            const stack = [];
            for (let y = 0; y < height; y++) {
                if (boardState[y][x] !== col.EMPTY) stack.push(boardState[y][x]);
            }
            for (let y = 0; y < height; y++) {
                boardState[y][x] = y < stack.length ? stack[y] : col.EMPTY;
            }
        }
    }

    function findGroups(boardState, width, height) {
        const col = C();
        const visited = Array.from({ length: height }, () => Array(width).fill(false));
        const groups = [];

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const color = boardState[y][x];
                if (color === col.EMPTY || color === col.GARBAGE || visited[y][x]) continue;

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
                            nx >= 0 && nx < width &&
                            ny >= 0 && ny < height &&
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

    function clearGarbageNeighbors(boardState, erasedCoords, width, height) {
        const col = C();
        const toClear = new Set();

        for (const { x, y } of erasedCoords) {
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dx, dy] of dirs) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    if (boardState[ny][nx] === col.GARBAGE) {
                        toClear.add(`${nx},${ny}`);
                    }
                }
            }
        }

        for (const key of toClear) {
            const [x, y] = key.split(',').map(Number);
            boardState[y][x] = col.EMPTY;
        }
    }

    function calculateScore(groups, chainNo) {
        let totalPuyos = 0;
        const colorSet = new Set();
        let bonusTotal = 0;
        const bonus = BONUS_TABLE;

        for (const { color, group } of groups) {
            totalPuyos += group.length;
            colorSet.add(color);
            bonusTotal += bonus.GROUP[Math.min(group.length, bonus.GROUP.length - 1)] || 0;
        }

        const chainIdx = Math.max(0, Math.min(chainNo - 1, bonus.CHAIN.length - 1));
        bonusTotal += bonus.CHAIN[chainIdx] || 0;

        const colorIdx = Math.min(colorSet.size, bonus.COLOR.length - 1);
        bonusTotal += bonus.COLOR[colorIdx] || 0;

        if (bonusTotal <= 0) bonusTotal = 1;
        return (10 * totalPuyos) * bonusTotal;
    }

    function resolveBoard(boardState, width, height) {
        const col = C();
        const next = cloneBoard(boardState);

        let chains = 0;
        let score = 0;
        let attack = 0;

        while (true) {
            gravity(next, width, height);
            const groups = findGroups(next, width, height);
            if (groups.length === 0) break;

            chains++;
            const chainScore = calculateScore(groups, chains);
            score += chainScore;
            attack += Math.floor(Math.max(0, chainScore) / 70);

            const erased = [];
            for (const { group } of groups) {
                for (const p of group) {
                    next[p.y][p.x] = col.EMPTY;
                    erased.push(p);
                }
            }

            clearGarbageNeighbors(next, erased, width, height);
        }

        gravity(next, width, height);

        let allClear = true;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (next[y][x] !== col.EMPTY) {
                    allClear = false;
                    break;
                }
            }
            if (!allClear) break;
        }

        if (allClear) {
            const ac = typeof self.ALL_CLEAR_SCORE_BONUS !== 'undefined' ? self.ALL_CLEAR_SCORE_BONUS : 2100;
            score += ac;
            attack += Math.floor(Math.max(0, ac) / 70);
        }

        return { board: next, chains, score, attack, allClear };
    }

    function columnHeights(boardState, width, height) {
        const col = C();
        const heights = Array(width).fill(0);
        for (let x = 0; x < width; x++) {
            for (let y = height - 1; y >= 0; y--) {
                if (boardState[y][x] !== col.EMPTY) {
                    heights[x] = y + 1;
                    break;
                }
            }
        }
        return heights;
    }

    function countHoles(boardState, heights, width) {
        const col = C();
        let holes = 0;
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < heights[x]; y++) {
                if (boardState[y][x] === col.EMPTY) holes++;
            }
        }
        return holes;
    }

    function openNeighborCount(boardState, cells, width, height) {
        const col = C();
        const seen = new Set();
        let count = 0;

        for (const { x, y } of cells) {
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dx, dy] of dirs) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height && boardState[ny][nx] === col.EMPTY) {
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

    function findGroupsLoose(boardState, width, height) {
        const col = C();
        const visited = Array.from({ length: height }, () => Array(width).fill(false));
        const out = [];

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const color = boardState[y][x];
                if (color === col.EMPTY || color === col.GARBAGE || visited[y][x]) continue;

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
                            nx >= 0 && nx < width &&
                            ny >= 0 && ny < height &&
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

    function dangerPenalty(boardState, width, height, pendingOjama, dangerX, dangerY) {
        const col = C();
        const heights = columnHeights(boardState, width, height);
        let penalty = 0;

        if (boardState[dangerY] && boardState[dangerY][dangerX] !== col.EMPTY) {
            penalty += 1000000;
        }

        if (heights[dangerX] >= dangerY + 1) penalty += 250000;
        if (heights[dangerX] >= dangerY - 1) penalty += 80000;

        for (let yy = Math.max(0, dangerY - 2); yy <= dangerY; yy++) {
            if (boardState[yy] && boardState[yy][dangerX] !== col.EMPTY) {
                penalty += 25000;
            }
        }

        penalty += pendingOjama * 60;
        return penalty;
    }

    function templateScore(boardState, width, height) {
        const heights = columnHeights(boardState, width, height);
        let best1 = 0;
        let best2 = 0;

        for (const t of TEMPLATE_LIBRARY) {
            const masked = [];
            for (let x = 0; x < width; x++) {
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

    function seedScore(boardState, width, height) {
        const groups = findGroupsLoose(boardState, width, height);
        let s = 0;

        for (const g of groups) {
            const size = g.cells.length;
            if (size === 1) s += 1;
            else if (size === 2) s += 12 + openNeighborCount(boardState, g.cells, width, height) * 2;
            else if (size === 3) s += 35 + openNeighborCount(boardState, g.cells, width, height) * 4;
        }

        const col = C();
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const c = boardState[y][x];
                if (c === col.EMPTY || c === col.GARBAGE) continue;

                if (x + 2 < width && boardState[y][x + 1] === c && boardState[y][x + 2] === c) {
                    if (
                        (x - 1 >= 0 && boardState[y][x - 1] === col.EMPTY) ||
                        (x + 3 < width && boardState[y][x + 3] === col.EMPTY)
                    ) {
                        s += 16;
                    }
                }

                if (y + 2 < height && boardState[y + 1][x] === c && boardState[y + 2][x] === c) {
                    if (
                        (y - 1 >= 0 && boardState[y - 1][x] === col.EMPTY) ||
                        (y + 3 < height && boardState[y + 3][x] === col.EMPTY)
                    ) {
                        s += 16;
                    }
                }

                if (x + 1 < width && y + 1 < height) {
                    const a = boardState[y][x];
                    const b = boardState[y][x + 1];
                    const d = boardState[y + 1][x];
                    if (a === c && b === c && d === c) s += 20;
                }
            }
        }

        return s;
    }

    function evaluateBoard(boardState, width, height, pendingOjama, dangerX, dangerY) {
        const heights = columnHeights(boardState, width, height);
        const holes = countHoles(boardState, heights, width);
        const maxH = Math.max(...heights);
        const bumpiness = heights.reduce((sum, h, i) => sum + (i > 0 ? Math.abs(h - heights[i - 1]) : 0), 0);

        let s = 0;
        s += templateScore(boardState, width, height) * 18;
        s += seedScore(boardState, width, height) * 12;

        const comps = findGroupsLoose(boardState, width, height);
        for (const g of comps) {
            const size = g.cells.length;
            if (size === 2) s += 10;
            else if (size === 3) s += 30 + openNeighborCount(boardState, g.cells, width, height) * 3;
            else if (size >= 5) s += Math.min(80, size * 8);
        }

        s -= holes * 38;
        s -= bumpiness * 10;
        s -= maxH * 30;
        s -= dangerPenalty(boardState, width, height, pendingOjama, dangerX, dangerY);

        if (maxH >= height - 3) s -= 120;
        if (maxH >= height - 2) s -= 260;

        const counts = [0, 0, 0, 0, 0];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
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
        const chainPart = Math.pow(sim.chains, 2.25) * 42000;
        const scorePart = sim.score * 9;
        const attackPart = sim.attack * 1800;
        const allClearPart = sim.allClear ? 300000 : 0;
        return chainPart + scorePart + attackPart + allClearPart;
    }

    function quickPlacementValue(sim, width, height, pendingOjama, dangerX, dangerY) {
        return evaluateBoard(sim.board, width, height, pendingOjama, dangerX, dangerY) + chainOutcomeValue(sim) * 0.01;
    }

    function simulateMove(boardState, piece, x, y, rotation, width, height) {
        const placed = placePiece(boardState, piece, x, y, rotation, width, height);
        return resolveBoard(placed, width, height);
    }

    function searchBest(boardState, pieces, depth, pendingOjama, width, height, hiddenRows, rootMove, memo, dangerX, dangerY) {
        const key = `${depth}|${pendingOjama}|${boardKey(boardState)}|${pieces.map(p => `${p.mainColor}${p.subColor}`).join(',')}`;
        if (memo.has(key)) return memo.get(key);

        if (depth >= pieces.length) {
            const score = evaluateBoard(boardState, width, height, pendingOjama, dangerX, dangerY);
            const ret = { score, move: rootMove || null };
            memo.set(key, ret);
            return ret;
        }

        const piece = pieces[depth];
        const placements = generatePlacements(boardState, piece, width, height, hiddenRows);

        if (!placements.length) {
            const ret = { score: -1e15, move: rootMove || null };
            memo.set(key, ret);
            return ret;
        }

        const candidates = [];
        for (const p of placements) {
            const sim = simulateMove(boardState, piece, p.x, p.y, p.rotation, width, height);
            const quick = quickPlacementValue(sim, width, height, pendingOjama, dangerX, dangerY);
            candidates.push({ ...p, sim, quick });
        }

        candidates.sort((a, b) => b.quick - a.quick);
        const beam = candidates.slice(0, CONFIG.BEAM_WIDTH);

        let best = { score: -1e15, move: rootMove || null };

        for (const c of beam) {
            const moveHere = depth === 0
                ? { x: c.x, y: c.y, rotation: c.rotation }
                : rootMove;

            let total = 0;

            if (c.sim.chains > 0) {
                total += chainOutcomeValue(c.sim);
                total += evaluateBoard(c.sim.board, width, height, pendingOjama, dangerX, dangerY) * 0.15;
            } else {
                total += evaluateBoard(c.sim.board, width, height, pendingOjama, dangerX, dangerY) * 0.30;
            }

            if (depth + 1 < pieces.length) {
                const child = searchBest(
                    c.sim.board,
                    pieces,
                    depth + 1,
                    pendingOjama,
                    width,
                    height,
                    hiddenRows,
                    moveHere,
                    memo,
                    dangerX,
                    dangerY
                );
                total += child.score * 0.85;
            }

            if (total > best.score) {
                best = { score: total, move: moveHere };
            }
        }

        memo.set(key, best);
        return best;
    }

    function chooseBestMove(state) {
        const { width, height, hiddenRows, boardState, pieces, pendingOjama } = unpackState(state);
        if (!pieces.length) return null;

        const memo = new Map();
        const result = searchBest(
            boardState,
            pieces,
            0,
            pendingOjama,
            width,
            height,
            hiddenRows,
            null,
            memo,
            CONFIG.DANGER_X,
            CONFIG.DANGER_Y
        );

        return result.move ? { ...result.move, score: result.score } : null;
    }

    self.onmessage = (ev) => {
        const msg = ev.data || {};
        if (msg.type !== 'search') return;

        try {
            const move = chooseBestMove(msg.state || {});
            self.postMessage({
                type: 'result',
                jobId: msg.jobId,
                move
            });
        } catch (err) {
            self.postMessage({
                type: 'error',
                jobId: msg.jobId,
                message: err && err.message ? err.message : String(err)
            });
        }
    };

    self.postMessage({ type: 'ready' });
})();