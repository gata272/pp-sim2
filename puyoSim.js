// ==========================================================
// Puyo Puyo Simulator Core Logic (Expanded)
// ==========================================================

// --- Constants & Global States ---
const BOARD_WIDTH = 6;
const BOARD_HEIGHT = 14; // 表示12 + 隠し2
const NEXT_MAX_COUNT = 50; 
const PUYO_COLORS = [1, 2, 3, 4, 5]; 
const PUYO_EMPTY = 0;

let puyoBoard = []; // 盤面の固定されたぷよの状態 (14 * 6 = 84要素)
let isEditMode = false;
let selectedColor = 1; 
let autoDropEnabled = true;

// --- プレイモード用 ゲーム状態 ---
let gameLoopInterval = null;
const DROP_SPEED = 1000; // 1秒ごとに落下 (ms)

// 落下中のぷよの状態
let currentPuyo = {
    x: 2, // 親ぷよのX座標 (0-5)
    y: 1, // 親ぷよのY座標 (0-13)。上から2行目 (隠し領域) からスタート
    color1: 0, 
    color2: 0,
    rotation: 0, // 0: 下, 1: 左, 2: 上, 3: 右 (親から見た子ぷよの位置)
};

// 編集モード専用のネクストリスト (50組)
let editNextPuyos = [];
// プレイモードで実際に使用されるネクストキュー
let gameNextPuyos = []; 

// --- Core Utility Functions ---

/**
 * ぷよの色を描画するヘルパー関数
 * @param {HTMLElement} element - 描画対象のDOM要素
 * @param {number} color - ぷよの色コード (0: 空, 1-5: 色)
 */
function drawPuyo(element, color) {
    element.className = element.className.replace(/puyo-\d/g, ' '); 
    element.classList.add(`puyo-${color}`);
    element.classList.add('puyo'); 
}

/**
 * X, Y座標から盤面配列のインデックスを取得
 * @param {number} x 
 * @param {number} y 
 * @returns {number}
 */
function getIndex(x, y) {
    return y * BOARD_WIDTH + x;
}

/**
 * ランダムな色を生成する
 * @returns {number}
 */
function getRandomColor() {
    return PUYO_COLORS[Math.floor(Math.random() * PUYO_COLORS.length)];
}

// --- Game Logic ---

/**
 * 落下中の子ぷよの相対座標を取得する
 * @param {number} rotation 
 * @returns {{dx: number, dy: number}}
 */
function getChildDelta(rotation) {
    const deltas = [
        {dx: 0, dy: 1},  // 0: 下
        {dx: -1, dy: 0}, // 1: 左
        {dx: 0, dy: -1}, // 2: 上
        {dx: 1, dy: 0}   // 3: 右
    ];
    return deltas[rotation % 4];
}

/**
 * 盤面の描画（固定ぷよと落下中のぷよ）
 */
function renderBoard() {
    const cells = document.querySelectorAll('#puyo-board > div');
    
    // 1. 固定ぷよの描画
    puyoBoard.forEach((color, index) => {
        const puyoElement = cells[index].querySelector('.puyo');
        drawPuyo(puyoElement, color);
    });

    // 2. 落下中のぷよの描画 (プレイモードのみ)
    if (!isEditMode && gameNextPuyos.length > 0) {
        
        // 親ぷよ
        let parentIndex = getIndex(currentPuyo.x, currentPuyo.y);
        if (cells[parentIndex]) {
            drawPuyo(cells[parentIndex].querySelector('.puyo'), currentPuyo.color1);
        }

        // 子ぷよ
        const {dx, dy} = getChildDelta(currentPuyo.rotation);
        let childX = currentPuyo.x + dx;
        let childY = currentPuyo.y + dy;
        let childIndex = getIndex(childX, childY);
        
        if (cells[childIndex] && childX >= 0 && childX < BOARD_WIDTH && childY >= 0 && childY < BOARD_HEIGHT) {
            drawPuyo(cells[childIndex].querySelector('.puyo'), currentPuyo.color2);
        }
    }
}

/**
 * 新しいぷよをネクストキューから生成する
 */
function spawnNewPuyo() {
    if (gameNextPuyos.length === 0) {
        // ネクストが空なら、とりあえずランダムで補充
        gameNextPuyos.push([getRandomColor(), getRandomColor()]);
        gameNextPuyos.push([getRandomColor(), getRandomColor()]);
    }
    
    const nextPair = gameNextPuyos.shift(); // 最初のネクストを取り出す
    
    currentPuyo.color1 = nextPair[0];
    currentPuyo.color2 = nextPair[1];
    currentPuyo.x = 2;
    currentPuyo.y = 1; // 隠し領域上部から
    currentPuyo.rotation = 0; // 初期は下向き
    
    // ネクストが減ったので、表示を更新
    updatePlayNextDisplay(false);
    
    // ★TODO: ここで衝突判定（ゲームオーバー判定）を行う

    renderBoard();
}

/**
 * 落下処理 (1ステップ)
 */
function dropPuyo() {
    if (!isEditMode && autoDropEnabled) {
        // ★TODO: ここで下に固定ぷよがあるか、盤面の底に到達したかの衝突判定を行う
        
        // 簡易落下（衝突判定なし）
        currentPuyo.y += 1; 

        // 簡易接地判定 (盤面外に出たら)
        if (currentPuyo.y >= BOARD_HEIGHT) {
            // ★TODO: ここで固定処理 (Boardに反映) を行う

            // 簡易リスポーン
            spawnNewPuyo(); 
        }

        renderBoard();
    }
}

/**
 * ぷよを水平移動させる
 * @param {number} direction -1:左, 1:右
 */
function movePuyo(direction) {
    if (isEditMode) return;
    
    // ★TODO: ここで左右の衝突判定を行う
    
    currentPuyo.x += direction;
    // 簡易盤面外チェック
    if (currentPuyo.x < 0) currentPuyo.x = 0;
    if (currentPuyo.x > BOARD_WIDTH - 1) currentPuyo.x = BOARD_WIDTH - 1; 

    renderBoard();
}

/**
 * ぷよを回転させる
 * @param {number} direction 1:時計回り, -1:反時計回り
 */
function rotatePuyo(direction) {
    if (isEditMode) return;
    
    // ★TODO: ここで壁蹴りや地面衝突判定を行う
    
    currentPuyo.rotation = (currentPuyo.rotation + direction + 4) % 4;

    renderBoard();
}


// --- Mode & Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    initializeBoard();
    initializeEditNextPuyos(); 
    renderEditNextList();      
    updatePlayNextDisplay(true); 
    
    document.body.classList.remove('edit-mode-active');
    
    setupMobileControls();
    startGameLoop(); // ゲームループを開始
});

function initializeBoard() {
    const boardElement = document.getElementById('puyo-board');
    boardElement.innerHTML = '';
    
    puyoBoard = Array(BOARD_HEIGHT * BOARD_WIDTH).fill(PUYO_EMPTY);

    for (let i = 0; i < BOARD_HEIGHT * BOARD_WIDTH; i++) {
        const cell = document.createElement('div');
        cell.setAttribute('data-index', i);
        cell.addEventListener('click', () => handleBoardClick(i)); 
        
        const puyo = document.createElement('div');
        puyo.className = 'puyo puyo-0';
        cell.appendChild(puyo);
        boardElement.appendChild(cell);
    }
    renderBoard();
    
    document.querySelectorAll('#color-palette .palette-color').forEach(puyo => {
        puyo.addEventListener('click', handlePaletteClick);
    });
}

function handleBoardClick(index) {
    if (isEditMode) {
        puyoBoard[index] = selectedColor;
        renderBoard();
    }
}

function handlePaletteClick(event) {
    const newColor = parseInt(event.target.dataset.color);
    selectedColor = newColor;

    document.querySelectorAll('#color-palette .palette-color').forEach(p => p.classList.remove('selected'));
    event.target.classList.add('selected');
}

/**
 * ゲームループを開始/再開する
 */
function startGameLoop() {
    if (gameLoopInterval) {
        clearInterval(gameLoopInterval);
    }
    gameLoopInterval = setInterval(dropPuyo, DROP_SPEED);
}

/**
 * ゲームループを一時停止する
 */
function pauseGameLoop() {
    if (gameLoopInterval) {
        clearInterval(gameLoopInterval);
        gameLoopInterval = null;
    }
}

/**
 * ゲームモードを切り替える
 */
function toggleMode() {
    isEditMode = !isEditMode;
    document.body.classList.toggle('edit-mode-active', isEditMode);
    
    if (!isEditMode) {
        // プレイモードに入る際
        initializeGameNextFromEdit();
        spawnNewPuyo();
        startGameLoop();
    } else {
        // エディットモードに入る際
        pauseGameLoop();
        // 落下中のぷよを盤面から消すために一度リセット
        currentPuyo.color1 = 0;
        currentPuyo.color2 = 0;
        renderBoard();
        renderEditNextList();
    }
}

/**
 * ゲームをリセットする (モードによって動作が異なる)
 */
function resetGame() {
    puyoBoard.fill(PUYO_EMPTY);
    
    if (!isEditMode) {
        initializeGameNextFromEdit();
        spawnNewPuyo();
        startGameLoop();
    }
    renderBoard();
}

/**
 * 自動落下を切り替える
 */
function toggleAutoDrop() {
    autoDropEnabled = !autoDropEnabled;
    const button = document.getElementById('auto-drop-toggle-button');
    button.textContent = `自動落下: ${autoDropEnabled ? 'ON' : 'OFF'}`;
    button.classList.toggle('disabled', !autoDropEnabled);
    
    if (autoDropEnabled && !isEditMode) {
        startGameLoop();
    } else if (!autoDropEnabled) {
        pauseGameLoop();
    }
}


// --- Play Mode NEXT Logic ---

function updatePlayNextDisplay(isInitial = false) {
    if (isInitial || gameNextPuyos.length < 2) {
        if (gameNextPuyos.length === 0) {
             gameNextPuyos.push([getRandomColor(), getRandomColor()]);
        }
        // 常に2組以上ネクストがある状態を保つ
        while (gameNextPuyos.length < 5) {
             gameNextPuyos.push([getRandomColor(), getRandomColor()]);
        }
    }
    
    // NEXT 1
    const next1Puyos = document.querySelectorAll('#next-puyo-1 .puyo');
    if (next1Puyos.length >= 2) {
        drawPuyo(next1Puyos[0], gameNextPuyos[0][0]);
        drawPuyo(next1Puyos[1], gameNextPuyos[0][1]);
    }

    // NEXT 2
    const next2Puyos = document.querySelectorAll('#next-puyo-2 .puyo');
    if (next2Puyos.length >= 2) {
        drawPuyo(next2Puyos[0], gameNextPuyos[1][0]);
        drawPuyo(next2Puyos[1], gameNextPuyos[1][1]);
    }
}

function initializeGameNextFromEdit() {
    // 編集モードで設定されたリストを使用し、ネクストが空になった場合はランダムで補充する
    gameNextPuyos = JSON.parse(JSON.stringify(editNextPuyos));
    updatePlayNextDisplay(false);
}

// --- Edit Mode NEXT List Logic ---

function initializeEditNextPuyos() {
    editNextPuyos = [];
    for (let i = 0; i < NEXT_MAX_COUNT; i++) {
        editNextPuyos.push([getRandomColor(), getRandomColor()]);
    }
}

function clearEditNext() {
    if (confirm('ネクスト設定を全て空にしますか？')) {
        editNextPuyos = Array(NEXT_MAX_COUNT).fill(0).map(() => [PUYO_EMPTY, PUYO_EMPTY]);
        renderEditNextList();
    }
}

function renderEditNextList() {
    const container = document.getElementById('edit-next-list-container');
    container.innerHTML = ''; 
    
    editNextPuyos.forEach((puyoPair, index) => {
        const [color1, color2] = puyoPair;
        
        const pairDiv = document.createElement('div');
        pairDiv.className = 'next-puyo-slot-pair';
        
        const indexSpan = document.createElement('span');
        indexSpan.textContent = `(${index + 1})`;
        pairDiv.appendChild(indexSpan);

        const rowDiv = document.createElement('div');
        rowDiv.className = 'next-puyo-row';
        
        // ぷよ1 (Slot: 0)
        const slot1 = document.createElement('div');
        slot1.className = 'next-puyo-slot';
        const puyo1 = document.createElement('div');
        puyo1.classList.add('puyo');
        drawPuyo(puyo1, color1);
        puyo1.addEventListener('click', () => handleEditNextClick(index, 0));
        slot1.appendChild(puyo1); 
        rowDiv.appendChild(slot1);

        // ぷよ2 (Slot: 1)
        const slot2 = document.createElement('div');
        slot2.className = 'next-puyo-slot';
        const puyo2 = document.createElement('div');
        puyo2.classList.add('puyo');
        drawPuyo(puyo2, color2);
        puyo2.addEventListener('click', () => handleEditNextClick(index, 1));
        slot2.appendChild(puyo2);
        rowDiv.appendChild(slot2);
        
        pairDiv.appendChild(rowDiv);
        container.appendChild(pairDiv);
    });
}

function handleEditNextClick(index, slotNum) {
    if (!isEditMode) return;
    
    editNextPuyos[index][slotNum] = selectedColor;
    
    renderEditNextList();
    
    const container = document.getElementById('edit-next-list-container');
    const targetElement = container.querySelector(`.next-puyo-slot-pair:nth-child(${index + 1})`);
    if (targetElement) {
        container.scrollTop = targetElement.offsetTop - container.offsetTop;
    }
}

// --- Mobile Control Event Listeners Setup ---

function setupMobileControls() {
    document.getElementById('btn-left')?.addEventListener('click', () => movePuyo(-1));
    document.getElementById('btn-right')?.addEventListener('click', () => movePuyo(1));
    document.getElementById('btn-rotate-cw')?.addEventListener('click', () => rotatePuyo(1));
    document.getElementById('btn-rotate-ccw')?.addEventListener('click', () => rotatePuyo(-1));
    
    // ハードドロップ（ここでは簡易落下）
    document.getElementById('btn-hard-drop')?.addEventListener('click', () => {
        if (!isEditMode) {
             // 簡易的なハードドロップ: 衝突判定がないため、すぐに次のぷよを生成
             spawnNewPuyo(); 
        }
    });
}
