// puyoSim.js

// --- ぷよぷよシミュレーションの定数と設定 ---

// 盤面サイズ
const WIDTH = 6;
const HEIGHT = 14; // 可視領域12 + 隠し領域2 (Y=0 から Y=13)
const MAX_NEXT_PUYOS = 50; 
const NUM_VISIBLE_NEXT_PUYOS = 2; // プレイ画面に表示する NEXT の数 (NEXT 1とNEXT 2)

// ぷよの色定義
const COLORS = {
    EMPTY: 0,
    RED: 1,
    BLUE: 2,
    GREEN: 3,
    YELLOW: 4,
    GARBAGE: 5 // 灰色のおじゃまぷよ
};

// スコア計算に必要なボーナス値（ぷよぷよ通準拠）
const BONUS_TABLE = {
    CHAIN: [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512],
    GROUP: [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    COLOR: [0, 0, 3, 6, 12]
};


// --- ゲームの状態管理 ---

let board = []; 
let currentPuyo = null; 
let nextPuyoColors = []; 
let score = 0;
let chainCount = 0;
let gameState = 'playing'; // 'playing', 'chaining', 'gameover', 'editing'
let currentEditColor = COLORS.EMPTY; // エディットモードで選択中の色 (デフォルトは消しゴム: 0)
let editingNextPuyos = []; // エディットモードで使用するNEXT 50組

// ★履歴管理用スタック
let historyStack = []; // 過去の状態を保存 (Undo用)
let redoStack = [];    // 戻した状態を保存 (Redo用)


// --- 落下ループのための変数 ---
let dropInterval = 1000; // 1秒ごとに落下
let dropTimer = null; 
let autoDropEnabled = false; 

// --- クイックターン用変数 ---
let lastFailedRotation = {
    type: null, // 'CW' or 'CCW'
    timestamp: 0
};
const QUICK_TURN_WINDOW = 300; // 0.3 seconds in milliseconds


// --- 初期化関数 ---

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
    for (let i = 0; i < MAX_NEXT_PUYOS; i++) {
        nextPuyoColors.push(getRandomPair());
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
            if ((event.key === 'z' || event.key === 'Z') && !event.shiftKey) {
                event.preventDefault();
                undoMove();
            } else if (event.key === 'y' || event.key === 'Y' || (event.key === 'z' || event.key === 'Z') && event.shiftKey) {
                event.preventDefault();
                redoMove();
            }
        });

        const btnLeft = document.getElementById('btn-left');
        const btnRight = document.getElementById('btn-right');
        const btnRotateCW = document.getElementById('btn-rotate-cw'); 
        const btnRotateCCW = document.getElementById('btn-rotate-ccw'); 
        const btnHardDrop = document.getElementById('btn-hard-drop');

        if (btnLeft) btnLeft.addEventListener('click', () => movePuyo(-1, 0));
        if (btnRight) btnRight.addEventListener('click', () => movePuyo(1, 0));
        if (btnRotateCW) btnRotateCW.addEventListener('click', window.rotatePuyoCW); 
        if (btnRotateCCW) btnRotateCCW.addEventListener('click', window.rotatePuyoCCW); 
        if (btnHardDrop) btnHardDrop.addEventListener('click', hardDrop);
        
        setupEditModeListeners(); 
        document.initializedKeyHandler = true;
    }
    
    checkMobileControlsVisibility();
    renderBoard();
    
    saveState(false); 
}

window.resetGame = function() { 
    clearInterval(dropTimer); 
    initializeGame();
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
        
        gravity(); 
        
        nextPuyoColors = JSON.parse(JSON.stringify(editingNextPuyos));
        
        currentPuyo = null; 
        generateNewPuyo(); 
        startPuyoDropLoop(); 
        
        saveState();
        renderBoard();
    }
}


// --- ステージコード化/復元機能 ---

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

// --- 履歴管理関数 ---

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


// --- メインゲームループ ---

function startPuyoDropLoop() {
    if (dropTimer) clearInterval(dropTimer);
    if (gameState === 'playing' && autoDropEnabled) { 
        dropTimer = setInterval(dropPuyo, dropInterval);
    }
}

function dropPuyo() {
    if (gameState !== 'playing' || !currentPuyo) return;

    const moved = movePuyo(0, -1, undefined, true);

    if (!moved) {
        clearInterval(dropTimer);
        lockPuyo();
    }
}


window.toggleAutoDrop = function() {
    const button = document.getElementById('auto-drop-toggle-button');
    if (!button) return;
    
    autoDropEnabled = !autoDropEnabled;

    if (autoDropEnabled) {
        button.textContent = '自動落下: ON';
        button.classList.remove('disabled');
        if (gameState === 'playing') {
            startPuyoDropLoop();
        }
    } else {
        button.textContent = '自動落下: OFF';
        button.classList.add('disabled');
        if (dropTimer) {
            clearInterval(dropTimer);
        }
    }
};


// --- エディットモード機能 ---

function setupEditModeListeners() {
    const palette = document.getElementById('color-palette');
    if (palette) {
        palette.querySelectorAll('.palette-color').forEach(puyoElement => {
            puyoElement.addEventListener('click', () => {
                const color = parseInt(puyoElement.getAttribute('data-color'));
                selectPaletteColor(color);
            });
        });
    }
}

function selectPaletteColor(color) {
    currentEditColor = color;
    document.querySelectorAll('.palette-color').forEach(p => p.classList.remove('selected'));
    const selectedPuyo = document.querySelector(`.palette-color[data-color="${color}"]`);
    if (selectedPuyo) {
        selectedPuyo.classList.add('selected');
    }
}

function handleBoardClickEditMode(event) {
    if (gameState !== 'editing') return;
    
    const boardElement = document.getElementById('puyo-board');
    const rect = boardElement.getBoundingClientRect();
    const cellSize = rect.width / WIDTH; 

    let x = Math.floor((event.clientX - rect.left) / cellSize);
    let y_dom = Math.floor((event.clientY - rect.top) / cellSize); 

    let y = HEIGHT - 1 - y_dom;

    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) { 
        board[y][x] = currentEditColor;
        renderBoard(); 
    }
}

window.applyNextPuyos = function() {
    if (gameState === 'editing') {
        nextPuyoColors = JSON.parse(JSON.stringify(editingNextPuyos));
        alert('ネクストぷよの設定を保存しました。プレイモードで適用されます。');
    }
}

window.clearEditNext = function() {
    if (gameState !== 'editing') return;
    
    editingNextPuyos = [];
    for (let i = 0; i < MAX_NEXT_PUYOS; i++) {
        editingNextPuyos.push(getRandomPair());
    }
    renderEditNextPuyos(); 
    alert('ネクストぷよリストをランダムで再生成しました。');
}


// --- ぷよの生成と操作 ---

function getRandomColor() {
    return Math.floor(Math.random() * 4) + 1; 
}

function getRandomPair() {
    return [getRandomColor(), getRandomColor()];
}

function generateNewPuyo() {
    if (gameState !== 'playing') return;

    while (nextPuyoColors.length < MAX_NEXT_PUYOS) {
        nextPuyoColors.push(getRandomPair());
    }
    
    const [c1, c2] = nextPuyoColors.shift();

    currentPuyo = {
        mainColor: c1,
        subColor: c2,
        mainX: 2, 
        mainY: HEIGHT - 2, 
        rotation: 0 
    };
    
    const startingCoords = getCoordsFromState(currentPuyo);
    
    const isOverlappingTarget = startingCoords.some(p => p.x === 2 && p.y === (HEIGHT - 3) && board[p.y][p.x] !== COLORS.EMPTY);

    if (checkCollision(startingCoords) || isOverlappingTarget) {
        gameState = 'gameover';
        alert('ゲームオーバーです！');
        clearInterval(dropTimer); 
        updateUI();
        renderBoard();
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
        
        if (checkCollision(testCoords)) {
            break; 
        }
        tempPuyo.mainY -= 1; 
    }
    
    const finalCoordsBeforeGravity = getCoordsFromState(tempPuyo);
    const puyoColors = [tempPuyo.mainColor, tempPuyo.subColor];
    
    finalCoordsBeforeGravity.forEach(p => {
        if (p.y >= 0 && p.y < HEIGHT) {
            const color = (p.x === tempPuyo.mainX && p.y === tempPuyo.mainY) 
                          ? tempPuyo.mainColor 
                          : tempPuyo.subColor;
            
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
            
            if (originalColor === COLORS.EMPTY && 
                puyoColors.includes(tempColor) && 
                puyoCount < 2) 
            {
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

        if (puyo.y < HEIGHT && puyo.y >= 0 && board[puyo.y][puyo.x] !== COLORS.EMPTY) {
            return true;
        }
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
        if (newRotation !== undefined) {
            currentPuyo.rotation = newRotation;
        }
        
        if (shouldRender) { 
            renderBoard();
        }
        return true;
    }
    return false;
}

// ★修正箇所: 左右補正(ステップA) -> 上補正(ステップB) -> クイックターン待機(ステップC)
window.rotatePuyoCW = function() {
    if (gameState !== 'playing' || !currentPuyo) return false;
    
    if (autoDropEnabled && dropTimer) {
        clearInterval(dropTimer);
        startPuyoDropLoop();
    }
    
    const newRotation = (currentPuyo.rotation + 1) % 4;
    const oldRotation = currentPuyo.rotation;
    let rotationSuccess = false;

    // 1. その場での回転を試行
    rotationSuccess = movePuyo(0, 0, newRotation);

    // 2. 失敗した場合かつ、縦から横（0 or 2 -> 1 or 3）への回転なら補正を試行
    if (!rotationSuccess && (oldRotation === 0 || oldRotation === 2)) {
        if (newRotation === 1) { // メインの左にサブが来る予定
            // ステップA: メインを右にスライド
            rotationSuccess = movePuyo(1, 0, newRotation);
            // ステップB: 失敗なら、メインを上に押し上げ
            if (!rotationSuccess) {
                rotationSuccess = movePuyo(0, 1, newRotation);
            }
        } else if (newRotation === 3) { // メインの右にサブが来る予定
            // ステップA: メインを左にスライド
            rotationSuccess = movePuyo(-1, 0, newRotation);
            // ステップB: 失敗なら、メインを上に押し上げ
            if (!rotationSuccess) {
                rotationSuccess = movePuyo(0, 1, newRotation);
            }
        }
    }

    if (rotationSuccess) {
        lastFailedRotation.type = null; 
        return true;
    }

    // 3. ステップC: 回転不可の場合のクイックターン判定
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
    let rotationSuccess = false;

    // 1. その場での回転を試行
    rotationSuccess = movePuyo(0, 0, newRotation);

    // 2. 補正ロジック (0 or 2 -> 1 or 3)
    if (!rotationSuccess && (oldRotation === 0 || oldRotation === 2)) {
        if (newRotation === 1) { // メインの左にサブ
            rotationSuccess = movePuyo(1, 0, newRotation);
            if (!rotationSuccess) {
                rotationSuccess = movePuyo(0, 1, newRotation);
            }
        } else if (newRotation === 3) { // メインの右にサブ
            rotationSuccess = movePuyo(-1, 0, newRotation);
            if (!rotationSuccess) {
                rotationSuccess = movePuyo(0, 1, newRotation);
            }
        }
    }

    if (rotationSuccess) {
        lastFailedRotation.type = null; 
        return true;
    }

    // 3. クイックターン判定
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

    clearInterval(dropTimer); 
    while (movePuyo(0, -1, undefined, false)); 
    renderBoard(); 
    lockPuyo(); 
}

function lockPuyo() {
    if (gameState !== 'playing' || !currentPuyo) return;

    const coords = getPuyoCoords();

    for (const puyo of coords) {
        if (puyo.y >= 0) {
            board[puyo.y][puyo.x] = puyo.color;
        }
    }

    for (let x = 0; x < WIDTH; x++) {
        if (board[HEIGHT - 1][x] !== COLORS.EMPTY) {
            board[HEIGHT - 1][x] = COLORS.EMPTY;
        }
    }

    currentPuyo = null;
    saveState(true); 
    
    gameState = 'chaining';
    chainCount = 0;
    
    runChain();
}

function findConnectedPuyos() {
    let disappearingGroups = [];
    let visited = Array(HEIGHT).fill(0).map(() => Array(WIDTH).fill(false));

    const MAX_SEARCH_Y = HEIGHT - 2; 

    for (let y = 0; y < MAX_SEARCH_Y; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const color = board[y][x];
            
            if (color === COLORS.EMPTY || color === COLORS.GARBAGE || visited[y][x]) continue;

            let group = [];
            let stack = [{ x, y }];
            visited[y][x] = true;

            while (stack.length > 0) {
                const current = stack.pop();
                group.push(current);

                [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dx, dy]) => {
                    const nx = current.x + dx;
                    const ny = current.y + dy;
                    
                    if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT &&
                        !visited[ny][nx] && board[ny][nx] === color && 
                        ny < MAX_SEARCH_Y) 
                    {
                        visited[ny][nx] = true;
                        stack.push({ x: nx, y: ny });
                    }
                });
            }

            if (group.length >= 4) {
                disappearingGroups.push({ group, color });
            }
        }
    }
    return disappearingGroups;
}

function clearGarbagePuyos(erasedCoords) {
    let clearedGarbageCount = 0;
    const garbageToClear = new Set(); 

    erasedCoords.forEach(({ x, y }) => {
        [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dx, dy]) => {
            const nx = x + dx;
            const ny = y + dy;

            if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT) {
                if (board[ny][nx] === COLORS.GARBAGE) {
                    garbageToClear.add(`${nx}-${ny}`); 
                }
            }
        });
    });

    garbageToClear.forEach(coordKey => {
        const [nx, ny] = coordKey.split('-').map(Number);
        board[ny][nx] = COLORS.EMPTY;
        clearedGarbageCount++;
    });
    
    return clearedGarbageCount;
}


async function runChain() {
    gravity(); 
    renderBoard(); 
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const groups = findConnectedPuyos();

    if (groups.length === 0) {
        if (checkBoardEmpty()) {
            score += 3600; 
            updateUI(); 
        }
        
        const gameOverLineY = HEIGHT - 3; // Y=11
        const checkX = 2; // X=2 (3列目)
        
        const isGameOver = board[gameOverLineY][checkX] !== COLORS.EMPTY;
        
        if (isGameOver) {
            gameState = 'gameover';
            alert('ゲームオーバーです！');
            clearInterval(dropTimer); 
            updateUI();
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

    chainCount++;

    let chainScore = calculateScore(groups, chainCount);
    score += chainScore;

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

    await new Promise(resolve => setTimeout(resolve, 300));

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

    const finalBonus = Math.max(1, bonusTotal);

    const totalScore = (10 * totalPuyos) * finalBonus;

    return totalScore;
}

function simulateGravity(targetBoard) {
    for (let x = 0; x < WIDTH; x++) {
        let newColumn = [];

        for (let y = 0; y < HEIGHT; y++) {
            if (targetBoard[y][x] !== COLORS.EMPTY) {
                newColumn.push(targetBoard[y][x]);
            }
        }

        for (let y = 0; y < HEIGHT; y++) {
            if (y < newColumn.length) {
                targetBoard[y][x] = newColumn[y];
            } else {
                targetBoard[y][x] = COLORS.EMPTY;
            }
        }
    }
}


function gravity() {
    simulateGravity(board);
}

function checkBoardEmpty() {
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            if (board[y][x] !== COLORS.EMPTY) {
                return false;
            }
        }
    }
    return true;
}


// --- 描画とUI更新 ---

function renderBoard() {
    const isPlaying = gameState === 'playing';
    const currentPuyoCoords = isPlaying ? getPuyoCoords() : [];
    const ghostPuyoCoords = isPlaying && currentPuyo ? getGhostFinalPositions() : []; 

    for (let y = HEIGHT - 1; y >= 0; y--) { 
        for (let x = 0; x < WIDTH; x++) {
            const cellElement = document.getElementById(`cell-${x}-${y}`);
            if (!cellElement) continue;

            const puyoElement = cellElement.firstChild; 
            
            let cellColor = board[y][x]; 
            let puyoClasses = `puyo puyo-${cellColor}`;
            
            const puyoInFlight = currentPuyoCoords.find(p => p.x === x && p.y === y);
            if (puyoInFlight) {
                cellColor = puyoInFlight.color; 
                puyoClasses = `puyo puyo-${cellColor}`; 
            } 
            else {
                const puyoGhost = ghostPuyoCoords.find(p => p.x === x && p.y === y);
                if (puyoGhost) {
                    cellColor = puyoGhost.color; 
                    puyoClasses = `puyo puyo-${cellColor} puyo-ghost`;
                }
            }
            
            puyoElement.className = puyoClasses;
            puyoElement.setAttribute('data-color', cellColor);
        }
    }

    if (gameState === 'playing') {
        renderPlayNextPuyo();
    } else if (gameState === 'editing') {
        renderEditNextPuyos(); 
    }
}

function renderPlayNextPuyo() {
    const next1Element = document.getElementById('next-puyo-1');
    const next2Element = document.getElementById('next-puyo-2');
    
    if (!next1Element || !next2Element) return;

    const slots = [next1Element, next2Element];

    const createPuyo = (color) => {
        let puyo = document.createElement('div');
        puyo.className = `puyo puyo-${color}`;
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

function renderEditNextPuyos() {
    const listContainer = document.getElementById('edit-next-list-container');
    const visibleSlots = [
        document.getElementById('edit-next-1'), 
        document.getElementById('edit-next-2')
    ];

    if (!listContainer || !visibleSlots[0] || !visibleSlots[1]) return;

    const createEditablePuyo = (color, listIndex, puyoIndex) => {
        let puyo = document.createElement('div');
        puyo.className = `puyo puyo-${color}`;
        
        puyo.addEventListener('click', (event) => {
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


function updateUI() {
    document.getElementById('score').textContent = score;
    document.getElementById('chain-count').textContent = chainCount;
    updateHistoryButtons(); 
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
            if (!event.shiftKey) {
                 rotatePuyoCW(); 
            }
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
