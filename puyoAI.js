/* puyoAI.js */
(function () {
    'use strict';

    const WIDTH = 6;
    const HEIGHT = 14;
    const HIDDEN_ROWS = 2;
    const MAX_SEARCH_DEPTH = 3;
    const BEAM_WIDTH = 32;
    const AUTO_TICK_MS = 120;
    const MAX_OJAMA_DROP_PER_TURN = 30;
    const NUISANCE_TARGET_POINTS = 70;
    const ALL_CLEAR_SCORE_BONUS = 2100;
    const BOARD_GAMEOVER_CLASS = 'board-gameover';

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

    const OFFSETS = [
        [{ x: 0, y: 0 }, { x: 0, y: 1 }],
        [{ x: 0, y: 0 }, { x: -1, y: 0 }],
        [{ x: 0, y: 0 }, { x: 0, y: -1 }],
        [{ x: 0, y: 0 }, { x: 1, y: 0 }]
    ];

    let autoEnabled = false;
    let autoTimer = null;
    let searchBusy = false;
    let transposition = new Map();

    function getGameState() {
        if (typeof window.getGameState === 'function') return window.getGameState();
        if (typeof gameState !== 'undefined') return gameState;
        return 'playing';
    }

    function getBoard() {
        if (typeof window.getBoardSnapshot === 'function') return window.getBoardSnapshot();
        if (typeof board !== 'undefined') return board.map(row => row.slice());
        return [];
    }

    function getCurrentPuyo() {
        if (typeof window.getCurrentPuyoState === 'function') return window.getCurrentPuyoState();
        if (typeof currentPuyo !== 'undefined' && currentPuyo) return { ...currentPuyo };
        return null;
    }

    function getPendingOjama() {
        if (typeof window.getPendingOjama === 'function') return Math.max(0, Math.floor(Number(window.getPendingOjama()) || 0));
        if (typeof pendingOjama !== 'undefined') return Math.max(0, Math.floor(Number(pendingOjama) || 0));
        return 0;
    }

    function setStatus(text) {
        const el = document.getElementById('ai-status');
        if (el) el.textContent = text;
    }

    function syncButtonText() {
        const btn = document.getElementById('ai-auto-button');
        if (btn) btn.textContent = autoEnabled ? 'AI自動: ON' : 'AI自動: OFF';
    }

    function cloneBoard(src) {
        return src.map(row => row.slice());
    }

    function inBounds(x, y) {
        return x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
    }

    function getCoords(mainX, mainY, rotation) {
        const off = OFFSETS[rotation & 3];
        return [
            { x: mainX + off[0].x, y: mainY + off[0].y, kind: 'main' },
            { x: mainX + off[1].x, y: mainY + off[1].y, kind: 'sub' }
        ];
    }

    function canPlace(boardState, coords) {
        for (const p of coords) {
            if (!inBounds(p.x, p.y)) return false;
            if (p.y < HEIGHT - HIDDEN_ROWS && boardState[p.y][p.x] !== COLORS.EMPTY) return false;
        }
        return true;
    }

    function shuffle(arr, rng) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    function mulberry32(seed) {
        let t = seed >>> 0;
        return function () {
            t += 0x6D2B79F5;
            let r = Math.imul(t ^ (t >>> 15), 1 | t);
            r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
        };
    }

    function seedFrom(boardState, pending, salt = 0) {
        let h = 2166136261 >>> 0;
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                h ^= (boardState[y][x] + 17 * (x + 1) + 131 * (y + 1)) & 0xff;
                h = Math.imul(h, 16777619);
            }
        }
        h ^= (pending + 0x9e3779b9 + salt) >>> 0;
        return h >>> 0;
    }

    function simulateGravity(boardState) {
        for (let x = 0; x < WIDTH; x++) {
            const col = [];
            for (let y = 0; y < HEIGHT; y++) {
                if (boardState[y][x] !== COLORS.EMPTY) col.push(boardState[y][x]);
            }
            for (let y = 0; y < HEIGHT; y++) {
                boardState[y][x] = y < col.length ? col[y] : COLORS.EMPTY;
            }
        }
    }

    function clearGarbage(boardState, erasedCoords) {
        const set = new Set();
        for (const p of erasedCoords) {
            const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
            for (const [dx, dy] of dirs) {
                const nx = p.x + dx;
                const ny = p.y + dy;
                if (inBounds(nx, ny) && boardState[ny][nx] === COLORS.GARBAGE) {
                    set.add(nx + ',' + ny);
                }
            }
        }
        set.forEach(key => {
            const [x, y] = key.split(',').map(Number);
            boardState[y][x] = COLORS.EMPTY;
        });
    }

    function findGroups(boardState) {
        const visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
        const groups = [];
        const maxY = HEIGHT - HIDDEN_ROWS;

        for (let y = 0; y < maxY; y++) {
            for (let x = 0; x < WIDTH; x++) {
                const color = boardState[y][x];
                if (color === COLORS.EMPTY || color === COLORS.GARBAGE || visited[y][x]) continue;

                const stack = [{ x, y }];
                visited[y][x] = true;
                const group = [];

                while (stack.length) {
                    const cur = stack.pop();
                    group.push(cur);
                    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
                    for (const [dx, dy] of dirs) {
                        const nx = cur.x + dx;
                        const ny = cur.y + dy;
                        if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < maxY && !visited[ny][nx] && boardState[ny][nx] === color) {
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

    function calculateScore(groups, chainIndex) {
        let totalPuyos = 0;
        const colorSet = new Set();
        let bonus = 0;

        for (const { group, color } of groups) {
            totalPuyos += group.length;
            colorSet.add(color);
            const idx = Math.min(group.length, BONUS_TABLE.GROUP.length - 1);
            bonus += BONUS_TABLE.GROUP[idx];
        }

        const chainIdx = Math.max(0, Math.min(chainIndex - 1, BONUS_TABLE.CHAIN.length - 1));
        bonus += BONUS_TABLE.CHAIN[chainIdx];

        const colorIdx = Math.min(colorSet.size, BONUS_TABLE.COLOR.length - 1);
        bonus += BONUS_TABLE.COLOR[colorIdx];

        bonus = Math.max(1, Math.min(999, bonus));
        return (10 * totalPuyos) * bonus;
    }

    function isEmptyBoard(boardState) {
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                if (boardState[y][x] !== COLORS.EMPTY) return false;
            }
        }
        return true;
    }

    function resolveChain(boardState) {
        const b = cloneBoard(boardState);
        let totalScore = 0;
        let chains = 0;

        while (true) {
            simulateGravity(b);
            const groups = findGroups(b);
            if (groups.length === 0) break;

            chains++;
            const gained = calculateScore(groups, chains);
            totalScore += gained;

            const erased = [];
            for (const { group } of groups) {
                for (const p of group) {
                    b[p.y][p.x] = COLORS.EMPTY;
                    erased.push(p);
                }
            }

            clearGarbage(b, erased);
            simulateGravity(b);
        }

        if (isEmptyBoard(b)) {
            totalScore += ALL_CLEAR_SCORE_BONUS;
        }

        return {
            board: b,
            totalScore,
            chains,
            allClear: isEmptyBoard(b)
        };
    }

    function countHoles(boardState) {
        let holes = 0;
        for (let x = 0; x < WIDTH; x++) {
            let seen = false;
            for (let y = 0; y < HEIGHT; y++) {
                if (boardState[y][x] !== COLORS.EMPTY) {
                    seen = true;
                } else if (seen) {
                    holes++;
                }
            }
        }
        return holes;
    }

    function columnHeights(boardState) {
        const heights = new Array(WIDTH).fill(0);
        for (let x = 0; x < WIDTH; x++) {
            let h = 0;
            for (let y = 0; y < HEIGHT; y++) {
                if (boardState[y][x] !== COLORS.EMPTY) h = y + 1;
            }
            heights[x] = h;
        }
        return heights;
    }

    function roughness(heights) {
        let r = 0;
        for (let i = 0; i < WIDTH - 1; i++) r += Math.abs(heights[i] - heights[i + 1]);
        return r;
    }

    function adjacencyPotential(boardState) {
        let s = 0;
        const maxY = HEIGHT - HIDDEN_ROWS;
        for (let y = 0; y < maxY; y++) {
            for (let x = 0; x < WIDTH; x++) {
                const c = boardState[y][x];
                if (c === COLORS.EMPTY || c === COLORS.GARBAGE) continue;
                if (x + 1 < WIDTH && boardState[y][x + 1] === c) s += 5;
                if (y + 1 < maxY && boardState[y + 1][x] === c) s += 5;
            }
        }
        return s;
    }

    function groupPotential(boardState) {
        const visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
        const maxY = HEIGHT - HIDDEN_ROWS;
        let score = 0;

        for (let y = 0; y < maxY; y++) {
            for (let x = 0; x < WIDTH; x++) {
                const color = boardState[y][x];
                if (color === COLORS.EMPTY || color === COLORS.GARBAGE || visited[y][x]) continue;

                const stack = [{ x, y }];
                visited[y][x] = true;
                const group = [];
                let touchEmpty = 0;

                while (stack.length) {
                    const cur = stack.pop();
                    group.push(cur);
                    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
                    for (const [dx, dy] of dirs) {
                        const nx = cur.x + dx;
                        const ny = cur.y + dy;
                        if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= maxY) continue;
                        if (boardState[ny][nx] === color && !visited[ny][nx]) {
                            visited[ny][nx] = true;
                            stack.push({ x: nx, y: ny });
                        } else if (boardState[ny][nx] === COLORS.EMPTY) {
                            touchEmpty++;
                        }
                    }
                }

                if (group.length === 2) score += 8 + touchEmpty * 2;
                else if (group.length === 3) score += 20 + touchEmpty * 3;
                else if (group.length >= 4) score += 60 + group.length * 2;
            }
        }

        return score;
    }

    function shapeScore(boardState) {
        const heights = columnHeights(boardState);
        const maxH = Math.max(...heights);
        const holes = countHoles(boardState);
        const rough = roughness(heights);
        const adj = adjacencyPotential(boardState);
        const groups = groupPotential(boardState);
        const center = heights[2] * 2 + heights[3] * 2;
        const sideBalance = Math.abs((heights[0] + heights[1]) - (heights[4] + heights[5]));

        let score = 0;
        score += adj;
        score += groups * 2;
        score -= holes * 18;
        score -= rough * 5;
        score -= maxH * 8;
        score -= sideBalance * 3;
        score -= center * 2;

        if (maxH <= 8) score += 40;
        if (maxH <= 10) score += 20;

        return score;
    }

    function boardDangerPenalty(boardState, pendingOjama) {
        let penalty = 0;
        const heights = columnHeights(boardState);
        const maxH = Math.max(...heights);

        if (boardState[HEIGHT - 3] && boardState[HEIGHT - 3][2] !== COLORS.EMPTY) penalty += 5000;
        if (maxH >= 12) penalty += 3500;
        if (maxH >= 11) penalty += 1800;

        penalty += pendingOjama * 28;
        penalty += countHoles(boardState) * 10;
        return penalty;
    }

    function applyOjamaChunk(boardState, amount, seed) {
        const n = Math.max(0, Math.min(MAX_OJAMA_DROP_PER_TURN, Math.floor(Number(amount) || 0)));
        if (n === 0) return { board: boardState, ok: true };

        const b = cloneBoard(boardState);
        const emptyCells = b.reduce((sum, row) => sum + row.filter(v => v === COLORS.EMPTY).length, 0);
        if (n > emptyCells) return { board: b, ok: false };

        const rng = mulberry32(seed);
        let placed = 0;
        const cols = [0, 1, 2, 3, 4, 5];

        const placeOne = (x) => {
            let h = 0;
            for (let y = 0; y < HEIGHT; y++) {
                if (b[y][x] !== COLORS.EMPTY) h++;
            }
            if (h >= HEIGHT) return false;
            b[h][x] = COLORS.GARBAGE;
            return true;
        };

        while (placed < n) {
            const round = Math.min(WIDTH, n - placed);
            shuffle(cols, rng);
            for (let i = 0; i < round; i++) {
                if (!placeOne(cols[i])) return { board: b, ok: false };
                placed++;
            }
        }

        simulateGravity(b);
        return { board: b, ok: true };
    }

    function simulatePlacement(boardState, pair, mainX, rotation) {
        const spawnY = HEIGHT - 2;
        let mainY = spawnY;
        const mainColor = pair[1];
        const subColor = pair[0];

        const initial = getCoords(mainX, mainY, rotation);
        if (!canPlace(boardState, initial)) return null;

        while (true) {
            const test = getCoords(mainX, mainY - 1, rotation);
            if (!canPlace(boardState, test)) break;
            mainY--;
        }

        const finalCoords = getCoords(mainX, mainY, rotation);
        if (!canPlace(boardState, finalCoords)) return null;

        const b = cloneBoard(boardState);
        for (const p of finalCoords) {
            b[p.y][p.x] = (p.kind === 'main') ? mainColor : subColor;
        }

        simulateGravity(b);
        for (let x = 0; x < WIDTH; x++) b[HEIGHT - 1][x] = COLORS.EMPTY;

        return { board: b, mainX, mainY, rotation };
    }

    function enumeratePlacements(boardState, pair) {
        const list = [];
        for (let rotation = 0; rotation < 4; rotation++) {
            for (let mainX = 0; mainX < WIDTH; mainX++) {
                const sim = simulatePlacement(boardState, pair, mainX, rotation);
                if (sim) list.push({ mainX, rotation });
            }
        }
        return list;
    }

    function boardKey(boardState, pending, depth, pair, scoreHint = 0) {
        return [
            depth,
            pending,
            pair[0],
            pair[1],
            scoreHint,
            boardState.map(row => row.join('')).join('')
        ].join('|');
    }

    function canSpawn(boardState) {
        const coords = [
            { x: 2, y: HEIGHT - 2 },
            { x: 2, y: HEIGHT - 1 }
        ];
        for (const p of coords) {
            if (!inBounds(p.x, p.y)) return false;
            if (boardState[p.y][p.x] !== COLORS.EMPTY) return false;
        }
        return true;
    }

    function simulateTurn(node, pair, placement, depth) {
        const placed = simulatePlacement(node.board, pair, placement.mainX, placement.rotation);
        if (!placed) return null;

        const chainResult = resolveChain(placed.board);
        let nextBoard = chainResult.board;
        let moveScore = chainResult.totalScore;
        let bestChain = chainResult.chains;
        let pending = node.pending;

        const attackOjama = Math.floor(Math.max(0, moveScore) / NUISANCE_TARGET_POINTS);
        pending = Math.max(0, pending - attackOjama);

        if (pending > 0) {
            const dropNow = Math.min(MAX_OJAMA_DROP_PER_TURN, pending);
            const seed = seedFrom(nextBoard, pending, depth * 97 + attackOjama);
            const applied = applyOjamaChunk(nextBoard, dropNow, seed);
            if (!applied.ok) {
                return {
                    board: applied.board,
                    pending: pending - dropNow,
                    moveScore,
                    bestChain,
                    allClear: false,
                    dead: true,
                    heuristic: -1e12,
                    placement: { mainX: placement.mainX, rotation: placement.rotation }
                };
            }
            nextBoard = applied.board;
            pending -= dropNow;
        }

        const dead = boardDangerPenalty(nextBoard, pending) >= 5000 || !canSpawn(nextBoard);
        const heuristic = shapeScore(nextBoard) - boardDangerPenalty(nextBoard, pending);

        return {
            board: nextBoard,
            pending,
            moveScore,
            bestChain,
            allClear: chainResult.allClear,
            dead,
            heuristic,
            placement: { mainX: placement.mainX, rotation: placement.rotation }
        };
    }

    function compareNodes(a, b) {
        if (a.dead !== b.dead) return a.dead ? 1 : -1;
        if (a.bestChain !== b.bestChain) return b.bestChain - a.bestChain;
        if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;
        if (a.allClear !== b.allClear) return a.allClear ? -1 : 1;
        if (a.heuristic !== b.heuristic) return b.heuristic - a.heuristic;
        if (a.pending !== b.pending) return a.pending - b.pending;
        return b.pathScore - a.pathScore;
    }

    function searchBestPlan() {
        const current = getCurrentPuyo();
        if (!current) return null;

        const queue = getUpcomingPairs(2);
        const sequence = [
            [current.subColor, current.mainColor],
            ...queue
        ];

        let beam = [{
            board: getBoard(),
            pending: getPendingOjama(),
            totalScore: 0,
            bestChain: 0,
            allClear: false,
            dead: false,
            heuristic: shapeScore(getBoard()) - boardDangerPenalty(getBoard(), getPendingOjama()),
            path: [],
            pathScore: 0
        }];

        transposition.clear();

        for (let depth = 0; depth < sequence.length; depth++) {
            const pair = sequence[depth];
            const candidates = [];

            for (const node of beam) {
                const placements = enumeratePlacements(node.board, pair);
                for (const placement of placements) {
                    const sim = simulateTurn(node, pair, placement, depth);
                    if (!sim) continue;

                    const pathScore = node.pathScore + sim.moveScore + sim.heuristic;
                    const nextNode = {
                        board: sim.board,
                        pending: sim.pending,
                        totalScore: node.totalScore + sim.moveScore,
                        bestChain: Math.max(node.bestChain, sim.bestChain),
                        allClear: node.allClear || sim.allClear,
                        dead: sim.dead,
                        heuristic: sim.heuristic,
                        path: node.path.concat(sim.placement),
                        pathScore
                    };

                    const key = boardKey(nextNode.board, nextNode.pending, depth, pair, nextNode.bestChain);
                    const prev = transposition.get(key);
                    if (prev !== undefined && prev >= nextNode.pathScore) continue;
                    transposition.set(key, nextNode.pathScore);

                    candidates.push(nextNode);
                }
            }

            if (!candidates.length) break;
            candidates.sort(compareNodes);
            beam = candidates.slice(0, BEAM_WIDTH);
        }

        if (!beam.length) return null;
        beam.sort(compareNodes);
        return beam[0];
    }

    function applyPlan(plan) {
        if (!plan || !plan.path || !plan.path.length) return false;
        const first = plan.path[0];

        if (typeof window.__aiApplyPlacement === 'function') {
            if (!window.__aiApplyPlacement(first.mainX, first.rotation)) return false;
        } else if (typeof currentPuyo !== 'undefined' && currentPuyo) {
            currentPuyo.mainX = first.mainX;
            currentPuyo.mainY = HEIGHT - 2;
            currentPuyo.rotation = first.rotation;
            if (typeof renderBoard === 'function') renderBoard();
        } else {
            return false;
        }

        if (typeof window.hardDrop === 'function') {
            window.hardDrop();
        } else if (typeof hardDrop === 'function') {
            hardDrop();
        } else {
            return false;
        }

        return true;
    }

    function runOnce() {
        if (searchBusy) return false;
        if (document.body.classList.contains('online-match-active')) {
            setStatus('対戦中はAI停止');
            return false;
        }
        if (getGameState() !== 'playing') return false;
        if (!getCurrentPuyo()) return false;

        searchBusy = true;
        try {
            const plan = searchBestPlan();
            if (!plan) {
                setStatus('AI: 候補なし');
                return false;
            }

            const ok = applyPlan(plan);
            setStatus(ok ? `AI: chain=${plan.bestChain}, score=${plan.totalScore}` : 'AI: 実行失敗');
            return ok;
        } catch (err) {
            console.error('AI error:', err);
            setStatus('AI: エラー');
            return false;
        } finally {
            searchBusy = false;
        }
    }

    function tickAuto() {
        if (!autoEnabled) return;
        if (searchBusy) return;
        if (document.body.classList.contains('online-match-active')) return;
        if (getGameState() !== 'playing') return;
        if (!getCurrentPuyo()) return;
        runOnce();
    }

    window.runPuyoAI = function () {
        return runOnce();
    };

    window.requestAIPlay = window.runPuyoAI;

    window.toggleAIAuto = function () {
        autoEnabled = !autoEnabled;
        syncButtonText();
        if (autoEnabled) {
            if (!autoTimer) autoTimer = setInterval(tickAuto, AUTO_TICK_MS);
            setStatus('AI自動: ON');
            tickAuto();
        } else {
            if (autoTimer) {
                clearInterval(autoTimer);
                autoTimer = null;
            }
            setStatus('AI停止');
        }
    };

    window.stopPuyoAI = function () {
        autoEnabled = false;
        syncButtonText();
        if (autoTimer) {
            clearInterval(autoTimer);
            autoTimer = null;
        }
        setStatus('AI停止');
    };

    function init() {
        syncButtonText();
        setStatus('AI待機中');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();