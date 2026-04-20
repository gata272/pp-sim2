/* puyoAI.js */
(function () {
    'use strict';

    const WIDTH = 6;
    const HEIGHT = 14;
    const HIDDEN_ROWS = 2;

    const MAX_SEARCH_DEPTH = 3;     // 現在 + NEXT1 + NEXT2
    const BEAM_WIDTH = 24;          // 盤面が軽いので少し広め
    const NUISANCE_TARGET_POINTS = 70;
    const MAX_OJAMA_DROP_PER_TURN = 30;
    const ALL_CLEAR_SCORE_BONUS = 2100;

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

    const ROTATION_OFFSETS = [
        [{ x: 0, y: 0 }, { x: 0, y: 1 }],  // 0: main 下 / sub 上
        [{ x: 0, y: 0 }, { x: -1, y: 0 }], // 1: sub 左
        [{ x: 0, y: 0 }, { x: 0, y: -1 }], // 2: sub 下
        [{ x: 0, y: 0 }, { x: 1, y: 0 }]   // 3: sub 右
    ];

    let autoEnabled = false;
    let autoTimer = null;
    let aiInProgress = false;

    function setStatus(text) {
        const el = document.getElementById('ai-status');
        if (el) el.textContent = text;
    }

    function setAutoButtonText() {
        const btn = document.getElementById('ai-auto-button');
        if (btn) btn.textContent = autoEnabled ? 'AI自動: ON' : 'AI自動: OFF';
    }

    function getGameState() {
        if (typeof window.getGameState === 'function') return window.getGameState();
        if (typeof gameState !== 'undefined') return gameState;
        return 'playing';
    }

    function getBoardSnapshot() {
        if (typeof window.getBoardSnapshot === 'function') return window.getBoardSnapshot();
        if (typeof board !== 'undefined') return board.map(row => row.slice());
        return [];
    }

    function getCurrentPuyoState() {
        if (typeof window.getCurrentPuyoState === 'function') return window.getCurrentPuyoState();
        if (typeof currentPuyo !== 'undefined' && currentPuyo) return { ...currentPuyo };
        return null;
    }

    function getUpcomingPairs(count = 2) {
        if (typeof window.getUpcomingPairs === 'function') return window.getUpcomingPairs(count);
        if (typeof nextQueue !== 'undefined' && typeof queueIndex !== 'undefined') {
            return nextQueue.slice(queueIndex, queueIndex + count).map(pair => pair.slice());
        }
        return [];
    }

    function cloneBoard(src) {
        return src.map(row => row.slice());
    }

    function inBounds(x, y) {
        return x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
    }

    function isEmptyBoard(boardState) {
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                if (boardState[y][x] !== COLORS.EMPTY) return false;
            }
        }
        return true;
    }

    function canSpawn(boardState) {
        // 現在のゲームのスポーン位置に合わせる
        const cells = [
            { x: 2, y: HEIGHT - 2 },
            { x: 2, y: HEIGHT - 1 }
        ];
        for (const c of cells) {
            if (!inBounds(c.x, c.y)) return false;
            if (boardState[c.y][c.x] !== COLORS.EMPTY) return false;
        }
        return true;
    }

    function getCoords(mainX, mainY, rotation) {
        const off = ROTATION_OFFSETS[rotation & 3];
        return [
            { x: mainX + off[0].x, y: mainY + off[0].y, kind: 'main' },
            { x: mainX + off[1].x, y: mainY + off[1].y, kind: 'sub' }
        ];
    }

    function canPlace(boardState, coords) {
        for (const p of coords) {
            if (!inBounds(p.x, p.y)) return false;
            if (boardState[p.y][p.x] !== COLORS.EMPTY) return false;
        }
        return true;
    }

    function shuffleInPlace(arr, rng) {
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

    function boardSeed(boardState, pendingOjama, salt = 0) {
        let h = 2166136261 >>> 0;
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                h ^= (boardState[y][x] + 17 * (x + 1) + 131 * (y + 1)) & 0xff;
                h = Math.imul(h, 16777619);
            }
        }
        h ^= pendingOjama + 0x9e3779b9 + salt;
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

    function clearGarbageAround(boardState, erasedCoords) {
        const toClear = new Set();
        for (const p of erasedCoords) {
            const dirs = [
                [0, 1], [0, -1], [1, 0], [-1, 0]
            ];
            for (const [dx, dy] of dirs) {
                const nx = p.x + dx;
                const ny = p.y + dy;
                if (inBounds(nx, ny) && boardState[ny][nx] === COLORS.GARBAGE) {
                    toClear.add(nx + ',' + ny);
                }
            }
        }
        toClear.forEach(key => {
            const [x, y] = key.split(',').map(Number);
            boardState[y][x] = COLORS.EMPTY;
        });
    }

    function findGroups(boardState) {
        const visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
        const groups = [];
        const maxSearchY = HEIGHT - HIDDEN_ROWS; // 現行ロジックに合わせる

        for (let y = 0; y < maxSearchY; y++) {
            for (let x = 0; x < WIDTH; x++) {
                const color = boardState[y][x];
                if (color === COLORS.EMPTY || color === COLORS.GARBAGE || visited[y][x]) continue;

                const stack = [{ x, y }];
                visited[y][x] = true;
                const group = [];

                while (stack.length) {
                    const cur = stack.pop();
                    group.push(cur);

                    const dirs = [
                        [0, 1], [0, -1], [1, 0], [-1, 0]
                    ];
                    for (const [dx, dy] of dirs) {
                        const nx = cur.x + dx;
                        const ny = cur.y + dy;
                        if (
                            nx >= 0 && nx < WIDTH &&
                            ny >= 0 && ny < maxSearchY &&
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

    function calculateScore(groups, chainIndex) {
        let totalPuyos = 0;
        const colorSet = new Set();
        let bonusTotal = 0;

        for (const { group, color } of groups) {
            totalPuyos += group.length;
            colorSet.add(color);
            const idx = Math.min(group.length, BONUS_TABLE.GROUP.length - 1);
            bonusTotal += BONUS_TABLE.GROUP[idx];
        }

        const chainIdx = Math.max(0, Math.min(chainIndex - 1, BONUS_TABLE.CHAIN.length - 1));
        bonusTotal += BONUS_TABLE.CHAIN[chainIdx];

        const colorIdx = Math.min(colorSet.size, BONUS_TABLE.COLOR.length - 1);
        bonusTotal += BONUS_TABLE.COLOR[colorIdx];

        const finalBonus = Math.max(1, bonusTotal);
        return (10 * totalPuyos) * finalBonus;
    }

    function simulateChain(boardState) {
        const b = cloneBoard(boardState);
        let totalScore = 0;
        let chain = 0;
        let totalCleared = 0;

        while (true) {
            simulateGravity(b);
            const groups = findGroups(b);
            if (groups.length === 0) break;

            chain++;
            const gain = calculateScore(groups, chain);
            totalScore += gain;

            const erasedCoords = [];
            for (const { group } of groups) {
                for (const p of group) {
                    b[p.y][p.x] = COLORS.EMPTY;
                    erasedCoords.push(p);
                }
            }

            totalCleared += erasedCoords.length;
            clearGarbageAround(b, erasedCoords);
            simulateGravity(b);
        }

        if (isEmptyBoard(b)) {
            totalScore += ALL_CLEAR_SCORE_BONUS;
        }

        return {
            board: b,
            totalScore,
            chainCount: chain,
            totalCleared,
            allClear: isEmptyBoard(b)
        };
    }

    function countHoles(boardState) {
        let holes = 0;
        for (let x = 0; x < WIDTH; x++) {
            let seenBlock = false;
            for (let y = 0; y < HEIGHT; y++) {
                if (boardState[y][x] !== COLORS.EMPTY) {
                    seenBlock = true;
                } else if (seenBlock) {
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

    function surfaceRoughness(heights) {
        let r = 0;
        for (let x = 0; x < WIDTH - 1; x++) {
            r += Math.abs(heights[x] - heights[x + 1]);
        }
        return r;
    }

    function connectedPotential(boardState) {
        // 2連結・3連結を少しだけ評価する
        const visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
        let score = 0;
        const maxSearchY = HEIGHT - HIDDEN_ROWS;

        for (let y = 0; y < maxSearchY; y++) {
            for (let x = 0; x < WIDTH; x++) {
                const color = boardState[y][x];
                if (color === COLORS.EMPTY || color === COLORS.GARBAGE || visited[y][x]) continue;

                const stack = [{ x, y }];
                visited[y][x] = true;
                let size = 0;

                while (stack.length) {
                    const cur = stack.pop();
                    size++;

                    const dirs = [
                        [0, 1], [0, -1], [1, 0], [-1, 0]
                    ];
                    for (const [dx, dy] of dirs) {
                        const nx = cur.x + dx;
                        const ny = cur.y + dy;
                        if (
                            nx >= 0 && nx < WIDTH &&
                            ny >= 0 && ny < maxSearchY &&
                            !visited[ny][nx] &&
                            boardState[ny][nx] === color
                        ) {
                            visited[ny][nx] = true;
                            stack.push({ x: nx, y: ny });
                        }
                    }
                }

                if (size === 2) score += 3;
                else if (size === 3) score += 8;
                else score += size * 2;
            }
        }

        return score;
    }

    function evaluateBoard(boardState, pendingOjama) {
        const heights = columnHeights(boardState);
        const maxH = Math.max(...heights);
        const holes = countHoles(boardState);
        const rough = surfaceRoughness(heights);
        const potential = connectedPotential(boardState);

        const topDanger = (boardState[HEIGHT - 3] && boardState[HEIGHT - 3][2] !== COLORS.EMPTY) ? 1800 : 0;

        return (
            potential * 10 -
            holes * 16 -
            rough * 5 -
            maxH * 6 -
            pendingOjama * 25 -
            topDanger
        );
    }

    function applyOjamaChunk(boardState, count, seed) {
        const amount = Math.max(0, Math.min(MAX_OJAMA_DROP_PER_TURN, Math.floor(count || 0)));
        if (amount === 0) return { board: boardState, ok: true };

        const b = cloneBoard(boardState);
        const emptyCells = b.reduce((sum, row) => sum + row.filter(c => c === COLORS.EMPTY).length, 0);
        if (amount > emptyCells) {
            return { board: b, ok: false };
        }

        const rng = mulberry32(seed);
        const columns = Array.from({ length: WIDTH }, (_, i) => i);
        let placed = 0;

        while (placed < amount) {
            shuffleInPlace(columns, rng);

            let placedThisRound = false;
            for (const x of columns) {
                if (placed >= amount) break;

                let h = 0;
                for (let y = 0; y < HEIGHT; y++) {
                    if (b[y][x] !== COLORS.EMPTY) h++;
                }

                if (h < HEIGHT) {
                    b[h][x] = COLORS.GARBAGE;
                    placed++;
                    placedThisRound = true;
                    break;
                }
            }

            if (!placedThisRound) {
                return { board: b, ok: false };
            }
        }

        simulateGravity(b);
        return { board: b, ok: true };
    }

    function simulatePlacement(boardState, pair, mainX, rotation) {
        const spawnY = HEIGHT - 2;
        let mainY = spawnY;

        const spawnCoords = getCoords(mainX, mainY, rotation);
        if (!canPlace(boardState, spawnCoords)) return null;

        while (true) {
            const nextCoords = getCoords(mainX, mainY - 1, rotation);
            if (!canPlace(boardState, nextCoords)) break;
            mainY--;
        }

        const finalCoords = getCoords(mainX, mainY, rotation);
        if (!canPlace(boardState, finalCoords)) return null;

        const b = cloneBoard(boardState);
        const mainColor = pair[1];
        const subColor = pair[0];

        for (const p of finalCoords) {
            b[p.y][p.x] = (p.kind === 'main') ? mainColor : subColor;
        }

        // lockPuyo 相当
        simulateGravity(b);
        for (let x = 0; x < WIDTH; x++) {
            b[HEIGHT - 1][x] = COLORS.EMPTY;
        }

        return { board: b, mainX, mainY, rotation };
    }

    function simulateTurn(state, pair, placement, turnDepth) {
        const placed = simulatePlacement(state.board, pair, placement.mainX, placement.rotation);
        if (!placed) return null;

        const chainResult = simulateChain(placed.board);
        let nextBoard = chainResult.board;
        let moveScore = chainResult.totalScore;
        let bestChain = chainResult.chainCount;
        let pending = state.pendingOjama;

        // 自分の攻撃で相殺
        const attackOjama = Math.floor(Math.max(0, moveScore) / NUISANCE_TARGET_POINTS);
        pending = Math.max(0, pending - attackOjama);

        // 次の手の前に、おじゃまを最大 30 個だけ盤面に落とす
        if (pending > 0) {
            const chunk = Math.min(MAX_OJAMA_DROP_PER_TURN, pending);
            const seed = boardSeed(nextBoard, pending, turnDepth * 97 + attackOjama);
            const applied = applyOjamaChunk(nextBoard, chunk, seed);
            if (!applied.ok) {
                return {
                    board: nextBoard,
                    pending: pending - chunk,
                    moveScore,
                    bestChain,
                    dead: true,
                    heuristic: -1e9,
                    placement: { mainX: placement.mainX, rotation: placement.rotation }
                };
            }
            nextBoard = applied.board;
            pending -= chunk;
        }

        if (!canSpawn(nextBoard)) {
            return {
                board: nextBoard,
                pending,
                moveScore,
                bestChain,
                dead: true,
                heuristic: -1e9,
                placement: { mainX: placement.mainX, rotation: placement.rotation }
            };
        }

        const heuristic = evaluateBoard(nextBoard, pending);

        return {
            board: nextBoard,
            pending,
            moveScore,
            bestChain,
            dead: false,
            heuristic,
            placement: { mainX: placement.mainX, rotation: placement.rotation }
        };
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

    function compareNodes(a, b) {
        if (a.dead !== b.dead) return a.dead ? 1 : -1;
        if (a.bestChain !== b.bestChain) return b.bestChain - a.bestChain;
        if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;
        if (a.heuristic !== b.heuristic) return b.heuristic - a.heuristic;
        if (a.pending !== b.pending) return a.pending - b.pending;
        return b.totalCleared - a.totalCleared;
    }

    function searchBestPlan() {
        const current = getCurrentPuyoState();
        if (!current) return null;

        const lookahead = getUpcomingPairs(MAX_SEARCH_DEPTH - 1);
        const sequence = [
            [current.subColor, current.mainColor],
            ...lookahead
        ];

        let beam = [{
            board: getBoardSnapshot(),
            pending: typeof window.getPendingOjama === 'function' ? window.getPendingOjama() : 0,
            totalScore: 0,
            bestChain: 0,
            totalCleared: 0,
            heuristic: evaluateBoard(getBoardSnapshot(), typeof window.getPendingOjama === 'function' ? window.getPendingOjama() : 0),
            dead: false,
            path: []
        }];

        for (let depth = 0; depth < sequence.length; depth++) {
            const pair = sequence[depth];
            const nextCandidates = [];

            for (const node of beam) {
                const placements = enumeratePlacements(node.board, pair);
                for (const placement of placements) {
                    const sim = simulateTurn(node, pair, placement, depth);
                    if (!sim) continue;

                    nextCandidates.push({
                        board: sim.board,
                        pending: sim.pending,
                        totalScore: node.totalScore + sim.moveScore,
                        bestChain: Math.max(node.bestChain, sim.bestChain),
                        totalCleared: node.totalCleared + (sim.bestChain > 0 ? 0 : 0),
                        heuristic: sim.heuristic,
                        dead: sim.dead,
                        path: node.path.concat(sim.placement)
                    });
                }
            }

            if (nextCandidates.length === 0) break;
            nextCandidates.sort(compareNodes);
            beam = nextCandidates.slice(0, BEAM_WIDTH);
        }

        if (beam.length === 0) return null;
        beam.sort(compareNodes);
        return beam[0];
    }

    function executePlan(plan) {
        if (!plan || !plan.path || plan.path.length === 0) return false;
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

    function runAIOnce(fromAuto = false) {
        if (aiInProgress) return false;
        if (document.body.classList.contains('online-match-active')) {
            setStatus('対戦中はAIを停止');
            return false;
        }
        if (getGameState() !== 'playing') return false;

        const current = getCurrentPuyoState();
        if (!current) return false;

        aiInProgress = true;

        try {
            const plan = searchBestPlan();
            if (!plan) {
                setStatus('AI: 手が見つからない');
                aiInProgress = false;
                return false;
            }

            const ok = executePlan(plan);
            setStatus(
                ok
                    ? `AI: chain=${plan.bestChain}, score=${plan.totalScore}`
                    : 'AI: 実行失敗'
            );
            return ok;
        } catch (err) {
            console.error('AI error:', err);
            setStatus('AI: エラー');
            return false;
        } finally {
            aiInProgress = false;
        }
    }

    function tickAutoAI() {
        if (!autoEnabled) return;
        if (aiInProgress) return;
        if (document.body.classList.contains('online-match-active')) return;
        if (getGameState() !== 'playing') return;
        if (!getCurrentPuyoState()) return;
        runAIOnce(true);
    }

    window.runPuyoAI = function () {
        return runAIOnce(false);
    };

    window.requestAIPlay = window.runPuyoAI;

    window.toggleAIAuto = function () {
        autoEnabled = !autoEnabled;
        setAutoButtonText();

        if (autoEnabled) {
            if (!autoTimer) {
                autoTimer = setInterval(tickAutoAI, 120);
            }
            setStatus('AI自動: ON');
            tickAutoAI();
        } else {
            if (autoTimer) {
                clearInterval(autoTimer);
                autoTimer = null;
            }
            setStatus('AI停止');
        }
    };

    function initAI() {
        setAutoButtonText();
        setStatus('AI待機中');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAI);
    } else {
        initAI();
    }
})();