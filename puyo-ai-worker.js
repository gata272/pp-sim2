/* puyoAI.worker.js
 * Search core for Puyo AI
 * - beam search over current + NEXT1 + NEXT2
 * - pseudo leaf rollout for one extra unknown step
 * - exact simulator score / ojama conversion sync
 */
(() => {
    'use strict';

    const WIDTH = 6;
    const HEIGHT = 14;
    const HIDDEN_ROWS = 2;
    const SEARCH_VISIBLE_HEIGHT = HEIGHT - HIDDEN_ROWS;

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

    const CONFIG = {
        BEAM_WIDTH: 16,
        LEAF_BEAM_WIDTH: 6,
        PSEUDO_BRANCH_LIMIT: 6
    };

    const TEMPLATES = [
        { name: 'gtr_left',   mask: [1, 1, 1, 1, 0, 0], profile: [0, 1, 2, 2, 0, 0], weight: 1.45 },
        { name: 'gtr_right',  mask: [0, 0, 1, 1, 1, 1], profile: [0, 0, 2, 2, 1, 0], weight: 1.45 },
        { name: 'key_stack',  mask: [1, 1, 1, 1, 1, 0], profile: [0, 1, 2, 3, 2, 0], weight: 1.25 },
        { name: 'fron',       mask: [1, 1, 1, 1, 1, 1], profile: [1, 2, 1, 1, 2, 1], weight: 1.10 },
        { name: 'valley',     mask: [1, 1, 1, 1, 1, 1], profile: [2, 1, 0, 0, 1, 2], weight: 1.05 },
        { name: 'stair_left', mask: [1, 1, 1, 0, 0, 0], profile: [0, 1, 2, 0, 0, 0], weight: 0.95 },
        { name: 'stair_right',mask: [0, 0, 0, 1, 1, 1], profile: [0, 0, 0, 2, 1, 0], weight: 0.95 }
    ];

    const TRANS_TABLE = new Map();

    const idx = (x, y) => y * WIDTH + x;
    const get = (board, x, y) => board[idx(x, y)];

    function cloneBoard(board) {
        return new Uint8Array(board);
    }

    function boardKey(board) {
        return board.join('');
    }

    function pieceFromBuffer(buffer, offset) {
        if (!buffer || offset + 1 >= buffer.length) return null;
        const mainColor = buffer[offset] | 0;
        const subColor = buffer[offset + 1] | 0;
        if (!mainColor && !subColor) return null;
        return { mainColor, subColor };
    }

    function pieceCoords(piece, x, y, rotation) {
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

    function canPlace(board, piece, x, y, rotation) {
        const coords = pieceCoords(piece, x, y, rotation);

        for (const c of coords) {
            if (c.x < 0 || c.x >= WIDTH || c.y < 0 || c.y >= HEIGHT) return false;
            if (c.y < SEARCH_VISIBLE_HEIGHT && get(board, c.x, c.y) !== COLORS.EMPTY) return false;
        }
        return true;
    }

    function findRestY(board, piece, x, rotation) {
        let y = HEIGHT - 2;
        if (!canPlace(board, piece, x, y, rotation)) return null;

        while (y > 0 && canPlace(board, piece, x, y - 1, rotation)) {
            y--;
        }
        return y;
    }

    function placements(board, piece) {
        const out = [];
        for (let rot = 0; rot < 4; rot++) {
            for (let x = 0; x < WIDTH; x++) {
                const y = findRestY(board, piece, x, rot);
                if (y !== null) out.push({ x, y, rotation: rot });
            }
        }
        return out;
    }

    function placePiece(board, piece, x, y, rotation) {
        const next = cloneBoard(board);
        const coords = pieceCoords(piece, x, y, rotation);

        for (const c of coords) {
            if (c.x >= 0 && c.x < WIDTH && c.y >= 0 && c.y < HEIGHT) {
                next[idx(c.x, c.y)] = c.color;
            }
        }
        return next;
    }

    function gravity(board) {
        for (let x = 0; x < WIDTH; x++) {
            const col = [];
            for (let y = 0; y < HEIGHT; y++) {
                const v = get(board, x, y);
                if (v !== COLORS.EMPTY) col.push(v);
            }
            for (let y = 0; y < HEIGHT; y++) {
                board[idx(x, y)] = y < col.length ? col[y] : COLORS.EMPTY;
            }
        }
    }

    function findGroups(board) {
        const visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
        const out = [];

        for (let y = 0; y < SEARCH_VISIBLE_HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                const color = get(board, x, y);
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
                            nx >= 0 && nx < WIDTH &&
                            ny >= 0 && ny < SEARCH_VISIBLE_HEIGHT &&
                            !visited[ny][nx] &&
                            get(board, nx, ny) === color
                        ) {
                            visited[ny][nx] = true;
                            stack.push({ x: nx, y: ny });
                        }
                    }
                }

                if (group.length >= 4) out.push({ color, group });
            }
        }

        return out;
    }

    function clearGarbageNeighbors(board, erased) {
        const toClear = new Set();
        for (const p of erased) {
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dx, dy] of dirs) {
                const nx = p.x + dx;
                const ny = p.y + dy;
                if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT) {
                    if (get(board, nx, ny) === COLORS.GARBAGE) toClear.add(`${nx},${ny}`);
                }
            }
        }

        for (const key of toClear) {
            const [x, y] = key.split(',').map(Number);
            board[idx(x, y)] = COLORS.EMPTY;
        }
    }

    function calculateScore(groups, chainNo) {
        let totalPuyos = 0;
        const colorSet = new Set();
        let bonusTotal = 0;

        for (const { color, group } of groups) {
            totalPuyos += group.length;
            colorSet.add(color);
            bonusTotal += BONUS_TABLE.GROUP[Math.min(group.length, BONUS_TABLE.GROUP.length - 1)] || 0;
        }

        const chainIdx = Math.max(0, Math.min(chainNo - 1, BONUS_TABLE.CHAIN.length - 1));
        bonusTotal += BONUS_TABLE.CHAIN[chainIdx] || 0;
        bonusTotal += BONUS_TABLE.COLOR[Math.min(colorSet.size, BONUS_TABLE.COLOR.length - 1)] || 0;

        if (bonusTotal <= 0) bonusTotal = 1;
        return 10 * totalPuyos * bonusTotal;
    }

    function scoreToOjama(score) {
        return Math.floor(Math.max(0, score) / 70);
    }

    function isBoardEmpty(board) {
        for (let i = 0; i < board.length; i++) {
            if (board[i] !== COLORS.EMPTY) return false;
        }
        return true;
    }

    function resolveBoard(board) {
        let chains = 0;
        let totalScore = 0;
        let totalAttack = 0;
        let allClear = false;

        while (true) {
            gravity(board);
            const groups = findGroups(board);
            if (!groups.length) break;

            chains++;
            const chainScore = calculateScore(groups, chains);
            totalScore += chainScore;
            totalAttack += scoreToOjama(chainScore);

            const erased = [];
            for (const { group } of groups) {
                for (const p of group) {
                    board[idx(p.x, p.y)] = COLORS.EMPTY;
                    erased.push(p);
                }
            }
            clearGarbageNeighbors(board, erased);
        }

        gravity(board);

        if (isBoardEmpty(board)) {
            allClear = true;
            totalScore += 2100;
            totalAttack += scoreToOjama(2100);
        }

        return { board, chains, score: totalScore, attack: totalAttack, allClear };
    }

    function computeHeights(board) {
        const heights = new Int16Array(WIDTH);
        for (let x = 0; x < WIDTH; x++) {
            let h = 0;
            for (let y = HEIGHT - 1; y >= 0; y--) {
                if (get(board, x, y) !== COLORS.EMPTY) {
                    h = y + 1;
                    break;
                }
            }
            heights[x] = h;
        }
        return heights;
    }

    function countHoles(board, heights) {
        let holes = 0;
        for (let x = 0; x < WIDTH; x++) {
            for (let y = 0; y < heights[x]; y++) {
                if (get(board, x, y) === COLORS.EMPTY) holes++;
            }
        }
        return holes;
    }

    function bumpiness(heights) {
        let total = 0;
        for (let i = 1; i < WIDTH; i++) {
            total += Math.abs(heights[i] - heights[i - 1]);
        }
        return total;
    }

    function dangerPenalty(board) {
        let penalty = 0;
        const dangerX = 2;
        const dangerY = 11;

        if (get(board, dangerX, dangerY) !== COLORS.EMPTY) {
            penalty += 1000000;
        }

        const heights = computeHeights(board);
        if (heights[dangerX] >= dangerY + 1) penalty += 250000;
        if (heights[dangerX] >= dangerY - 1) penalty += 80000;

        for (let y = Math.max(0, dangerY - 2); y <= dangerY; y++) {
            if (get(board, dangerX, y) !== COLORS.EMPTY) penalty += 25000;
        }

        return penalty;
    }

    function openNeighborCount(board, cells) {
        const seen = new Set();
        let count = 0;
        for (const { x, y } of cells) {
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dx, dy] of dirs) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT && get(board, nx, ny) === COLORS.EMPTY) {
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

    function connectedComponents(board) {
        const visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
        const out = [];

        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                const color = get(board, x, y);
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
                            nx >= 0 && nx < WIDTH &&
                            ny >= 0 && ny < HEIGHT &&
                            !visited[ny][nx] &&
                            get(board, nx, ny) === color
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

    function templateScore(board) {
        const heights = computeHeights(board);
        let best = 0;
        let second = 0;

        for (const t of TEMPLATES) {
            const masked = [];
            for (let x = 0; x < WIDTH; x++) {
                if (t.mask[x]) masked.push(x);
            }
            if (!masked.length) continue;

            let base = Infinity;
            for (const x of masked) {
                base = Math.min(base, heights[x] - t.profile[x]);
            }
            if (!Number.isFinite(base)) continue;

            let score = 0;
            let coverage = 0;
            for (const x of masked) {
                const target = base + t.profile[x];
                const diff = Math.abs(heights[x] - target);
                score += Math.max(0, 12 - diff * 4);
                if (heights[x] > 0) coverage++;
            }

            score += coverage * 3;
            score *= t.weight;

            if (score > best) {
                second = best;
                best = score;
            } else if (score > second) {
                second = score;
            }
        }

        return best + second * 0.5;
    }

    function seedScore(board) {
        const comps = connectedComponents(board);
        let s = 0;
        const colorComponentCounts = [0, 0, 0, 0, 0];

        for (const comp of comps) {
            const size = comp.cells.length;
            const open = openNeighborCount(board, comp.cells);

            if (comp.color >= 1 && comp.color <= 4) {
                colorComponentCounts[comp.color]++;
            }

            if (size === 1) {
                s += 1;
            } else if (size === 2) {
                s += 15 + open * 2;
            } else if (size === 3) {
                s += 45 + open * 4;
            } else if (size === 4) {
                s += 28 + open * 2;
            } else {
                s += Math.min(120, size * 9);
            }
        }

        let fragmentation = 0;
        for (let c = 1; c <= 4; c++) {
            if (colorComponentCounts[c] > 2) fragmentation += (colorComponentCounts[c] - 2) * 6;
        }

        return s - fragmentation;
    }

    function colorBalanceScore(board) {
        const counts = [0, 0, 0, 0, 0];
        for (let i = 0; i < board.length; i++) {
            const v = board[i];
            if (v >= 1 && v <= 4) counts[v]++;
        }

        const sorted = counts.slice(1).sort((a, b) => b - a);
        return (sorted[0] + sorted[1]) * 0.4 - (sorted[2] + sorted[3]) * 0.7;
    }

    function fragmentationPenalty(board) {
        const comps = connectedComponents(board);
        let p = 0;
        for (const comp of comps) {
            if (comp.color === COLORS.GARBAGE || comp.color === COLORS.EMPTY) continue;
            if (comp.cells.length === 1) p += 14;
            else if (comp.cells.length === 2) p += 4;
        }
        return p;
    }

    function evaluateBoard(board, pendingOjama) {
        const heights = computeHeights(board);
        const holes = countHoles(board, heights);
        const maxH = Math.max(...heights);

        let s = 0;
        s += templateScore(board) * 28;
        s += seedScore(board) * 12;
        s += colorBalanceScore(board) * 10;

        s -= holes * 70;
        s -= bumpiness(heights) * 16;
        s -= maxH * 30;
        s -= dangerPenalty(board);
        s -= fragmentationPenalty(board) * 6;
        s -= pendingOjama * 60;

        if (maxH >= HEIGHT - 3) s -= 120;
        if (maxH >= HEIGHT - 2) s -= 260;

        return s;
    }

    function buildPseudoPieces(board) {
        const counts = [0, 0, 0, 0, 0];
        for (let i = 0; i < board.length; i++) {
            const v = board[i];
            if (v >= 1 && v <= 4) counts[v]++;
        }

        const colors = [1, 2, 3, 4]
            .sort((a, b) => counts[b] - counts[a])
            .filter(c => counts[c] > 0);

        while (colors.length < 3) {
            for (let c = 1; c <= 4 && colors.length < 3; c++) {
                if (!colors.includes(c)) colors.push(c);
            }
        }

        const out = [];
        const push = (a, b) => {
            const k = `${a},${b}`;
            if (!out.some(p => p.k === k)) out.push({ k, mainColor: a, subColor: b });
        };

        const pool = colors.slice(0, 3);
        for (const a of pool) {
            push(a, a);
            for (const b of pool) {
                push(a, b);
            }
        }

        for (let a = 1; a <= 4; a++) {
            for (let b = 1; b <= 4; b++) {
                if (out.length >= 6) break;
                push(a, b);
            }
            if (out.length >= 6) break;
        }

        return out.slice(0, 6);
    }

    function chainOutcomeValue(sim, pendingOjama) {
        const chainPart = sim.chains > 0 ? Math.pow(sim.chains, 2.7) * 40000 : 0;
        const scorePart = sim.score * 6;
        const attackLeft = Math.max(0, sim.attack - pendingOjama);
        const cancelPart = Math.min(sim.attack, pendingOjama) * 1200;
        const attackPart = attackLeft * 2600;
        const allClearPart = sim.allClear ? 180000 : 0;
        return chainPart + scorePart + attackPart + cancelPart + allClearPart;
    }

    function leafRollout(board, pendingOjama) {
        let best = evaluateBoard(board, pendingOjama);
        const pseudos = buildPseudoPieces(board);

        for (const piece of pseudos) {
            const placeList = placements(board, piece).slice(0, CONFIG.LEAF_BEAM_WIDTH);
            for (const p of placeList) {
                const sim = simulateMove(board, piece, p.x, p.y, p.rotation, pendingOjama);
                const v = chainOutcomeValue(sim, pendingOjama) + evaluateBoard(sim.board, pendingOjama) * 0.2 + seedScore(sim.board) * 3;
                if (v > best) best = v;
            }
        }

        return best;
    }

    function simulateMove(board, piece, x, y, rotation, pendingOjama) {
        const placed = placePiece(board, piece, x, y, rotation);
        const resolved = resolveBoard(placed, pendingOjama);
        return resolved;
    }

    function search(board, pieces, depth, pendingOjama, memo, stats) {
        const key = `${depth}|${pendingOjama}|${boardKey(board)}|${pieces.map(p => `${p.mainColor}${p.subColor}`).join('|')}`;
        const cached = TRANS_TABLE.get(key);
        if (cached !== undefined) return cached;

        if (depth >= pieces.length) {
            const leaf = leafRollout(board, pendingOjama);
            TRANS_TABLE.set(key, leaf);
            return leaf;
        }

        const piece = pieces[depth];
        const list = placements(board, piece);
        if (!list.length) {
            const fail = -1e18;
            TRANS_TABLE.set(key, fail);
            return fail;
        }

        const nodes = [];
        for (const p of list) {
            const sim = simulateMove(board, piece, p.x, p.y, p.rotation, pendingOjama);
            stats.nodes++;

            const quick =
                chainOutcomeValue(sim, pendingOjama) * 1.0 +
                evaluateBoard(sim.board, pendingOjama) * 0.20 +
                seedScore(sim.board) * 0.10;

            nodes.push({ p, sim, quick });
        }

        nodes.sort((a, b) => b.quick - a.quick);

        const beam = nodes.slice(0, CONFIG.BEAM_WIDTH);
        let best = -1e18;

        for (const node of beam) {
            const child = search(node.sim.board, pieces, depth + 1, pendingOjama, memo, stats);
            const total =
                chainOutcomeValue(node.sim, pendingOjama) +
                child * 0.82 +
                evaluateBoard(node.sim.board, pendingOjama) * 0.18;

            if (total > best) best = total;
        }

        TRANS_TABLE.set(key, best);
        return best;
    }

    function chooseBestMove(state) {
        const board = state.board;
        const pieces = state.pieces;
        const pendingOjama = state.pendingOjama | 0;
        const stats = { nodes: 0 };

        if (!pieces.length || board.length !== WIDTH * HEIGHT) {
            return { move: null, score: -1e18, stats };
        }

        TRANS_TABLE.clear();

        const root = placements(board, pieces[0]);
        if (!root.length) {
            return { move: null, score: -1e18, stats };
        }

        const nodes = [];
        for (const p of root) {
            const sim = simulateMove(board, pieces[0], p.x, p.y, p.rotation, pendingOjama);
            stats.nodes++;

            const child = search(sim.board, pieces, 1, pendingOjama, TRANS_TABLE, stats);
            const total =
                chainOutcomeValue(sim, pendingOjama) +
                child * 0.82 +
                evaluateBoard(sim.board, pendingOjama) * 0.18;

            nodes.push({
                move: { x: p.x, y: p.y, rotation: p.rotation },
                score: total
            });
        }

        nodes.sort((a, b) => b.score - a.score);
        const best = nodes[0] || { move: null, score: -1e18 };

        return {
            move: best.move,
            score: best.score,
            stats
        };
    }

    function simulateSearch(state) {
        const board = state.boardBuffer instanceof Uint8Array ? state.boardBuffer : new Uint8Array(state.boardBuffer);
        const pieceBuffer = state.pieceBuffer instanceof Uint8Array ? state.pieceBuffer : new Uint8Array(state.pieceBuffer);

        const pieces = [];
        for (let i = 0; i < 3; i++) {
            const p = pieceFromBuffer(pieceBuffer, i * 2);
            if (p) pieces.push(p);
        }

        return chooseBestMove({
            board,
            pieces,
            pendingOjama: state.pendingOjama | 0
        });
    }

    self.postMessage({ type: 'ready' });

    self.onmessage = (ev) => {
        const msg = ev.data || {};
        if (msg.type !== 'search') return;

        const start = performance.now();
        try {
            const result = simulateSearch(msg.state);
            const elapsedMs = Math.round(performance.now() - start);

            self.postMessage({
                type: 'result',
                jobId: msg.jobId,
                move: result.move,
                score: result.score,
                stats: {
                    nodes: result.stats.nodes,
                    elapsedMs
                }
            });
        } catch (err) {
            self.postMessage({
                type: 'error',
                jobId: msg.jobId,
                message: err && err.message ? err.message : String(err)
            });
        }
    };
})();