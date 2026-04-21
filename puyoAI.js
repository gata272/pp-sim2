/* puyoAI.js */
(function () {
    'use strict';

    const AI_WIDTH = typeof WIDTH !== 'undefined' ? WIDTH : 6;
    const AI_HEIGHT = typeof HEIGHT !== 'undefined' ? HEIGHT : 14;
    const AI_HIDDEN_ROWS = typeof HIDDEN_ROWS !== 'undefined' ? HIDDEN_ROWS : 2;
    const AI_VISIBLE_MAX_Y = AI_HEIGHT - AI_HIDDEN_ROWS;

    const AI_COLORS = typeof COLORS !== 'undefined' ? COLORS : {
        EMPTY: 0,
        RED: 1,
        BLUE: 2,
        GREEN: 3,
        YELLOW: 4,
        GARBAGE: 5
    };

    const AI_BONUS_TABLE = typeof BONUS_TABLE !== 'undefined' ? BONUS_TABLE : {
        CHAIN: [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512],
        GROUP: [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        COLOR: [0, 0, 3, 6, 12]
    };

    const AI_ALL_CLEAR_BONUS = typeof ALL_CLEAR_SCORE_BONUS !== 'undefined' ? ALL_CLEAR_SCORE_BONUS : 2100;

    const AI_CONFIG = {
        enabled: true,
        beamWidth: 24,
        searchDepth: 3,
        thinkIntervalMs: 60,
        chainPriority: 100000000,
        scorePriority: 100,
        potentialPriority: 1
    };

    let aiBusy = false;
    let aiTimer = null;
    let aiLastHandledPieceRef = null;
    let aiButton = null;

    function getBoard() {
        return typeof board !== 'undefined' && Array.isArray(board) ? board : null;
    }

    function getCurrentPuyo() {
        return typeof currentPuyo !== 'undefined' && currentPuyo ? currentPuyo : null;
    }

    function getGameState() {
        return typeof gameState !== 'undefined' ? gameState : 'unknown';
    }

    function getNextQueueValue() {
        if (typeof nextQueue !== 'undefined' && Array.isArray(nextQueue)) return nextQueue;
        if (typeof window.getNextQueue === 'function') return window.getNextQueue();
        return [];
    }

    function getQueueIndexValue() {
        return typeof queueIndex !== 'undefined' ? queueIndex : 0;
    }

    function cloneBoard(srcBoard) {
        return srcBoard.map(row => row.slice());
    }

    function clonePiece(piece) {
        if (!piece) return null;
        return {
            mainColor: piece.mainColor,
            subColor: piece.subColor,
            mainX: piece.mainX,
            mainY: piece.mainY,
            rotation: piece.rotation
        };
    }

    function getPieceCells(x, y, rotation, piece) {
        const main = { x, y, color: piece.mainColor };
        let subX = x;
        let subY = y;

        if (rotation === 0) subY = y + 1;
        else if (rotation === 1) subX = x - 1;
        else if (rotation === 2) subY = y - 1;
        else if (rotation === 3) subX = x + 1;

        const sub = { x: subX, y: subY, color: piece.subColor };
        return [main, sub];
    }

    function canPlaceAt(boardData, piece, x, y, rotation) {
        const cells = getPieceCells(x, y, rotation, piece);
        for (const cell of cells) {
            if (cell.x < 0 || cell.x >= AI_WIDTH) return false;
            if (cell.y < 0 || cell.y >= AI_HEIGHT) return false;
            if (boardData[cell.y][cell.x] !== AI_COLORS.EMPTY) return false;
        }
        return true;
    }

    function findRestingY(boardData, piece, x, y, rotation) {
        if (!canPlaceAt(boardData, piece, x, y, rotation)) return null;

        let curY = y;
        while (canPlaceAt(boardData, piece, x, curY - 1, rotation)) {
            curY--;
        }
        return curY;
    }

    function moveState(boardData, piece, state, action) {
        if (!state) return null;

        if (action === 'L') {
            const nx = state.x - 1;
            const ny = state.y;
            if (canPlaceAt(boardData, piece, nx, ny, state.rotation)) {
                return { x: nx, y: ny, rotation: state.rotation };
            }
            return null;
        }

        if (action === 'R') {
            const nx = state.x + 1;
            const ny = state.y;
            if (canPlaceAt(boardData, piece, nx, ny, state.rotation)) {
                return { x: nx, y: ny, rotation: state.rotation };
            }
            return null;
        }

        if (action === 'D') {
            const nx = state.x;
            const ny = state.y - 1;
            if (canPlaceAt(boardData, piece, nx, ny, state.rotation)) {
                return { x: nx, y: ny, rotation: state.rotation };
            }
            return null;
        }

        if (action === 'CW' || action === 'CCW') {
            const delta = action === 'CW' ? 1 : -1;
            const newRotation = (state.rotation + delta + 4) % 4;
            const attempts = [[0, 0]];

            if (state.rotation === 0 || state.rotation === 2) {
                if (newRotation === 1) {
                    attempts.push([1, 0], [0, 1]);
                } else if (newRotation === 3) {
                    attempts.push([-1, 0], [0, 1]);
                }
            } else {
                attempts.push([0, 1]);
            }

            for (const [dx, dy] of attempts) {
                const nx = state.x + dx;
                const ny = state.y + dy;
                if (canPlaceAt(boardData, piece, nx, ny, newRotation)) {
                    return { x: nx, y: ny, rotation: newRotation };
                }
            }

            return null;
        }

        return null;
    }

    function enumerateReachableStates(boardData, piece) {
        const start = {
            x: piece.mainX,
            y: piece.mainY,
            rotation: piece.rotation
        };

        const startKey = `${start.x},${start.y},${start.rotation}`;
        const seen = new Map();
        const queue = [{ state: start, key: startKey, depth: 0, parent: null, action: null }];
        seen.set(startKey, queue[0]);

        const actions = ['L', 'R', 'D', 'CW', 'CCW'];

        for (let i = 0; i < queue.length; i++) {
            const cur = queue[i];

            for (const action of actions) {
                const next = moveState(boardData, piece, cur.state, action);
                if (!next) continue;

                const key = `${next.x},${next.y},${next.rotation}`;
                if (!seen.has(key)) {
                    const node = {
                        state: next,
                        key,
                        depth: cur.depth + 1,
                        parent: cur.key,
                        action
                    };
                    seen.set(key, node);
                    queue.push(node);
                }
            }
        }

        return seen;
    }

    function reconstructActions(seenMap, targetKey) {
        const actions = [];
        let cur = seenMap.get(targetKey);

        while (cur && cur.parent !== null) {
            actions.push(cur.action);
            cur = seenMap.get(cur.parent);
        }

        actions.reverse();
        return actions;
    }

    function collectCandidatePlacements(boardData, piece) {
        const seen = enumerateReachableStates(boardData, piece);
        const bestBySignature = new Map();

        for (const node of seen.values()) {
            const { x, y, rotation } = node.state;
            const signature = `${x},${rotation}`;

            const currentBest = bestBySignature.get(signature);
            if (!currentBest || node.state.y > currentBest.state.y || (node.state.y === currentBest.state.y && node.depth < currentBest.depth)) {
                bestBySignature.set(signature, node);
            }
        }

        const candidates = [];
        for (const node of bestBySignature.values()) {
            const { x, y, rotation } = node.state;
            const landingY = findRestingY(boardData, piece, x, y, rotation);
            if (landingY === null) continue;

            candidates.push({
                x,
                y,
                rotation,
                landingY,
                key: node.key,
                actions: reconstructActions(seen, node.key)
            });
        }

        return candidates;
    }

    function clearGarbageAround(boardData, erasedCoords) {
        const toClear = new Set();

        for (const { x, y } of erasedCoords) {
            const neighbors = [
                [0, 1], [0, -1], [1, 0], [-1, 0]
            ];

            for (const [dx, dy] of neighbors) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || nx >= AI_WIDTH || ny < 0 || ny >= AI_HEIGHT) continue;
                if (boardData[ny][nx] === AI_COLORS.GARBAGE) {
                    toClear.add(`${nx},${ny}`);
                }
            }
        }

        for (const key of toClear) {
            const [x, y] = key.split(',').map(Number);
            boardData[y][x] = AI_COLORS.EMPTY;
        }
    }

    function simulateGravity(boardData) {
        for (let x = 0; x < AI_WIDTH; x++) {
            const column = [];
            for (let y = 0; y < AI_HEIGHT; y++) {
                if (boardData[y][x] !== AI_COLORS.EMPTY) {
                    column.push(boardData[y][x]);
                }
            }

            for (let y = 0; y < AI_HEIGHT; y++) {
                boardData[y][x] = y < column.length ? column[y] : AI_COLORS.EMPTY;
            }
        }
    }

    function findConnectedGroups(boardData) {
        const visited = Array.from({ length: AI_HEIGHT }, () => Array(AI_WIDTH).fill(false));
        const groups = [];

        for (let y = 0; y < AI_VISIBLE_MAX_Y; y++) {
            for (let x = 0; x < AI_WIDTH; x++) {
                const color = boardData[y][x];
                if (color === AI_COLORS.EMPTY || color === AI_COLORS.GARBAGE || visited[y][x]) continue;

                const stack = [{ x, y }];
                const group = [];
                visited[y][x] = true;

                while (stack.length > 0) {
                    const cur = stack.pop();
                    group.push(cur);

                    const neighbors = [
                        [0, 1], [0, -1], [1, 0], [-1, 0]
                    ];

                    for (const [dx, dy] of neighbors) {
                        const nx = cur.x + dx;
                        const ny = cur.y + dy;
                        if (nx < 0 || nx >= AI_WIDTH || ny < 0 || ny >= AI_VISIBLE_MAX_Y) continue;
                        if (visited[ny][nx]) continue;
                        if (boardData[ny][nx] !== color) continue;
                        visited[ny][nx] = true;
                        stack.push({ x: nx, y: ny });
                    }
                }

                if (group.length >= 4) {
                    groups.push({ color, group });
                }
            }
        }

        return groups;
    }

    function calculateChainScore(groups, chainNumber) {
        let totalCells = 0;
        const colorSet = new Set();
        let bonusTotal = 0;

        for (const { color, group } of groups) {
            totalCells += group.length;
            colorSet.add(color);

            const groupIdx = Math.min(group.length, AI_BONUS_TABLE.GROUP.length - 1);
            bonusTotal += AI_BONUS_TABLE.GROUP[groupIdx];
        }

        const chainIdx = Math.max(0, Math.min(chainNumber - 1, AI_BONUS_TABLE.CHAIN.length - 1));
        bonusTotal += AI_BONUS_TABLE.CHAIN[chainIdx];

        const colorIdx = Math.min(colorSet.size, AI_BONUS_TABLE.COLOR.length - 1);
        bonusTotal += AI_BONUS_TABLE.COLOR[colorIdx];

        const effectiveBonus = Math.max(1, Math.min(999, bonusTotal));
        return 10 * totalCells * effectiveBonus;
    }

    function checkBoardEmpty(boardData) {
        for (let y = 0; y < AI_HEIGHT; y++) {
            for (let x = 0; x < AI_WIDTH; x++) {
                if (boardData[y][x] !== AI_COLORS.EMPTY) return false;
            }
        }
        return true;
    }

    function resolveAllChains(boardData) {
        const workBoard = cloneBoard(boardData);
        let totalScore = 0;
        let totalChains = 0;

        while (true) {
            simulateGravity(workBoard);
            const groups = findConnectedGroups(workBoard);

            if (groups.length === 0) {
                if (checkBoardEmpty(workBoard)) {
                    totalScore += AI_ALL_CLEAR_BONUS;
                }
                break;
            }

            totalChains++;
            totalScore += calculateChainScore(groups, totalChains);

            const erasedCoords = [];
            for (const { group } of groups) {
                for (const cell of group) {
                    workBoard[cell.y][cell.x] = AI_COLORS.EMPTY;
                    erasedCoords.push(cell);
                }
            }

            clearGarbageAround(workBoard, erasedCoords);
        }

        return {
            board: workBoard,
            score: totalScore,
            chains: totalChains
        };
    }

    function evaluateBoardPotential(boardData) {
        let score = 0;

        for (let x = 0; x < AI_WIDTH; x++) {
            let seenBlock = false;
            let holes = 0;
            let height = 0;

            for (let y = 0; y < AI_HEIGHT; y++) {
                const cell = boardData[y][x];
                if (cell !== AI_COLORS.EMPTY) {
                    seenBlock = true;
                    height = y + 1;
                } else if (seenBlock) {
                    holes++;
                }
            }

            score -= holes * 16;
            score -= height * 2;

            if (height >= AI_HEIGHT - 2) {
                score -= 40;
            }
        }

        for (let y = 0; y < AI_VISIBLE_MAX_Y; y++) {
            for (let x = 0; x < AI_WIDTH; x++) {
                const color = boardData[y][x];
                if (color === AI_COLORS.EMPTY || color === AI_COLORS.GARBAGE) continue;

                if (x + 1 < AI_WIDTH && boardData[y][x + 1] === color) score += 3;
                if (y + 1 < AI_VISIBLE_MAX_Y && boardData[y + 1][x] === color) score += 3;
            }
        }

        const groups = findConnectedGroups(boardData);
        for (const { group } of groups) {
            if (group.length === 2) score += 8;
            else if (group.length === 3) score += 20;
        }

        return score;
    }

    function simulatePlacement(boardData, piece, candidate) {
        const landingY = findRestingY(boardData, piece, candidate.x, candidate.y, candidate.rotation);
        if (landingY === null) return null;

        const workBoard = cloneBoard(boardData);
        const cells = getPieceCells(candidate.x, landingY, candidate.rotation, piece);

        for (const cell of cells) {
            if (cell.x < 0 || cell.x >= AI_WIDTH || cell.y < 0 || cell.y >= AI_HEIGHT) return null;
            if (workBoard[cell.y][cell.x] !== AI_COLORS.EMPTY) return null;
            workBoard[cell.y][cell.x] = cell.color;
        }

        simulateGravity(workBoard);
        const chainResult = resolveAllChains(workBoard);

        return {
            board: chainResult.board,
            score: chainResult.score,
            chains: chainResult.chains,
            landingY
        };
    }

    function buildLookaheadPieces() {
        const pieces = [];
        const current = getCurrentPuyo();
        const queue = getNextQueueValue();
        const index = getQueueIndexValue();

        if (current) {
            pieces.push(clonePiece(current));
        }

        for (let i = 0; i < AI_CONFIG.searchDepth - 1; i++) {
            const pair = queue[index + i];
            if (!pair || !Array.isArray(pair) || pair.length < 2) break;

            pieces.push({
                mainColor: pair[1],
                subColor: pair[0],
                mainX: 2,
                mainY: AI_HEIGHT - 2,
                rotation: 0
            });
        }

        return pieces;
    }

    function searchBestPlan() {
        const boardData = getBoard();
        const current = getCurrentPuyo();

        if (!boardData || !current) return null;

        const pieces = buildLookaheadPieces();
        if (!pieces.length) return null;

        let frontier = [{
            board: cloneBoard(boardData),
            totalScore: 0,
            totalChains: 0,
            totalPotential: evaluateBoardPotential(boardData),
            firstActions: [],
            rank: 0
        }];

        for (let depth = 0; depth < pieces.length; depth++) {
            const piece = pieces[depth];
            const nextFrontier = [];

            for (const node of frontier) {
                const candidates = collectCandidatePlacements(node.board, piece);
                if (!candidates.length) continue;

                for (const candidate of candidates) {
                    const sim = simulatePlacement(node.board, piece, candidate);
                    if (!sim) continue;

                    const newNode = {
                        board: sim.board,
                        totalScore: node.totalScore + sim.score,
                        totalChains: node.totalChains + sim.chains,
                        totalPotential: evaluateBoardPotential(sim.board),
                        firstActions: depth === 0 ? candidate.actions.slice() : node.firstActions.slice()
                    };

                    newNode.rank =
                        (newNode.totalChains * AI_CONFIG.chainPriority) +
                        (newNode.totalScore * AI_CONFIG.scorePriority) +
                        (newNode.totalPotential * AI_CONFIG.potentialPriority);

                    nextFrontier.push(newNode);
                }
            }

            if (!nextFrontier.length) break;

            nextFrontier.sort((a, b) => {
                if (b.rank !== a.rank) return b.rank - a.rank;
                if (b.totalChains !== a.totalChains) return b.totalChains - a.totalChains;
                if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
                return b.totalPotential - a.totalPotential;
            });

            frontier = nextFrontier.slice(0, AI_CONFIG.beamWidth);
        }

        if (!frontier.length) return null;

        frontier.sort((a, b) => {
            if (b.rank !== a.rank) return b.rank - a.rank;
            if (b.totalChains !== a.totalChains) return b.totalChains - a.totalChains;
            if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
            return b.totalPotential - a.totalPotential;
        });

        return frontier[0];
    }

    function performAction(action) {
        if (action === 'L') {
            return typeof movePuyo === 'function' ? movePuyo(-1, 0) : false;
        }
        if (action === 'R') {
            return typeof movePuyo === 'function' ? movePuyo(1, 0) : false;
        }
        if (action === 'D') {
            return typeof movePuyo === 'function' ? movePuyo(0, -1) : false;
        }
        if (action === 'CW') {
            return typeof window.rotatePuyoCW === 'function' ? window.rotatePuyoCW() : false;
        }
        if (action === 'CCW') {
            return typeof window.rotatePuyoCCW === 'function' ? window.rotatePuyoCCW() : false;
        }
        return false;
    }

    function executePlan(plan) {
        if (!plan) return false;

        const current = getCurrentPuyo();
        if (!current) return false;

        for (const action of plan.firstActions) {
            const ok = performAction(action);
            if (!ok) break;
            if (getGameState() !== 'playing' || !getCurrentPuyo()) {
                return true;
            }
        }

        if (getGameState() === 'playing' && getCurrentPuyo()) {
            if (typeof hardDrop === 'function') {
                hardDrop();
                return true;
            }
        }

        return false;
    }

    function updateButtonLabel() {
        if (!aiButton) return;
        aiButton.textContent = AI_CONFIG.enabled ? 'AI: ON' : 'AI: OFF';
    }

    function ensureButton() {
        if (aiButton) return;

        const container = document.getElementById('play-controls');
        if (!container) return;

        aiButton = document.createElement('button');
        aiButton.id = 'ai-button';
        aiButton.type = 'button';
        aiButton.style.width = '100%';
        aiButton.style.padding = '8px';
        aiButton.style.marginTop = '5px';
        aiButton.style.border = 'none';
        aiButton.style.borderRadius = '5px';
        aiButton.style.fontSize = '0.85em';
        aiButton.style.fontWeight = 'bold';
        aiButton.style.backgroundColor = '#ff9800';
        aiButton.style.color = 'white';
        aiButton.style.cursor = 'pointer';
        aiButton.onclick = () => {
            window.puyoAI.toggle();
        };

        container.appendChild(aiButton);
        updateButtonLabel();
    }

    function thinkAndPlay() {
        if (!AI_CONFIG.enabled || aiBusy) return;

        const state = getGameState();
        const current = getCurrentPuyo();
        if (state !== 'playing' || !current) return;
        if (getBoard() === null) return;

        if (current === aiLastHandledPieceRef) return;

        aiBusy = true;
        aiLastHandledPieceRef = current;

        try {
            const plan = searchBestPlan();
            const executed = executePlan(plan);

            if (!executed) {
                if (typeof hardDrop === 'function') {
                    hardDrop();
                }
            }
        } catch (err) {
            console.error('[puyoAI] thinkAndPlay error:', err);
            try {
                if (typeof hardDrop === 'function' && getGameState() === 'playing' && getCurrentPuyo()) {
                    hardDrop();
                }
            } catch (fallbackErr) {
                console.error('[puyoAI] fallback error:', fallbackErr);
            }
        } finally {
            aiBusy = false;
        }
    }

    function startLoop() {
        if (aiTimer) return;
        aiTimer = setInterval(() => {
            if (!AI_CONFIG.enabled) return;
            thinkAndPlay();
        }, AI_CONFIG.thinkIntervalMs);
    }

    function stopLoop() {
        if (!aiTimer) return;
        clearInterval(aiTimer);
        aiTimer = null;
    }

    window.puyoAI = {
        start() {
            AI_CONFIG.enabled = true;
            updateButtonLabel();
            startLoop();
        },
        stop() {
            AI_CONFIG.enabled = false;
            updateButtonLabel();
        },
        toggle() {
            AI_CONFIG.enabled = !AI_CONFIG.enabled;
            updateButtonLabel();
            if (AI_CONFIG.enabled) startLoop();
        },
        thinkNow() {
            thinkAndPlay();
        },
        setBeamWidth(value) {
            const n = Math.max(1, Math.floor(Number(value) || 1));
            AI_CONFIG.beamWidth = n;
        },
        setDepth(value) {
            const n = Math.max(1, Math.min(5, Math.floor(Number(value) || 1)));
            AI_CONFIG.searchDepth = n;
        },
        status() {
            return {
                enabled: AI_CONFIG.enabled,
                busy: aiBusy,
                beamWidth: AI_CONFIG.beamWidth,
                searchDepth: AI_CONFIG.searchDepth
            };
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        ensureButton();
        updateButtonLabel();
        startLoop();
    });

    if (document.readyState !== 'loading') {
        ensureButton();
        updateButtonLabel();
        startLoop();
    }

    window.addEventListener('beforeunload', () => {
        stopLoop();
    });
})();