// ぷよぷよシミュレーションのシステム

// 盤面サイズ
const WIDTH = 6;
const HEIGHT = 14; // 可視領域12 + 隠し領域2 (Y=0~13)
const MAX_NEXT_PUYOS = 50; 
const NUM_VISIBLE_NEXT_PUYOS = 2; // 表示する NEXT の数 (NEXT 1とNEXT 2)

// ぷよの色定義
const COLORS = {
    EMPTY: 0,
    RED: 1,
    BLUE: 2,
    GREEN: 3,
    YELLOW: 4,
    GARBAGE: 5 // おじゃまぷよ
};

// スコア計算の値
const BONUS_TABLE = {
    CHAIN: [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512],
    GROUP: [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    COLOR: [0, 0, 3, 6, 12]
};

// ゲームの状態管理
let board = []; 
let currentPuyo = null; 
let nextPuyoColors = []; 
let score = 0;
let chainCount = 0;
let gameState = 'playing'; // 'playing', 'chaining', 'gameover', 'editing'
let currentEditColor = COLORS.EMPTY; // エディットモードで選択中の色 (デフォルトは消しゴム: 0)
let editingNextPuyos = []; // エディットモードで使用するNEXT 50組

// 履歴管理用スタック
let historyStack = []; // 過去の状態を保存 (Undo用)
let redoStack = [];    // 戻した状態を保存 (Redo用)

// 落下ループのための変数
let dropInterval = 1000; // 1秒ごとに落下
let dropTimer = null; 
let autoDropEnabled = false; 

// 連鎖速度設定
let gravityWaitTime = 300; // 消滅から落下までの待機時間 (ms)
let chainWaitTime = 300;   // 着地から次の連鎖判定までの待機時間 (ms)

// クイックターン用変数
let lastFailedRotation = {
    type: null, // 'CW' or 'CCW'
    timestamp: 0
};
const QUICK_TURN_WINDOW = 300; // 0.3 seconds in milliseconds

// 初期化関数
function createBoardDOM() {
    const boardElement = document.getElementById('puyo-board');
    boardElement.innerHTML = ''; 

    for (let y = HEIGHT - 1; y >= 0; y--) { 
        for (let x = 0; x < WIDTH; x++) {
            const cell = document.createElement('div');
            cell.id = `cell-${x}-${y}`; 
            
            const puyo = document.createElement('div');
            puyo.className = 'puyo puyo-0'; 
            puyo.setAttribute('data-color', 0);
            
            cell.appendChild(puyo);
            boardElement.appendChild(cell);
        }
    }
}

function checkMobileControlsVisibility() {
    const mobileControls = document.getElementById('mobile-controls');
    if (!mobileControls) return;

    if (gameState === 'playing' && window.innerWidth <= 650) {
        mobileControls.classList.add('visible');
        document.body.classList.remove('edit-mode-active');
    } else if (gameState === 'editing') {
        mobileControls.classList.remove('visible');
        document.body.classList.add('edit-mode-active');
    } else {
        mobileControls.classList.remove('visible');
        document.body.classList.remove('edit-mode-active');
    }
}

window.resetGame = function() { 
    clearInterval(dropTimer); 
    initializeGame();
}

let previousGameState = 'playing';
window.toggleSettingMode = function() {
    const overlay = document.getElementById('setting-overlay');
    
    if (gameState !== 'setting') {
        previousGameState = gameState;
        gameState = 'setting';
        overlay.style.display = 'flex';
    } else {
        gameState = previousGameState;
        overlay.style.display = 'none';
    }
    checkMobileControlsVisibility();
}

window.updateGravityWait = function(value) {
    const slider = document.getElementById('gravity-wait-slider');
    if (slider) slider.value = value;
    gravityWaitTime = parseInt(value);
    const display = document.getElementById('gravity-wait-value');
    if (display) {
        display.textContent = gravityWaitTime + 'ms';
    }
}

window.updateChainWait = function(value) {
    const slider = document.getElementById('chain-wait-slider');
    if (slider) slider.value = value;
    chainWaitTime = parseInt(value);
    const display = document.getElementById('chain-wait-value');
    if (display) {
        display.textContent = chainWaitTime + 'ms';
    }
}

window.toggleMode = function() {
    const infoPanel = document.getElementById('info-panel');
    const modeToggleButton = document.querySelector('.mode-toggle-btn');
    const boardElement = document.getElementById('puyo-board');
    
    if (gameState === 'playing' || gameState === 'gameover') {
        clearInterval(dropTimer); 
        gameState = 'editing';
        infoPanel.classList.add('edit-mode-active');
        document.body.classList.add('edit-mode-active'); 
        
        if (modeToggleButton) modeToggleButton.textContent = 'play';
        
        checkMobileControlsVisibility();
        boardElement.addEventListener('click', handleBoardClickEditMode);
        
        selectPaletteColor(COLORS.EMPTY); 
        renderEditNextPuyos(); 
        renderBoard(); 
        
    } else if (gameState === 'editing') {
        gameState = 'playing';
        infoPanel.classList.remove('edit-mode-active');
        document.body.classList.remove('edit-mode-active');
        
        if (modeToggleButton) modeToggleButton.textContent = 'edit';
        
        checkMobileControlsVisibility();
        boardElement.removeEventListener('click', handleBoardClickEditMode);
        
        if (autoDropEnabled) {
            startPuyoDropLoop();
        }
        
        renderBoard(); 
    }
}

// ステージコード化/復元機能
window.copyStageCode = function() {
    if (gameState !== 'editing') {
        alert("ステージコード化はエディットモードでのみ実行できます。");
        return;
    }

    let dataArray = [];

    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            dataArray.push(board[y][x]);
        }
    }
    
    editingNextPuyos.forEach(pair => {
        dataArray.push(pair[0]);
        dataArray.push(pair[1]);
    });

    let binaryString = "";
    dataArray.forEach(color => {
        binaryString += color.toString(2).padStart(3, '0');
    });

    let byteString = "";
    for (let i = 0; i < binaryString.length; i += 8) {
        const byte = binaryString.substring(i, i + 8);
        byteString += String.fromCharCode(parseInt(byte, 2));
    }
    
    const stageCode = btoa(byteString);

    const codeInput = document.getElementById('stage-code-input');
    if (codeInput) {
        codeInput.value = stageCode;
        codeInput.select();
        document.execCommand('copy');
        alert('現在のステージコードをクリップボードにコピーしました！');
    }
}

window.loadStageCode = function() {
    if (gameState !== 'editing') {
        alert("ステージコードの読み込みはエディットモードでのみ実行できます。");
        return;
    }

    const codeInput = document.getElementById('stage-code-input');
    const stageCode = codeInput ? codeInput.value.trim() : "";

    if (!stageCode) {
        alert("ステージコードが入力されていません。");
        return;
    }

    try {
        const byteString = atob(stageCode);

        let binaryString = "";
        for (let i = 0; i < byteString.length; i++) {
            binaryString += byteString.charCodeAt(i).toString(2).padStart(8, '0');
        }

        let dataArray = [];
        for (let i = 0; i < binaryString.length; i += 3) {
            const colorBinary = binaryString.substring(i, i + 3);
            if (colorBinary.length === 3) {
                const color = parseInt(colorBinary, 2);
                dataArray.push(color);
            }
        }
        
        if (dataArray.length < 184) {
             throw new Error("データが不足しています。");
        }
        
        let dataIndex = 0;
        
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                board[y][x] = dataArray[dataIndex++];
            }
        }
        
        editingNextPuyos = [];
        for (let i = 0; i < MAX_NEXT_PUYOS; i++) {
            const mainColor = dataArray[dataIndex++];
            const subColor = dataArray[dataIndex++];
            editingNextPuyos.push([mainColor, subColor]);
        }
        
        renderBoard();
        renderEditNextPuyos();
        
        alert('ステージコードを正常に読み込みました。');

    } catch (e) {
        console.error("ステージコードの復元中にエラーが発生しました:", e);
        alert('ステージコードが無効です。形式を確認してください。');
    }
}

// 履歴管理関数
function saveState(clearRedoStack = true) {
    const state = {
        board: board.map(row => [...row]),
        nextPuyoColors: nextPuyoColors.map(pair => [...pair]),
        score: score,
        chainCount: chainCount,
        currentPuyo: currentPuyo ? { 
            mainColor: currentPuyo.mainColor,
            subColor: currentPuyo.subColor,
            mainX: currentPuyo.mainX, 
            mainY: currentPuyo.mainY, 
            rotation: currentPuyo.rotation
        } : null
    };

    historyStack.push(state);

    if (clearRedoStack) {
        redoStack = [];
    }
    updateHistoryButtons();
}

function restoreState(state) {
    if (!state) return;

    board = state.board.map(row => [...row]);
    nextPuyoColors = state.nextPuyoColors.map(pair => [...pair]);
    score = state.score;
    chainCount = state.chainCount;
    
    if (state.currentPuyo) {
        currentPuyo = { ...state.currentPuyo };
    } else {
        currentPuyo = null;
    }
    
    gameState = 'playing';
    clearInterval(dropTimer);
    
    if (currentPuyo === null) {
        generateNewPuyo(); 
    }
    
    gravity(); 

    const groups = findConnectedPuyos();

    if (groups.length > 0) {
        gameState = 'chaining';
        chainCount = 0;
        runChain();
    } else {
        startPuyoDropLoop();
    }

    updateUI();
    renderBoard();
}

window.undoMove = function() {
    if (gameState !== 'playing' && gameState !== 'chaining' && gameState !== 'gameover') return; 
    if (historyStack.length <= 1) return; 

    const currentState = historyStack.pop(); 
    redoStack.push(currentState);

    const previousState = historyStack[historyStack.length - 1]; 
    restoreState(previousState);

    updateHistoryButtons();
}

window.redoMove = function() {
    if (gameState !== 'playing' && gameState !== 'chaining' && gameState !== 'gameover') return; 
    if (redoStack.length === 0) return;

    const nextState = redoStack.pop();
    
    historyStack.push(nextState); 

    restoreState(nextState);

    updateHistoryButtons();
}

function updateHistoryButtons() {
    const undoButton = document.getElementById('undo-button');
    const redoButton = document.getElementById('redo-button');
    
    if (undoButton) {
        undoButton.disabled = historyStack.length <= 1;
    }
    if (redoButton) {
        redoButton.disabled = redoStack.length === 0;
    }
}

function getRandomColor() {
    return Math.floor(Math.random() * 4) + 1; 
}

function getRandomPair() {
    return [getRandomColor(), getRandomColor()];
}

function hasFourUniqueColors(pair1, pair2) {
    const allColors = new Set([...pair1, ...pair2]);
    return allColors.size === 4;
}

function initializeGame() {
    createBoardDOM(); 
    
    for (let y = 0; y < HEIGHT; y++) {
        board[y] = Array(WIDTH).fill(COLORS.EMPTY);
    }

    score = 0;
    chainCount = 0;
    gameState = 'playing';
    
    historyStack = []; 
    redoStack = [];

    nextPuyoColors = [];
    nextPuyoColors.push(getRandomPair());

    for (let i = 1; i < MAX_NEXT_PUYOS; i++) {
        let newPair;
        let retries = 0;
        const MAX_RETRIES = 100; 
        do {
            newPair = getRandomPair();
            retries++;
            if (retries > MAX_RETRIES) break;
        } while (hasFourUniqueColors(nextPuyoColors[i-1], newPair));
        nextPuyoColors.push(newPair);
    }

    editingNextPuyos = JSON.parse(JSON.stringify(nextPuyoColors));
    currentEditColor = COLORS.EMPTY; 

    const modeToggleButton = document.querySelector('.mode-toggle-btn');
    if (modeToggleButton) modeToggleButton.textContent = 'edit';
    const infoPanel = document.getElementById('info-panel');
    if (infoPanel) infoPanel.classList.remove('edit-mode-active');
    
    const autoDropButton = document.getElementById('auto-drop-toggle-button');
    if (autoDropButton) {
        if (autoDropEnabled) {
            autoDropButton.textContent = '自動落下: ON';
            autoDropButton.classList.remove('disabled');
        } else {
            autoDropButton.textContent = '自動落下: OFF';
            autoDropButton.classList.add('disabled');
        }
    }

    generateNewPuyo(); 
    startPuyoDropLoop(); 
    
    updateUI();
    
    if (!document.initializedKeyHandler) {
        document.addEventListener('keydown', handleInput);
        
        document.addEventListener('keydown', (event) => {
            const key = event.key.toLowerCase();
            if (key === 'u') { 
                event.preventDefault();
                undoMove();
            } else if (key === 'y') { 
                event.preventDefault();
                redoMove();
            } else if (key === 'r') { 
                event.preventDefault();
                resetGame();
            } else if (key === 'e') { 
                event.preventDefault();
                toggleMode();
            }
        });

        const btnLeft = document.getElementById('btn-left');
        const btnRight = document.getElementById('btn-right');
        const btnRotateCW = document.getElementById('btn-rotate-cw'); 
        const btnRotateCCW = document.getElementById('btn-rotate-ccw'); 
        const btnHardDrop = document.getElementById('btn-hard-drop');
        const btnSoftDrop = document.getElementById('btn-soft-drop');

        if (btnLeft) btnLeft.addEventListener('click', () => movePuyo(-1, 0));
        if (btnRight) btnRight.addEventListener('click', () => movePuyo(1, 0));
        if (btnRotateCW) btnRotateCW.addEventListener('click', window.rotatePuyoCW); 
        if (btnRotateCCW) btnRotateCCW.addEventListener('click', window.rotatePuyoCCW); 
        if (btnHardDrop) btnHardDrop.addEventListener('click', hardDrop);
        if (btnSoftDrop) btnSoftDrop.addEventListener('click', () => {
            if (gameState === 'playing') {
                clearInterval(dropTimer);
                movePuyo(0, -1);
                if (autoDropEnabled) startPuyoDropLoop();
            }
        });
        
        setupEditModeListeners(); 
        document.initializedKeyHandler = true;
    }
    
    checkMobileControlsVisibility();
    renderBoard();
    saveState(false); 
}

function generateNewPuyo() {
    if (gameState !== 'playing') return;

    while (nextPuyoColors.length < MAX_NEXT_PUYOS) {
        nextPuyoColors.push(getRandomPair());
    }
    
    const [c1, c2] = nextPuyoColors.shift();

    currentPuyo = {
        mainColor: c2,
        subColor: c1,
        mainX: 2, 
        mainY: HEIGHT - 2, 
        rotation: 0 
    };
    
    const startingCoords = getCoordsFromState(currentPuyo);
    const isOverlappingTarget = startingCoords.some(p => p.x === 2 && p.y === (HEIGHT - 3) && board[p.y][p.x] !== COLORS.EMPTY);

    if (checkCollision(startingCoords) || isOverlappingTarget) {
        gameState = 'gameover';
        clearInterval(dropTimer); 
        updateUI();
        renderBoard();
        // オンライン対戦中の場合、敗北を通知（alertは表示しない）
        if (window.notifyGameOver) {
            window.notifyGameOver();
        } else {
            // シングルプレイ時のみalertを表示
            alert('ゲームオーバーです！');
        }
        return; 
    }

    nextPuyoColors.push(getRandomPair());
}

function getCoordsFromState(puyoState) {
    const { mainX, mainY, rotation } = puyoState;
    let subX = mainX;
    let subY = mainY;

    if (rotation === 0) subY = mainY + 1; 
    if (rotation === 1) subX = mainX - 1; 
    if (rotation === 2) subY = mainY - 1; 
    if (rotation === 3) subX = mainX + 1; 

    return [
        { x: mainX, y: mainY },
        { x: subX, y: subY }
    ];
}

function getPuyoCoords() {
    if (!currentPuyo) return [];
    const coords = getCoordsFromState(currentPuyo);
    coords[0].color = currentPuyo.mainColor;
    coords[1].color = currentPuyo.subColor;
    return coords;
}

function getGhostFinalPositions() {
    if (!currentPuyo || gameState !== 'playing') return [];
    let tempBoard = board.map(row => [...row]);
    let tempPuyo = { ...currentPuyo };
    while (true) {
        let testPuyo = { ...tempPuyo, mainY: tempPuyo.mainY - 1 };
        const testCoords = getCoordsFromState(testPuyo);
        if (checkCollision(testCoords)) break; 
        tempPuyo.mainY -= 1; 
    }
    const finalCoordsBeforeGravity = getCoordsFromState(tempPuyo);
    const puyoColors = [tempPuyo.mainColor, tempPuyo.subColor];
    finalCoordsBeforeGravity.forEach(p => {
        if (p.y >= 0 && p.y < HEIGHT) {
            const color = (p.x === tempPuyo.mainX && p.y === tempPuyo.mainY) ? tempPuyo.mainColor : tempPuyo.subColor;
            tempBoard[p.y][p.x] = color;
        }
    });
    simulateGravity(tempBoard); 
    let ghostPositions = [];
    let puyoCount = 0;
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const tempColor = tempBoard[y][x];
            const originalColor = board[y][x];
            if (originalColor === COLORS.EMPTY && puyoColors.includes(tempColor) && puyoCount < 2) {
                ghostPositions.push({ x: x, y: y, color: tempColor });
                puyoCount++;
            }
        }
    }
    return ghostPositions.filter(p => p.y < HEIGHT - 2); 
}

function checkCollision(coords) {
    for (const puyo of coords) {
        if (puyo.x < 0 || puyo.x >= WIDTH || puyo.y < 0) return true;
        if (puyo.y < HEIGHT - 1 && board[puyo.y][puyo.x] !== COLORS.EMPTY) return true;
    }
    return false;
}

function movePuyo(dx, dy, newRotation, shouldRender = true) {
    if (gameState !== 'playing' || !currentPuyo) return false; 
    const { mainX, mainY, rotation } = currentPuyo;
    const testPuyo = { 
        mainX: mainX + dx, 
        mainY: mainY + dy, 
        rotation: newRotation !== undefined ? newRotation : rotation 
    };
    const testCoords = getCoordsFromState(testPuyo);
    if (!checkCollision(testCoords)) {
        currentPuyo.mainX = testPuyo.mainX;
        currentPuyo.mainY = testPuyo.mainY;
        if (newRotation !== undefined) currentPuyo.rotation = newRotation;
        if (shouldRender) renderBoard();
        return true;
    }
    return false;
}

window.rotatePuyoCW = function() {
    if (gameState !== 'playing' || !currentPuyo) return false;
    if (autoDropEnabled && dropTimer) {
        clearInterval(dropTimer);
        startPuyoDropLoop();
    }
    const newRotation = (currentPuyo.rotation + 1) % 4;
    const oldRotation = currentPuyo.rotation;
    let rotationSuccess = movePuyo(0, 0, newRotation);
    if (!rotationSuccess) {
        if (oldRotation === 0 || oldRotation === 2) {
            if (newRotation === 1) { 
                rotationSuccess = movePuyo(1, 0, newRotation); 
                if (!rotationSuccess) rotationSuccess = movePuyo(0, 1, newRotation); 
            } else if (newRotation === 3) { 
                rotationSuccess = movePuyo(-1, 0, newRotation); 
                if (!rotationSuccess) rotationSuccess = movePuyo(0, 1, newRotation); 
            }
        } else {
            rotationSuccess = movePuyo(0, 1, newRotation);
        }
    }
    if (rotationSuccess) {
        lastFailedRotation.type = null; 
        return true;
    }
    const now = Date.now();
    if (lastFailedRotation.type === 'CW' && (now - lastFailedRotation.timestamp) < QUICK_TURN_WINDOW) {
        [currentPuyo.mainColor, currentPuyo.subColor] = [currentPuyo.subColor, currentPuyo.mainColor];
        lastFailedRotation.type = null; 
        renderBoard();
        return true;
    }
    lastFailedRotation.type = 'CW';
    lastFailedRotation.timestamp = now;
    return false;
}

window.rotatePuyoCCW = function() {
    if (gameState !== 'playing' || !currentPuyo) return false;
    if (autoDropEnabled && dropTimer) {
        clearInterval(dropTimer);
        startPuyoDropLoop();
    }
    const newRotation = (currentPuyo.rotation - 1 + 4) % 4;
    const oldRotation = currentPuyo.rotation;
    let rotationSuccess = movePuyo(0, 0, newRotation);
    if (!rotationSuccess) {
        if (oldRotation === 0 || oldRotation === 2) {
            if (newRotation === 1) {
                rotationSuccess = movePuyo(1, 0, newRotation);
                if (!rotationSuccess) rotationSuccess = movePuyo(0, 1, newRotation);
            } else if (newRotation === 3) {
                rotationSuccess = movePuyo(-1, 0, newRotation);
                if (!rotationSuccess) rotationSuccess = movePuyo(0, 1, newRotation);
            }
        } else {
            rotationSuccess = movePuyo(0, 1, newRotation);
        }
    }
    if (rotationSuccess) {
        lastFailedRotation.type = null;
        return true;
    }
    const now = Date.now();
    if (lastFailedRotation.type === 'CCW' && (now - lastFailedRotation.timestamp) < QUICK_TURN_WINDOW) {
        [currentPuyo.mainColor, currentPuyo.subColor] = [currentPuyo.subColor, currentPuyo.mainColor];
        lastFailedRotation.type = null;
        renderBoard();
        return true;
    }
    lastFailedRotation.type = 'CCW';
    lastFailedRotation.timestamp = now;
    return false;
}

function hardDrop() {
    if (gameState !== 'playing' || !currentPuyo) return;
    saveState();
    while (movePuyo(0, -1, undefined, false)) {}
    placePuyo();
}

function startPuyoDropLoop() {
    if (dropTimer) clearInterval(dropTimer);
    if (autoDropEnabled && gameState === 'playing') {
        dropTimer = setInterval(() => {
            if (gameState === 'playing') {
                if (!movePuyo(0, -1)) placePuyo();
            }
        }, dropInterval);
    }
}

window.toggleAutoDrop = function() {
    autoDropEnabled = !autoDropEnabled;
    const btn = document.getElementById('auto-drop-toggle-button');
    if (btn) {
        btn.textContent = autoDropEnabled ? '自動落下: ON' : '自動落下: OFF';
        if (autoDropEnabled) btn.classList.remove('disabled');
        else btn.classList.add('disabled');
    }
    if (autoDropEnabled) startPuyoDropLoop();
    else if (dropTimer) clearInterval(dropTimer);
}

function placePuyo() {
    if (!currentPuyo) return;
    const coords = getPuyoCoords();
    coords.forEach(p => {
        if (p.y >= 0 && p.y < HEIGHT) board[p.y][p.x] = p.color;
    });
    currentPuyo = null;
    gameState = 'chaining';
    chainCount = 0;
    gravity();
    renderBoard();
    runChain();
}

function findConnectedPuyos() {
    let visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
    let groups = [];
    for (let y = 0; y < HEIGHT - 2; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const color = board[y][x];
            if (color !== COLORS.EMPTY && color !== COLORS.GARBAGE && !visited[y][x]) {
                let group = [];
                let stack = [{ x, y }];
                visited[y][x] = true;
                while (stack.length > 0) {
                    let curr = stack.pop();
                    group.push(curr);
                    const neighbors = [
                        { x: curr.x + 1, y: curr.y }, { x: curr.x - 1, y: curr.y },
                        { x: curr.x, y: curr.y + 1 }, { x: curr.x, y: curr.y - 1 }
                    ];
                    neighbors.forEach(n => {
                        if (n.x >= 0 && n.x < WIDTH && n.y >= 0 && n.y < HEIGHT - 2 &&
                            !visited[n.y][n.x] && board[n.y][n.x] === color) {
                            visited[n.y][n.x] = true;
                            stack.push(n);
                        }
                    });
                }
                if (group.length >= 4) groups.push({ group, color });
            }
        }
    }
    return groups;
}

function clearGarbagePuyos(erasedCoords) {
    let garbageToClear = new Set();
    erasedCoords.forEach(c => {
        const neighbors = [
            { x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y },
            { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 }
        ];
        neighbors.forEach(n => {
            if (n.x >= 0 && n.x < WIDTH && n.y >= 0 && n.y < HEIGHT && board[n.y][n.x] === COLORS.GARBAGE) {
                garbageToClear.add(`${n.x},${n.y}`);
            }
        });
    });
    garbageToClear.forEach(pos => {
        const [x, y] = pos.split(',').map(Number);
        board[y][x] = COLORS.EMPTY;
    });
}

async function runChain() {
    const groups = findConnectedPuyos();
    if (groups.length === 0) {
        gravity();
        const nextGroups = findConnectedPuyos();
        if (nextGroups.length > 0) {
            runChain();
            return;
        }
        if (chainCount === 0) {
            gameState = 'playing';
            generateNewPuyo();
            startPuyoDropLoop();
            checkMobileControlsVisibility();
            renderBoard();
            return;
        }
        gameState = 'playing';
        generateNewPuyo();
        startPuyoDropLoop();
        checkMobileControlsVisibility();
        renderBoard();
        return;
    }
    await new Promise(resolve => setTimeout(resolve, chainWaitTime));
    chainCount++;
    score += calculateScore(groups, chainCount);
    let erasedCoords = [];
    groups.forEach(({ group }) => {
        group.forEach(({ x, y }) => {
            board[y][x] = COLORS.EMPTY;
            erasedCoords.push({ x, y });
        });
    });
    clearGarbagePuyos(erasedCoords);
    renderBoard();
    updateUI();
    await new Promise(resolve => setTimeout(resolve, gravityWaitTime));
    runChain();
}

function calculateScore(groups, currentChain) {
    let totalPuyos = 0;
    let colorCount = new Set();
    let bonusTotal = 0;
    groups.forEach(({ group, color }) => {
        totalPuyos += group.length;
        colorCount.add(color);
        const groupBonusIndex = Math.min(group.length, BONUS_TABLE.GROUP.length - 1);
        bonusTotal += BONUS_TABLE.GROUP[groupBonusIndex];
    });
    const chainBonusIndex = Math.min(currentChain, BONUS_TABLE.CHAIN.length - 1);
    bonusTotal += BONUS_TABLE.CHAIN[chainBonusIndex];
    const colorBonusIndex = Math.min(colorCount.size, BONUS_TABLE.COLOR.length - 1);
    bonusTotal += BONUS_TABLE.COLOR[colorBonusIndex];
    return (10 * totalPuyos) * Math.max(1, bonusTotal);
}

function simulateGravity(targetBoard) {
    for (let x = 0; x < WIDTH; x++) {
        let newColumn = [];
        for (let y = 0; y < HEIGHT; y++) {
            if (targetBoard[y][x] !== COLORS.EMPTY) newColumn.push(targetBoard[y][x]);
        }
        for (let y = 0; y < HEIGHT; y++) {
            targetBoard[y][x] = y < newColumn.length ? newColumn[y] : COLORS.EMPTY;
        }
    }
}

function gravity() { simulateGravity(board); }
function checkBoardEmpty() {
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) if (board[y][x] !== COLORS.EMPTY) return false;
    }
    return true;
}

function renderBoard() {
    // オンライン対戦中の同期
    if (window.sendBoardData) window.sendBoardData();
    
    const boardElement = document.getElementById('puyo-board');
    if (!boardElement) return;
    
    boardElement.innerHTML = '';
    for (let y = HEIGHT - 1; y >= 0; y--) {
        for (let x = 0; x < WIDTH; x++) {
            const cell = document.createElement('div');
            cell.id = 'cell-' + x + '-' + y;
            const puyo = document.createElement('div');
            puyo.className = 'puyo puyo-0';
            puyo.setAttribute('data-color', 0);
            cell.appendChild(puyo);
            boardElement.appendChild(cell);
        }
    }
    
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const cellElement = document.getElementById('cell-' + x + '-' + y);
            if (!cellElement) continue;
            const puyoElement = cellElement.firstChild;
            if (!puyoElement) continue;
            const color = board[y][x];
            puyoElement.className = 'puyo puyo-' + color;
            puyoElement.setAttribute('data-color', color);
        }
    }
    
    if (currentPuyo && gameState === 'playing') renderCurrentPuyo();
    if (gameState === 'playing') renderPlayNextPuyo();
    else if (gameState === 'editing') renderEditNextPuyos();
}

function renderCurrentPuyo() {
    if (!currentPuyo) return;
    const currentPuyoCoords = getPuyoCoords();
    const ghostPuyoCoords = getGhostFinalPositions();
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const cellElement = document.getElementById('cell-' + x + '-' + y);
            if (!cellElement) continue;
            const puyoElement = cellElement.firstChild;
            if (!puyoElement) continue;
            let cellColor = board[y][x];
            let puyoClasses = 'puyo puyo-' + cellColor;
            const puyoInFlight = currentPuyoCoords.find(p => p.x === x && p.y === y);
            if (puyoInFlight) {
                cellColor = puyoInFlight.color;
                puyoClasses = 'puyo puyo-' + cellColor;
            } else {
                const puyoGhost = ghostPuyoCoords.find(p => p.x === x && p.y === y);
                if (puyoGhost) {
                    cellColor = puyoGhost.color;
                    puyoClasses = 'puyo puyo-' + cellColor + ' puyo-ghost';
                }
            }
            puyoElement.className = puyoClasses;
            puyoElement.setAttribute('data-color', cellColor);
        }
    }
}

function renderPlayNextPuyo() {
    const next1Element = document.getElementById('next-puyo-1');
    const next2Element = document.getElementById('next-puyo-2');
    if (!next1Element || !next2Element) return;
    const slots = [next1Element, next2Element];
    const createPuyo = (color) => {
        let puyo = document.createElement('div');
        puyo.className = 'puyo puyo-' + color;
        return puyo;
    };
    slots.forEach((slot, index) => {
        slot.innerHTML = '';
        if (nextPuyoColors.length > index) {
            const [c_main, c_sub] = nextPuyoColors[index];
            slot.appendChild(createPuyo(c_sub));
            slot.appendChild(createPuyo(c_main));
        }
    });
}

function updateUI() {
    const scoreElement = document.getElementById('score');
    const chainElement = document.getElementById('chain-count');
    
    // オンライン対戦中はスコア表示をonline.jsで管理
    if (scoreElement && !document.body.classList.contains('online-match-active')) {
        scoreElement.textContent = score;
    }
    if (chainElement) chainElement.textContent = chainCount;
    updateHistoryButtons();
}

function renderEditNextPuyos() {
    const listContainer = document.getElementById('edit-next-list-container');
    const visibleSlots = [document.getElementById('edit-next-1'), document.getElementById('edit-next-2')];
    if (!listContainer || !visibleSlots[0] || !visibleSlots[1]) return;
    const createEditablePuyo = (color, listIndex, puyoIndex) => {
        let puyo = document.createElement('div');
        puyo.className = `puyo puyo-${color}`;
        puyo.addEventListener('pointerdown', (event) => {
            event.stopPropagation(); 
            if (gameState !== 'editing') return;
            if (editingNextPuyos.length > listIndex) {
                editingNextPuyos[listIndex][puyoIndex] = currentEditColor; 
                renderEditNextPuyos(); 
            }
        });
        return puyo;
    };
    visibleSlots.forEach((slot, index) => {
        slot.innerHTML = '';
        if (editingNextPuyos.length > index) {
            const [c_main, c_sub] = editingNextPuyos[index];
            slot.appendChild(createEditablePuyo(c_sub, index, 1));
            slot.appendChild(createEditablePuyo(c_main, index, 0));
        }
    });
    listContainer.innerHTML = '';
    for (let i = NUM_VISIBLE_NEXT_PUYOS; i < MAX_NEXT_PUYOS; i++) {
        if (editingNextPuyos.length <= i) break;
        const pairContainer = document.createElement('div');
        pairContainer.className = 'next-puyo-slot-pair';
        const countSpan = document.createElement('span');
        countSpan.textContent = `N${i + 1}`;
        pairContainer.appendChild(countSpan);
        const puyoRow = document.createElement('div');
        puyoRow.className = 'next-puyo-row';
        const [c_main, c_sub] = editingNextPuyos[i];
        puyoRow.appendChild(createEditablePuyo(c_sub, i, 1));
        puyoRow.appendChild(createEditablePuyo(c_main, i, 0));
        pairContainer.appendChild(puyoRow);
        listContainer.appendChild(pairContainer);
    }
}

function handleInput(event) {
    if (gameState !== 'playing') return; 
    switch (event.key) {
        case 'ArrowLeft': movePuyo(-1, 0); break;
        case 'ArrowRight': movePuyo(1, 0); break;
        case 'z': case 'Z': rotatePuyoCW(); break;
        case 'x': case 'X': rotatePuyoCCW(); break;
        case 'ArrowDown': movePuyo(0, -1); break;
        case 'ArrowUp': hardDrop(); break;
    }
}

function handleBoardClickEditMode(event) {
    if (gameState !== 'editing') return;
    const rect = event.target.closest('#puyo-board').getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / (rect.width / WIDTH));
    const y = HEIGHT - 1 - Math.floor((event.clientY - rect.top) / (rect.height / HEIGHT));
    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) {
        board[y][x] = currentEditColor;
        renderBoard();
    }
}

function selectPaletteColor(color) {
    currentEditColor = color;
    document.querySelectorAll('.palette-color').forEach(el => {
        el.classList.toggle('selected', parseInt(el.getAttribute('data-color')) === color);
    });
}

function setupEditModeListeners() {
    document.querySelectorAll('.palette-color').forEach(el => {
        el.addEventListener('click', () => selectPaletteColor(parseInt(el.getAttribute('data-color'))));
    });
}

window.applyNextPuyos = function() {
    nextPuyoColors = JSON.parse(JSON.stringify(editingNextPuyos));
    alert('ネクスト設定を適用しました。');
}

window.clearEditNext = function() {
    editingNextPuyos = [];
    for (let i = 0; i < MAX_NEXT_PUYOS; i++) editingNextPuyos.push(getRandomPair());
    renderEditNextPuyos();
}

window.raisePuyoOneRow = function() {
    if (gameState === 'playing' && currentPuyo) {
        if (currentPuyo.mainY < HEIGHT - 2) {
            currentPuyo.mainY++;
            renderBoard();
        }
    }
}

// 初期化
initializeGame();
