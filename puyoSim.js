// --- ぷよぷよシミュレーションの定数と設定 ---

const WIDTH = 6;
const HEIGHT = 14; // 12段 + 隠し2段
const COLORS = {
    EMPTY: 0,
    RED: 1,
    GREEN: 2,
    BLUE: 3,
    YELLOW: 4,
    PURPLE: 5,
    GARBAGE: 6
};
const COLOR_NAMES = ['empty', 'red', 'green', 'blue', 'yellow', 'purple', 'garbage'];
const PUYO_COLORS = [COLORS.RED, COLORS.GREEN, COLORS.BLUE, COLORS.YELLOW, COLORS.PURPLE];
const MIN_CHAIN_COUNT = 4; // ぷよが消える最低数

// --- ゲームの状態 ---

let board = [];
let currentPuyo = null;
let nextPuyo = [];
let gameState = 'playing'; // 'playing' or 'editing'
let score = 0;
let chainCount = 0;
let dropTimer = null;
let autoDropEnabled = false;
let editColor = COLORS.RED;
let history = [];
let historyIndex = -1;

// --- 最大連鎖計算の結果を保持するグローバル変数 ---
let maxChainResult = {
    maxChain: 0,
    starterPuyo: null // {x, y}
};

// --- DOM要素 ---

const puyoBoardElement = document.getElementById('puyo-board');
const scoreElement = document.getElementById('score');
const chainCountElement = document.getElementById('chain-count');
const nextPuyo1Element = document.getElementById('next-puyo-1');
const nextPuyo2Element = document.getElementById('next-puyo-2');
const autoDropToggleButton = document.getElementById('auto-drop-toggle-button');
const modeToggleButton = document.getElementById('mode-toggle-button');
const playInfoContainer = document.getElementById('play-info-container');
const editInfoContainer = document.getElementById('edit-info-container');
const undoButton = document.getElementById('undo-button');
const redoButton = document.getElementById('redo-button');

// --- ユーティリティ関数 ---

function createEmptyBoard() {
    return Array(HEIGHT).fill(0).map(() => Array(WIDTH).fill(COLORS.EMPTY));
}

function getRandomPuyoColor() {
    return PUYO_COLORS[Math.floor(Math.random() * PUYO_COLORS.length)];
}

function getPuyoCoords() {
    if (!currentPuyo) return [];
    const { mainX, mainY, subX, subY } = currentPuyo;
    return [
        { x: mainX, y: mainY, color: currentPuyo.mainColor },
        { x: subX, y: subY, color: currentPuyo.subColor }
    ];
}

function checkCollision(x, y) {
    // 盤面の外側チェック
    if (x < 0 || x >= WIDTH || y < 0) {
        return true;
    }
    // 盤面の上側チェック (Y=13は常に空とみなす)
    if (y >= HEIGHT) {
        return false;
    }
    // ぷよの存在チェック
    return board[y][x] !== COLORS.EMPTY;
}

// --- ゲームロジック ---

function initializeGame() {
    board = createEmptyBoard();
    score = 0;
    chainCount = 0;
    nextPuyo = [
        { mainColor: getRandomPuyoColor(), subColor: getRandomPuyoColor() },
        { mainColor: getRandomPuyoColor(), subColor: getRandomPuyoColor() }
    ];
    createBoardDOM();
    generateNewPuyo();
    updateUI();
    saveState();
    startPuyoDropLoop();
    window.addEventListener('keydown', handleInput);
}

function createBoardDOM() {
    puyoBoardElement.innerHTML = '';
    // Y=13 (最上段) から Y=0 (最下段) の順にDOMを生成
    for (let y = HEIGHT - 1; y >= 0; y--) {
        for (let x = 0; x < WIDTH; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.id = `cell-<LaTex>${x}-$</LaTex>{y}`;
            cell.dataset.x = x;
            cell.dataset.y = y;
            cell.onclick = () => handleCellClick(x, y);
            puyoBoardElement.appendChild(cell);
        }
    }
}

function generateNewPuyo() {
    if (currentPuyo) {
        // ゲームオーバー判定: 3列目のY=12（可視領域の最上段）にぷよがあるか
        if (board[HEIGHT - 2][2] !== COLORS.EMPTY) {
            gameOver();
            return;
        }
    }

    const next = nextPuyo.shift();
    currentPuyo = {
        mainX: 2,
        mainY: HEIGHT - 2, // Y=12 (隠し領域の2段目)
        mainColor: next.mainColor,
        subX: 2,
        subY: HEIGHT - 1, // Y=13 (隠し領域の1段目)
        subColor: next.subColor,
        rotation: 0 // 0: subが上, 1: subが右, 2: subが下, 3: subが左
    };

    nextPuyo.push({ mainColor: getRandomPuyoColor(), subColor: getRandomPuyoColor() });
    renderBoard();
    updateUI();
}

function movePuyo(dx, dy) {
    if (!currentPuyo) return;

    const newMainX = currentPuyo.mainX + dx;
    const newMainY = currentPuyo.mainY + dy;
    const newSubX = currentPuyo.subX + dx;
    const newSubY = currentPuyo.subY + dy;

    // 衝突判定
    if (checkCollision(newMainX, newMainY) || checkCollision(newSubX, newSubY)) {
        if (dy < 0) { // 下方向への移動で衝突した場合
            lockPuyo();
        }
        return;
    }

    currentPuyo.mainX = newMainX;
    currentPuyo.mainY = newMainY;
    currentPuyo.subX = newSubX;
    currentPuyo.subY = newSubY;

    renderBoard();
}

function rotatePuyo(direction) { // direction: 1 (CW) or -1 (CCW)
    if (!currentPuyo) return;

    const { mainX, mainY, subX, subY, rotation } = currentPuyo;
    const newRotation = (rotation + direction + 4) % 4;
    const newCoords = { x: subX, y: subY };

    // 0: subが上 (mainY+1), 1: subが右 (mainX+1), 2: subが下 (mainY-1), 3: subが左 (mainX-1)
    const rotationOffsets = [
        { dx: 0, dy: 1 }, { dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: -1, dy: 0 }
    ];

    newCoords.x = mainX + rotationOffsets[newRotation].dx;
    newCoords.y = mainY + rotationOffsets[newRotation].dy;

    // 衝突判定
    if (checkCollision(newCoords.x, newCoords.y)) {
        // 壁蹴り処理（簡易版）
        let kickX = 0;
        let kickY = 0;

        if (newCoords.x < 0) kickX = 1;
        if (newCoords.x >= WIDTH) kickX = -1;
        if (newCoords.y < 0) kickY = 1;

        if (kickX !== 0 || kickY !== 0) {
            newCoords.x += kickX;
            newCoords.y += kickY;
            if (checkCollision(newCoords.x, newCoords.y)) {
                return; // 壁蹴りしても衝突
            }
            currentPuyo.mainX += kickX;
            currentPuyo.mainY += kickY;
        } else {
            return; // 衝突
        }
    }

    currentPuyo.subX = newCoords.x;
    currentPuyo.subY = newCoords.y;
    currentPuyo.rotation = newRotation;

    renderBoard();
}

window.rotatePuyoCW = () => rotatePuyo(1);
window.rotatePuyoCCW = () => rotatePuyo(-1);

function hardDrop() {
    if (!currentPuyo) return;

    while (true) {
        const newMainY = currentPuyo.mainY - 1;
        const newSubY = currentPuyo.subY - 1;

        if (checkCollision(currentPuyo.mainX, newMainY) || checkCollision(currentPuyo.subX, newSubY)) {
            break;
        }

        currentPuyo.mainY = newMainY;
        currentPuyo.subY = newSubY;
    }

    lockPuyo();
}

function lockPuyo() {
    if (!currentPuyo) return;

    const coords = getPuyoCoords();
    coords.forEach(p => {
        if (p.y >= 0 && p.y < HEIGHT && p.x >= 0 && p.x < WIDTH) {
            board[p.y][p.x] = p.color;
        }
    });

    currentPuyo = null;
    saveState();
    runChain();
}

function startPuyoDropLoop() {
    if (dropTimer) clearInterval(dropTimer);
    if (autoDropEnabled) {
        dropTimer = setInterval(() => movePuyo(0, -1), 1000);
    }
}

function toggleAutoDrop() {
    autoDropEnabled = !autoDropEnabled;
    autoDropToggleButton.textContent = `自動落下: ${autoDropEnabled ? 'ON' : 'OFF'}`;
    if (autoDropEnabled) {
        startPuyoDropLoop();
    } else {
        if (dropTimer) clearInterval(dropTimer);
    }
}

// --- 連鎖ロジック ---

function findConnectedPuyos(currentBoard) {
    const visited = Array(HEIGHT).fill(0).map(() => Array(WIDTH).fill(false));
    const groups = [];

    for (let y = 0; y < HEIGHT - 2; y++) { // 隠し領域は連鎖判定しない
        for (let x = 0; x < WIDTH; x++) {
            const color = currentBoard[y][x];
            if (color !== COLORS.EMPTY && color !== COLORS.GARBAGE && !visited[y][x]) {
                const group = [];
                const queue = [{ x, y }];
                visited[y][x] = true;

                while (queue.length > 0) {
                    const { x: cx, y: cy } = queue.shift();
                    group.push({ x: cx, y: cy });

                    const neighbors = [
                        { x: cx + 1, y: cy }, { x: cx - 1, y: cy },
                        { x: cx, y: cy + 1 }, { x: cx, y: cy - 1 }
                    ];

                    neighbors.forEach(n => {
                        if (n.x >= 0 && n.x < WIDTH && n.y >= 0 && n.y < HEIGHT - 2 && !visited[n.y][n.x] && currentBoard[n.y][n.x] === color) {
                            visited[n.y][n.x] = true;
                            queue.push(n);
                        }
                    });
                }

                if (group.length >= MIN_CHAIN_COUNT) {
                    groups.push(group);
                }
            }
        }
    }
    return groups;
}

function simulateGravity(currentBoard) {
    let moved = false;
    for (let x = 0; x < WIDTH; x++) {
        let writeY = 0;
        for (let readY = 0; readY < HEIGHT; readY++) {
            if (currentBoard[readY][x] !== COLORS.EMPTY) {
                if (readY !== writeY) {
                    currentBoard[writeY][x] = currentBoard[readY][x];
                    currentBoard[readY][x] = COLORS.EMPTY;
                    moved = true;
                }
                writeY++;
            }
        }
    }
    return moved;
}

function clearGarbagePuyos(currentBoard, clearedPuyos) {
    let clearedGarbage = 0;
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            if (currentBoard[y][x] === COLORS.GARBAGE) {
                const neighbors = [
                    { x: x + 1, y: y }, { x: x - 1, y: y },
                    { x: x, y: y + 1 }, { x: x, y: y - 1 }
                ];
                
                let shouldClear = false;
                neighbors.forEach(n => {
                    if (n.x >= 0 && n.x < WIDTH && n.y >= 0 && n.y < HEIGHT && clearedPuyos.some(p => p.x === n.x && p.y === n.y)) {
                        shouldClear = true;
                    }
                });

                if (shouldClear) {
                    currentBoard[y][x] = COLORS.EMPTY;
                    clearedGarbage++;
                }
            }
        }
    }
    return clearedGarbage;
}

async function runChain() {
    chainCount = 0;
    
    // 落下処理
    simulateGravity(board);
    renderBoard();
    await new Promise(resolve => setTimeout(resolve, 300));

    while (true) {
        const groups = findConnectedPuyos(board);
        if (groups.length === 0) break;

        chainCount++;
        let clearedPuyos = [];
        let puyoCount = 0;

        // ぷよを消す
        groups.forEach(group => {
            group.forEach(p => {
                board[p.y][p.x] = COLORS.EMPTY;
                clearedPuyos.push(p);
            });
            puyoCount += group.length;
        });

        // おじゃまぷよを消す
        clearGarbagePuyos(board, clearedPuyos);

        // スコア計算 (簡易版)
        score += puyoCount * 10 * chainCount;

        renderBoard();
        updateUI();
        await new Promise(resolve => setTimeout(resolve, 300));

        // 落下処理
        simulateGravity(board);
        renderBoard();
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    // ゲームオーバー判定
    if (board[HEIGHT - 2][2] !== COLORS.EMPTY) {
        gameOver();
        return;
    }

    gameState = 'playing';
    generateNewPuyo();
    startPuyoDropLoop();
    checkMobileControlsVisibility();
    renderBoard();
}

function gameOver() {
    gameState = 'gameOver';
    if (dropTimer) clearInterval(dropTimer);
    alert(`ゲームオーバー！\n最終スコア: ${score}\n最大連鎖: ${chainCount}`);
}

// --- 描画とUI ---

function renderBoard() {
    const isPlaying = gameState === 'playing';
    const currentPuyoCoords = isPlaying ? getPuyoCoords() : [];
    const ghostPuyoCoords = isPlaying && currentPuyo ? getGhostFinalPositions() : []; 
    
    // 最大連鎖の起点ぷよ
    const starterPuyo = maxChainResult.starterPuyo;

    // Y=13 (最上段) から Y=0 (最下段) の順に描画
    for (let y = HEIGHT - 1; y >= 0; y--) { 
        for (let x = 0; x < WIDTH; x++) {
            const cellElement = document.getElementById(`cell-<LaTex>${x}-$</LaTex>{y}`);
            if (!cellElement) continue;

            // 既存のぷよ要素を全て削除
            cellElement.innerHTML = '';

            // 盤面上のぷよを描画
            const color = board[y][x];
            if (color !== COLORS.EMPTY) {
                const puyo = document.createElement('div');
                puyo.className = `puyo puyo-${COLOR_NAMES[color]}`;
                
                // 最大連鎖の起点ぷよをハイライト
                if (starterPuyo && starterPuyo.x === x && starterPuyo.y === y) {
                    puyo.classList.add('puyo-max-chain-starter');
                }

                cellElement.appendChild(puyo);
            }

            // 落下中のぷよを描画
            const currentPuyoMain = currentPuyoCoords.find(p => p.x === x && p.y === y);
            if (currentPuyoMain) {
                const puyo = document.createElement('div');
                puyo.className = `puyo puyo-falling puyo-${COLOR_NAMES[currentPuyoMain.color]}`;
                cellElement.appendChild(puyo);
            }

            // ゴーストぷよを描画
            const ghostPuyo = ghostPuyoCoords.find(p => p.x === x && p.y === y);
            if (ghostPuyo) {
                const puyo = document.createElement('div');
                puyo.className = `puyo puyo-ghost puyo-${COLOR_NAMES[ghostPuyo.color]}`;
                cellElement.appendChild(puyo);
            }
        }
    }
}

function getGhostFinalPositions() {
    if (!currentPuyo) return [];

    let ghostPuyo = { ...currentPuyo };

    while (true) {
        const newMainY = ghostPuyo.mainY - 1;
        const newSubY = ghostPuyo.subY - 1;

        if (checkCollision(ghostPuyo.mainX, newMainY) || checkCollision(ghostPuyo.subX, newSubY)) {
            break;
        }

        ghostPuyo.mainY = newMainY;
        ghostPuyo.subY = newSubY;
    }

    return [
        { x: ghostPuyo.mainX, y: ghostPuyo.mainY, color: ghostPuyo.mainColor },
        { x: ghostPuyo.subX, y: ghostPuyo.subY, color: ghostPuyo.subColor }
    ];
}

function renderNextPuyo() {
    nextPuyo1Element.innerHTML = '';
    nextPuyo2Element.innerHTML = '';

    if (nextPuyo[0]) {
        const main = document.createElement('div');
        main.className = `puyo puyo-${COLOR_NAMES[nextPuyo[0].mainColor]}`;
        const sub = document.createElement('div');
        sub.className = `puyo puyo-<LaTex>${COLOR_NAMES[nextPuyo[0].subColor]}`;
        nextPuyo1Element.appendChild(main);
        nextPuyo1Element.appendChild(sub);
    }

    if (nextPuyo[1]) {
        const main = document.createElement('div');
        main.className = `puyo puyo-$</LaTex>{COLOR_NAMES[nextPuyo[1].mainColor]}`;
        const sub = document.createElement('div');
        sub.className = `puyo puyo-${COLOR_NAMES[nextPuyo[1].subColor]}`;
        nextPuyo2Element.appendChild(main);
        nextPuyo2Element.appendChild(sub);
    }
}

function updateUI() {
    scoreElement.textContent = score;
    chainCountElement.textContent = chainCount;
    
    // --- 最大連鎖数の表示（新規追加） ---
    const maxChainElement = document.getElementById('max-chain-count');
    if (maxChainElement) {
        maxChainElement.textContent = maxChainResult.maxChain;
    }
    // ------------------------------------
    
    renderNextPuyo();
    updateHistoryButtons();
}

function updateHistoryButtons() {
    undoButton.disabled = historyIndex <= 0;
    redoButton.disabled = historyIndex >= history.length - 1;
}

function checkMobileControlsVisibility() {
    const mobileControls = document.getElementById('mobile-controls');
    if (window.innerWidth <= 650 && gameState === 'playing') {
        mobileControls.classList.add('visible');
    } else {
        mobileControls.classList.remove('visible');
    }
}

// --- 編集モード ---

function toggleMode() {
    if (gameState === 'playing') {
        gameState = 'editing';
        if (dropTimer) clearInterval(dropTimer);
        currentPuyo = null;
        modeToggleButton.textContent = 'play';
        playInfoContainer.style.display = 'none';
        editInfoContainer.style.display = 'flex';
    } else {
        gameState = 'playing';
        modeToggleButton.textContent = 'edit';
        playInfoContainer.style.display = 'flex';
        editInfoContainer.style.display = 'none';
        generateNewPuyo();
        startPuyoDropLoop();
    }
    checkMobileControlsVisibility();
    renderBoard();
}

function selectEditColor(colorName) {
    const color = COLORS[colorName.toUpperCase()];
    editColor = color;
    document.querySelectorAll('.color-select-button').forEach(btn => btn.classList.remove('selected'));
    if (colorName !== 'empty') {
        document.querySelector(`.color-select-button.puyo-${colorName}`).classList.add('selected');
    }
}

function handleCellClick(x, y) {
    if (gameState !== 'editing') return;
    
    if (y >= HEIGHT - 2) return; // 隠し領域は編集不可

    board[y][x] = editColor;
    renderBoard();
}

// --- 履歴 ---

function saveState() {
    const state = {
        board: board.map(row => [...row]),
        nextPuyo: nextPuyo.map(p => ({ ...p })),
        score: score,
        chainCount: chainCount,
        maxChainResult: { ...maxChainResult }
    };

    if (historyIndex < history.length - 1) {
        history = history.slice(0, historyIndex + 1);
    }
    history.push(state);
    historyIndex = history.length - 1;
    updateHistoryButtons();
}

function loadState(index) {
    if (index < 0 || index >= history.length) return;
    
    const state = history[index];
    board = state.board.map(row => [...row]);
    nextPuyo = state.nextPuyo.map(p => ({ ...p }));
    score = state.score;
    chainCount = state.chainCount;
    maxChainResult = state.maxChainResult;
    historyIndex = index;

    currentPuyo = null;
    if (dropTimer) clearInterval(dropTimer);
    
    renderBoard();
    updateUI();
}

window.undo = () => loadState(historyIndex - 1);
window.redo = () => loadState(historyIndex + 1);
window.resetGame = () => initializeGame();

// --- 最大連鎖計算ロジック（新規追加） ---

/**
 * 盤面をコピーし、連鎖数を計算する（非同期処理なし）
 * @param {Array<Array<number>>} testBoard 
 * @returns {number} 連鎖数
 */
function calculateMaxChainFromBoard(testBoard) {
    let chain = 0;
    let currentBoard = testBoard.map(row => [...row]);

    while (true) {
        // 1. 重力処理
        simulateGravity(currentBoard);

        // 2. 連鎖判定
        const groups = findConnectedPuyos(currentBoard);
        if (groups.length === 0) break;

        chain++;
        let clearedPuyos = [];

        // 3. ぷよを消す
        groups.forEach(group => {
            group.forEach(p => {
                currentBoard[p.y][p.x] = COLORS.EMPTY;
                clearedPuyos.push(p);
            });
        });

        // 4. おじゃまぷよを消す
        clearGarbagePuyos(currentBoard, clearedPuyos);
    }

    return chain;
}

/**
 * 隣に空間があるぷよを見つける
 * @param {Array<Array<number>>} currentBoard 
 * @returns {Array<{x: number, y: number}>}
 */
function findPotentialChainStarters(currentBoard) {
    const starters = [];
    const visited = Array(HEIGHT).fill(0).map(() => Array(WIDTH).fill(false));

    for (let y = 0; y < HEIGHT - 2; y++) { // 隠し領域は対象外
        for (let x = 0; x < WIDTH; x++) {
            const color = currentBoard[y][x];
            if (color !== COLORS.EMPTY && color !== COLORS.GARBAGE && !visited[y][x]) {
                const neighbors = [
                    { x: x + 1, y: y }, { x: x - 1, y: y },
                    { x: x, y: y + 1 }, { x: x, y: y - 1 }
                ];

                let hasEmptyNeighbor = false;
                neighbors.forEach(n => {
                    if (n.x >= 0 && n.x < WIDTH && n.y >= 0 && n.y < HEIGHT && currentBoard[n.y][n.x] === COLORS.EMPTY) {
                        hasEmptyNeighbor = true;
                    }
                });

                if (hasEmptyNeighbor) {
                    starters.push({ x, y });
                    // 同じ色のぷよはまとめて処理しない（一つずつ試すため）
                }
            }
        }
    }
    return starters;
}

/**
 * 最大連鎖を探索し、結果を保存する
 */
function findMaxChain() {
    // プレイ中のぷよは無視して、現在の盤面のみを評価する
    let currentBoard = board.map(row => [...row]);
    
    // 落下中のぷよがあれば、一旦盤面に固定する（AIヒントと同じ処理）
    if (currentPuyo) {
        const coords = getPuyoCoords();
        coords.forEach(p => {
            if (p.y >= 0 && p.y < HEIGHT && p.x >= 0 && p.x < WIDTH) {
                currentBoard[p.y][p.x] = p.color;
            }
        });
    }
    
    // 盤面を重力処理
    simulateGravity(currentBoard);
    
    const potentialStarters = findPotentialChainStarters(currentBoard);
    
    let maxChain = 0;
    let bestStarter = null;

    potentialStarters.forEach(({ x, y }) => {
        let testBoard = currentBoard.map(row => [...row]);
        
        // ぷよを消す
        testBoard[y][x] = COLORS.EMPTY;
        
        // 連鎖をシミュレート
        const chain = calculateMaxChainFromBoard(testBoard);
        
        if (chain > maxChain) {
            maxChain = chain;
            bestStarter = { x, y };
        }
    });
    
    maxChainResult = {
        maxChain: maxChain,
        starterPuyo: bestStarter
    };
    
    // 結果をUIに反映
    renderBoard();
    updateUI();
    
    // 結果をアラートで表示（デバッグ用、最終的には削除またはオプション化）
    if (maxChain > 0) {
        // alert(`最大連鎖数: ${maxChain}連鎖\n起点ぷよ: (<LaTex>${bestStarter.x}, $</LaTex>{bestStarter.y})`);
    } else {
        // alert('現在の盤面から手動で連鎖を引き起こすことはできませんでした。');
    }
}

// --- 入力処理 ---

function handleInput(event) {
    if (gameState !== 'playing') return; 

    switch (event.key) {
        case 'ArrowLeft':
            movePuyo(-1, 0); 
            break;
        case 'ArrowRight':
            movePuyo(1, 0); 
            break;
        case 'z':
        case 'Z':
            rotatePuyoCW(); 
            break;
        case 'x':
        case 'X':
            rotatePuyoCCW(); 
            break;
        case 'ArrowDown':
            clearInterval(dropTimer);
            movePuyo(0, -1); 
            if (autoDropEnabled) { 
                startPuyoDropLoop(); 
            }
            break;
        case ' ': 
            event.preventDefault(); 
            hardDrop(); 
            break;
    }
}

// ゲーム開始
document.addEventListener('DOMContentLoaded', () => {
    initializeGame();
    window.addEventListener('resize', checkMobileControlsVisibility);
});

// グローバルスコープに公開
window.findMaxChain = findMaxChain;
window.maxChainResult = maxChainResult;
