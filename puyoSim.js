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
    // 連鎖ボーナス (CB): 1連鎖=0, 2連鎖=8, 3連鎖=16...
    CHAIN: [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512],
    // 連結ボーナス (PB): 4個=0, 5個=2, 6個=3...
    GROUP: [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    // 色数ボーナス (Color): 1色=0, 2色=3, 3色=6, 4色=12
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

// ★追加: 履歴管理用スタック
let historyStack = []; // 過去の状態を保存 (Undo用)
let redoStack = [];    // 戻した状態を保存 (Redo用)


// --- 落下ループのための変数 ---
let dropInterval = 1000; // 1秒ごとに落下
let dropTimer = null; 
let autoDropEnabled = false; 


// --- 初期化関数 ---

/**
 * 盤面のDOM要素を一度だけ生成する (6列x14行)
 */
function createBoardDOM() {
    const boardElement = document.getElementById('puyo-board');
    boardElement.innerHTML = ''; 

    // 描画は全領域 (HEIGHT = 14行) を行う (y=13からy=0の順で配置)
    for (let y = HEIGHT - 1; y >= 0; y--) { 
        for (let x = 0; x < WIDTH; x++) {
            const cell = document.createElement('div');
            cell.id = `cell-${x}-${y}`; 
            
            // 内部のぷよ要素 (常に存在させる)
            const puyo = document.createElement('div');
            puyo.className = 'puyo puyo-0'; 
            puyo.setAttribute('data-color', 0);
            
            cell.appendChild(puyo);
            boardElement.appendChild(cell);
        }
    }
}

/**
 * モバイル操作ボタンの表示/非表示をチェックし、設定する
 */
function checkMobileControlsVisibility() {
    const mobileControls = document.getElementById('mobile-controls');
    if (!mobileControls) return;

    // プレイモードかつ画面幅が650px以下の場合に表示
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
    // 1. 盤面DOMを一度だけ構築
    createBoardDOM(); 
    
    // 2. 盤面データを空で初期化
    for (let y = 0; y < HEIGHT; y++) {
        board[y] = Array(WIDTH).fill(COLORS.EMPTY);
    }

    score = 0;
    chainCount = 0;
    gameState = 'playing';
    
    // 履歴スタックをクリア
    historyStack = []; 
    redoStack = [];

    // ネクストぷよリストを MAX_NEXT_PUYOS (50組) で初期化
    nextPuyoColors = [];
    for (let i = 0; i < MAX_NEXT_PUYOS; i++) {
        nextPuyoColors.push(getRandomPair());
    }
    // エディット用のネクストリストも初期化
    editingNextPuyos = JSON.parse(JSON.stringify(nextPuyoColors));
    currentEditColor = COLORS.EMPTY; 

    // UIリセット
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

    // 最初のぷよを生成
    generateNewPuyo(); 
    startPuyoDropLoop(); 
    
    updateUI();
    
    // イベントリスナーの設定 (初回のみ)
    if (!document.initializedKeyHandler) {
        document.addEventListener('keydown', handleInput);
        
        // Undo/Redoのキーバインド
        document.addEventListener('keydown', (event) => {
            if (gameState === 'playing') {
                if ((event.key === 'z' || event.key === 'Z') && !event.shiftKey) {
                    event.preventDefault(); // ブラウザの戻るを防止
                    undoMove();
                } else if (event.key === 'y' || event.key === 'Y' || (event.key === 'z' || event.key === 'Z') && event.shiftKey) {
                    event.preventDefault(); // ブラウザの戻る/再読み込みを防止
                    redoMove();
                }
            }
        });

        // モバイル操作ボタンのイベント設定
        const btnLeft = document.getElementById('btn-left');
        const btnRight = document.getElementById('btn-right');
        const btnRotateCW = document.getElementById('btn-rotate-cw'); 
        const btnRotateCCW = document.getElementById('btn-rotate-ccw'); 
        const btnHardDrop = document.getElementById('btn-hard-drop');

        if (btnLeft) btnLeft.addEventListener('click', () => movePuyo(-1, 0));
        if (btnRight) btnRight.addEventListener('click', () => movePuyo(1, 0));
        if (btnRotateCW) btnRotateCW.addEventListener('click', rotatePuyoCW); 
        if (btnRotateCCW) btnRotateCCW.addEventListener('click', rotatePuyoCCW); 
        if (btnHardDrop) btnHardDrop.addEventListener('click', hardDrop);
        
        setupEditModeListeners(); 
        document.initializedKeyHandler = true;
    }
    
    checkMobileControlsVisibility();
    renderBoard();
    
    // 最初の状態を履歴スタックに保存 (最初の操作ぷよが生成された状態)
    saveState(false); 
}

/**
 * 盤面リセット関数 (グローバル公開)
 */
window.resetGame = function() { 
    clearInterval(dropTimer); 
    initializeGame();
}

/**
 * モード切り替え関数 (グローバル公開)
 */
window.toggleMode = function() {
    const infoPanel = document.getElementById('info-panel');
    const modeToggleButton = document.querySelector('.mode-toggle-btn');
    const boardElement = document.getElementById('puyo-board');
    
    if (gameState === 'playing' || gameState === 'gameover') {
        // -> エディットモードへ切り替え
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
        // -> プレイモードへ切り替え
        gameState = 'playing';
        infoPanel.classList.remove('edit-mode-active');
        document.body.classList.remove('edit-mode-active'); 
        
        if (modeToggleButton) modeToggleButton.textContent = 'edit';
        
        checkMobileControlsVisibility();

        boardElement.removeEventListener('click', handleBoardClickEditMode);
        
        // エディットモードで配置した浮きぷよを重力で落として安定させる
        gravity(); 
        
        // エディットモードのネクスト設定をプレイモードに適用
        nextPuyoColors = JSON.parse(JSON.stringify(editingNextPuyos));
        
        currentPuyo = null; 
        generateNewPuyo(); 
        startPuyoDropLoop(); 
        
        // エディットモード後の最初の状態を履歴に保存
        saveState();
        
        renderBoard();
    }
}


// --- 履歴管理関数 ---

/**
 * 現在のゲーム状態を保存し、履歴スタックに追加する
 * (ぷよが固定され、連鎖に入る直前、またはゲーム開始時に呼ばれる)
 * @param {boolean} clearRedoStack - 新しい手を打った場合、Redoスタックをクリアする
 */
function saveState(clearRedoStack = true) {
    // ぷよ固定前の状態を保存
    const state = {
        board: board.map(row => [...row]),
        nextPuyoColors: nextPuyoColors.map(pair => [...pair]),
        score: score,
        chainCount: chainCount,
        // currentPuyoの状態も保存（操作中のぷよか、nullか）
        currentPuyo: currentPuyo ? { 
            mainColor: currentPuyo.mainColor,
            subColor: currentPuyo.subColor,
            mainX: currentPuyo.mainX, 
            mainY: currentPuyo.mainY, 
            rotation: currentPuyo.rotation
        } : null
    };

    historyStack.push(state);

    // 新しい手を打った場合 (Undo/Redo以外)、Redoスタックはクリア
    if (clearRedoStack) {
        redoStack = [];
    }
    updateHistoryButtons();
}

/**
 * 指定された状態にゲームを復元する
 * @param {object} state - 復元する状態オブジェクト
 */
function restoreState(state) {
    if (!state) return;

    board = state.board.map(row => [...row]);
    nextPuyoColors = state.nextPuyoColors.map(pair => [...pair]);
    score = state.score;
    chainCount = state.chainCount;
    
    // currentPuyoの復元
    if (state.currentPuyo) {
        currentPuyo = { ...state.currentPuyo };
    } else {
        currentPuyo = null;
    }
    
    // ゲーム状態とタイマーをリセット
    gameState = 'playing';
    clearInterval(dropTimer);
    
    // currentPuyoがnullの場合のみ、次の操作ぷよを生成する。
    if (currentPuyo === null) {
        generateNewPuyo(); 
    }
    
    // 盤面が復元された後、重力処理を実行して浮きぷよを落下させる
    gravity(); 

    // 状態復元後、現在の盤面に消えるべきぷよがあるかチェックする
    const groups = findConnectedPuyos();

    if (groups.length > 0) {
        // 消えるぷよがあれば、連鎖フェーズへ移行し、連鎖処理を開始
        gameState = 'chaining';
        chainCount = 0; // 新しい連鎖の開始
        runChain();
    } else {
        // 消えるぷよがなければ、落下ループを再開
        startPuyoDropLoop();
    }

    updateUI();
    renderBoard();
}

/**
 * 一手戻す (Undo)
 */
window.undoMove = function() {
    if (gameState !== 'playing' && gameState !== 'chaining') return; 
    if (historyStack.length <= 1) return; 

    // 1. 現在の状態をRedoスタックにプッシュ
    const currentState = historyStack.pop(); 
    redoStack.push(currentState);

    // 2. 過去の状態を復元
    const previousState = historyStack[historyStack.length - 1]; 
    restoreState(previousState);

    updateHistoryButtons();
}

/**
 * 一手やり直す (Redo)
 */
window.redoMove = function() {
    if (gameState !== 'playing' && gameState !== 'chaining') return; 
    if (redoStack.length === 0) return;

    // 1. Redoスタックから状態を取り出し
    const nextState = redoStack.pop();
    
    // 2. 履歴スタックにプッシュし直す
    historyStack.push(nextState); 

    // 3. 状態を復元
    restoreState(nextState);

    updateHistoryButtons();
}

/**
 * Undo/Redoボタンの有効/無効を更新
 */
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


/**
 * 自動落下ON/OFF切り替え関数 (グローバル公開)
 */
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

/**
 * パレットの色を選択し、ハイライトを更新
 */
function selectPaletteColor(color) {
    currentEditColor = color;
    document.querySelectorAll('.palette-color').forEach(p => p.classList.remove('selected'));
    const selectedPuyo = document.querySelector(`.palette-color[data-color="${color}"]`);
    if (selectedPuyo) {
        selectedPuyo.classList.add('selected');
    }
}

/**
 * エディットモードで盤面をクリックした際の処理
 */
function handleBoardClickEditMode(event) {
    if (gameState !== 'editing') return;
    
    const boardElement = document.getElementById('puyo-board');
    const rect = boardElement.getBoundingClientRect();
    const cellSize = rect.width / WIDTH; 

    let x = Math.floor((event.clientX - rect.left) / cellSize);
    let y_dom = Math.floor((event.clientY - rect.top) / cellSize); 

    // DOMのY座標 (上=0, 下=13) をデータ配列のY座標 (下=0, 上=13) に変換
    let y = HEIGHT - 1 - y_dom;

    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) { 
        board[y][x] = currentEditColor;
        renderBoard(); 
    }
}

/**
 * エディットモードで設定したネクストをプレイモードに反映する (グローバル公開)
 */
window.applyNextPuyos = function() {
    if (gameState === 'editing') {
        nextPuyoColors = JSON.parse(JSON.stringify(editingNextPuyos));
        alert('ネクストぷよの設定を保存しました。プレイモードで適用されます。');
    }
}

/**
 * ネクストぷよリストをランダムで再生成する (グローバル公開)
 */
window.clearEditNext = function() {
    if (gameState !== 'editing') return;
    
    // 50組をランダムなぷよで初期化
    editingNextPuyos = [];
    for (let i = 0; i < MAX_NEXT_PUYOS; i++) {
        editingNextPuyos.push(getRandomPair());
    }
    renderEditNextPuyos(); 
    alert('ネクストぷよリストをランダムで再生成しました。');
}


// --- ぷよの生成と操作 (プレイモード時のみ有効) ---

function getRandomColor() {
    // 1 (赤) から 4 (黄) までの色をランダムに返す
    return Math.floor(Math.random() * 4) + 1; 
}

function getRandomPair() {
    return [getRandomColor(), getRandomColor()];
}

function generateNewPuyo() {
    if (gameState !== 'playing') return;

    // ネクストリストが MAX_NEXT_PUYOS (50組) 未満の場合、補充
    while (nextPuyoColors.length < MAX_NEXT_PUYOS) {
        nextPuyoColors.push(getRandomPair());
    }
    
    // リストの先頭から1組取り出す: [メインの色, サブの色]
    const [c1, c2] = nextPuyoColors.shift();

    currentPuyo = {
        mainColor: c1,
        subColor: c2,
        mainX: 2, 
        mainY: HEIGHT - 2, // 14 - 2 = 12 
        rotation: 0 // 縦に並ぶ初期回転
    };
    
    // 初期配置で衝突チェック（ゲームオーバー判定）
    const startingCoords = getCoordsFromState(currentPuyo);
    if (checkCollision(startingCoords)) {
        gameState = 'gameover';
        alert('ゲームオーバーです！');
        clearInterval(dropTimer); 
        updateUI();
        renderBoard();
        return; 
    }

    // 次のネクストを補充（リストのサイズを MAX_NEXT_PUYOS に保つ）
    nextPuyoColors.push(getRandomPair());
}

/**
 * ぷよの状態から2つのぷよの座標 (x, y) を取得する
 */
function getCoordsFromState(puyoState) {
    const { mainX, mainY, rotation } = puyoState;
    let subX = mainX;
    let subY = mainY;

    // rotation: 0=上, 1=左, 2=下, 3=右 (メインぷよ基準)
    if (rotation === 0) subY = mainY + 1; // 上
    if (rotation === 1) subX = mainX - 1; // 左
    if (rotation === 2) subY = mainY - 1; // 下
    if (rotation === 3) subX = mainX + 1; // 右

    return [
        { x: mainX, y: mainY },
        { x: subX, y: subY }
    ];
}


/**
 * 現在の操作中のぷよの座標と色を取得する
 */
function getPuyoCoords() {
    if (!currentPuyo) return [];
    
    const coords = getCoordsFromState(currentPuyo);

    coords[0].color = currentPuyo.mainColor;
    coords[1].color = currentPuyo.subColor;
    
    return coords;
}

/**
 * 組ぷよが固定された後、ちぎりが発生した際の個々のぷよの最終落下位置を予測する
 */
function getGhostFinalPositions() {
    if (!currentPuyo || gameState !== 'playing') return [];
    
    let tempBoard = board.map(row => [...row]);

    let tempPuyo = { ...currentPuyo };
    // 落下可能な限り下に移動 (ゴーストぷよの位置を決定)
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
    
    // 1. ゴースト位置に仮配置する (シミュレーション用)
    finalCoordsBeforeGravity.forEach(p => {
        if (p.y >= 0 && p.y < HEIGHT) {
            const color = (p.x === tempPuyo.mainX && p.y === tempPuyo.mainY) 
                          ? tempPuyo.mainColor 
                          : tempPuyo.subColor;
            
            tempBoard[p.y][p.x] = color;
        }
    });

    // 2. 重力処理をシミュレート
    simulateGravity(tempBoard); 

    let ghostPositions = [];
    let puyoCount = 0;
    
    // 3. 元のボードがEMPTYで、シミュレーション後のボードに操作ぷよの色が入った場所を探す (ちぎりを含む最終位置)
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const tempColor = tempBoard[y][x];
            const originalColor = board[y][x];
            
            // オリジナルボードが空、かつシミュレーション後のボードに操作ぷよの色があり、かつそれが操作ぷよの数(2個)以内
            if (originalColor === COLORS.EMPTY && 
                puyoColors.includes(tempColor) && 
                puyoCount < 2) 
            {
                // その位置が操作ぷよの最終到達位置と見なせる
                ghostPositions.push({ x: x, y: y, color: tempColor });
                puyoCount++;
            }
        }
    }
    
    // 可視領域 (Y=0からY=11) のみ描画対象
    return ghostPositions.filter(p => p.y < HEIGHT - 2); 
}


function checkCollision(coords) {
    for (const puyo of coords) {
        // 盤面の左右または下にはみ出したら衝突
        if (puyo.x < 0 || puyo.x >= WIDTH || puyo.y < 0) return true;

        // 既にぷよがあるセルと衝突
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

function rotatePuyoCW() {
    if (gameState !== 'playing') return false;
    const newRotation = (currentPuyo.rotation + 1) % 4;
    
    // 回転後の座標で衝突する場合、ズラして回転を試みる（壁際回転）
    if (movePuyo(0, 0, newRotation)) return true; 
    if (movePuyo(1, 0, newRotation)) return true; // 右へズラして試行
    if (movePuyo(-1, 0, newRotation)) return true; // 左へズラして試行
    return false;
}

function rotatePuyoCCW() {
    if (gameState !== 'playing') return false;
    const newRotation = (currentPuyo.rotation - 1 + 4) % 4;

    // 回転後の座標で衝突する場合、ズラして回転を試みる
    if (movePuyo(0, 0, newRotation)) return true; 
    if (movePuyo(1, 0, newRotation)) return true; 
    if (movePuyo(-1, 0, newRotation)) return true; 
    return false;
}

function hardDrop() {
    if (gameState !== 'playing' || !currentPuyo) return;

    clearInterval(dropTimer); 

    // 衝突するまで下に移動
    while (movePuyo(0, -1, undefined, false)); 

    renderBoard(); 
    
    lockPuyo(); 
}

function lockPuyo() {
    if (gameState !== 'playing' || !currentPuyo) return;

    const coords = getPuyoCoords();
    let isGameOver = false;

    // 1. 盤面にぷよを固定
    for (const puyo of coords) {
        // 14列目 (Y=13, HEIGHT-1) に固定されたらゲームオーバー
        if (puyo.y >= HEIGHT - 1) { 
            isGameOver = true;
        }
        if (puyo.y >= 0) {
            board[puyo.y][puyo.x] = puyo.color;
        }
    }

    if (isGameOver) {
        gameState = 'gameover';
        alert('ゲームオーバーです！');
        clearInterval(dropTimer); 
        updateUI();
        renderBoard();
        return;
    }
    
    // 2. ぷよ固定完了
    currentPuyo = null;
    
    // 3. 履歴の保存（新しい手としてRedoスタックをクリア）
    saveState(true); 
    
    // 4. 連鎖開始
    gameState = 'chaining';
    chainCount = 0;
    
    runChain();
}

function findConnectedPuyos() {
    let disappearingGroups = [];
    let visited = Array(HEIGHT).fill(0).map(() => Array(WIDTH).fill(false));

    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const color = board[y][x];
            
            // おじゃまぷよ(5)は連鎖の核にはならないため無視
            if (color === COLORS.EMPTY || color === COLORS.GARBAGE || visited[y][x]) continue;

            let group = [];
            let stack = [{ x, y }];
            visited[y][x] = true;

            while (stack.length > 0) {
                const current = stack.pop();
                group.push(current);

                // 上下左右チェック
                [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dx, dy]) => {
                    const nx = current.x + dx;
                    const ny = current.y + dy;

                    if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT &&
                        !visited[ny][nx] && board[ny][nx] === color) {
                        
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

/**
 * 消去されたぷよの座標リストに基づき、その周囲（上下左右1マス）のおじゃまぷよを消去する。
 */
function clearGarbagePuyos(erasedCoords) {
    let clearedGarbageCount = 0;
    const garbageToClear = new Set(); 

    erasedCoords.forEach(({ x, y }) => {
        // 上下左右1マスをチェック
        [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dx, dy]) => {
            const nx = x + dx;
            const ny = y + dy;

            // 盤面の範囲内かチェック
            if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT) {
                // その位置がおじゃまぷよ(COLORS.GARBAGE: 5)かチェック
                if (board[ny][nx] === COLORS.GARBAGE) {
                    garbageToClear.add(`${nx}-${ny}`); 
                }
            }
        });
    });

    // 消去リストに基づき、盤面からおじゃまぷよを削除
    garbageToClear.forEach(coordKey => {
        const [nx, ny] = coordKey.split('-').map(Number);
        board[ny][nx] = COLORS.EMPTY;
        clearedGarbageCount++;
    });
    
    return clearedGarbageCount;
}


async function runChain() {
    
    // フェーズ1: 重力処理
    gravity(); 
    renderBoard(); 
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // フェーズ2: 連鎖チェック
    const groups = findConnectedPuyos();

    if (groups.length === 0) {
        // 連鎖終了。次のぷよへ
        gameState = 'playing';
        generateNewPuyo(); 
        startPuyoDropLoop(); 
        checkMobileControlsVisibility(); 
        renderBoard();
        return;
    }

    // フェーズ3: ぷよの削除とスコア計算
    chainCount++;

    let chainScore = calculateScore(groups, chainCount);
    score += chainScore;

    // 今回連鎖で消えるぷよの座標を記録するリスト
    let erasedCoords = [];
    
    groups.forEach(({ group }) => {
        group.forEach(({ x, y }) => {
            board[y][x] = COLORS.EMPTY; 
            erasedCoords.push({ x, y }); // 消去座標を記録
        });
    });

    // --- おじゃまぷよの巻き込み消去を実行 ---
    clearGarbagePuyos(erasedCoords);
    
    renderBoard(); 
    updateUI();

    // ぷよが消えたアニメーション待機
    await new Promise(resolve => setTimeout(resolve, 300));

    // フェーズ4: 次の連鎖へ（重力落下と再チェック）
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


// --- 描画とUI更新 ---

function renderBoard() {
    const isPlaying = gameState === 'playing';
    const currentPuyoCoords = isPlaying ? getPuyoCoords() : [];
    // 操作中のぷよがない場合、ゴーストぷよは計算しない
    const ghostPuyoCoords = isPlaying && currentPuyo ? getGhostFinalPositions() : []; 

    for (let y = HEIGHT - 1; y >= 0; y--) { 
        for (let x = 0; x < WIDTH; x++) {
            const cellElement = document.getElementById(`cell-${x}-${y}`);
            if (!cellElement) continue;

            const puyoElement = cellElement.firstChild; 
            
            let cellColor = board[y][x]; 
            let puyoClasses = `puyo puyo-${cellColor}`;
            
            // 優先順位: 1. 操作中ぷよ
            const puyoInFlight = currentPuyoCoords.find(p => p.x === x && p.y === y);
            if (puyoInFlight) {
                cellColor = puyoInFlight.color; 
                puyoClasses = `puyo puyo-${cellColor}`; 
            } 
            // 2. ゴーストぷよ (操作中ぷよがなければ)
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

/**
 * プレイモードのネクスト描画
 */
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
            
            slot.appendChild(createPuyo(c_sub)); // 上のぷよ (サブ)
            slot.appendChild(createPuyo(c_main)); // 下のぷよ (メイン)
        }
    });
}

/**
 * エディットモードのネクスト描画 (50手先までリスト表示)
 */
function renderEditNextPuyos() {
    const listContainer = document.getElementById('edit-next-list-container');
    const visibleSlots = [
        document.getElementById('edit-next-1'), 
        document.getElementById('edit-next-2')
    ];

    if (!listContainer || !visibleSlots[0] || !visibleSlots[1]) return;

    /**
     * クリックで編集可能なぷよ要素を作成するヘルパー関数
     */
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


    // --- 1. 現在のNEXT 1, NEXT 2 の描画 (リストの先頭 2つ) ---
    visibleSlots.forEach((slot, index) => {
        slot.innerHTML = '';
        if (editingNextPuyos.length > index) {
            const [c_main, c_sub] = editingNextPuyos[index];
            
            slot.appendChild(createEditablePuyo(c_sub, index, 1)); // 上のぷよ (サブ)
            slot.appendChild(createEditablePuyo(c_main, index, 0)); // 下のぷよ (メイン)
        }
    });

    // --- 2. 50手先までのリストの描画 ---
    listContainer.innerHTML = '';
    
    // NEXT 3 以降 (index 2 から MAX_NEXT_PUYOS - 1 まで)
    for (let i = NUM_VISIBLE_NEXT_PUYOS; i < MAX_NEXT_PUYOS; i++) {
        if (editingNextPuyos.length <= i) break;

        const pairContainer = document.createElement('div');
        pairContainer.className = 'next-puyo-slot-pair';

        // 手数 (例: N3, N4...)
        const countSpan = document.createElement('span');
        countSpan.textContent = `N${i + 1}`;
        pairContainer.appendChild(countSpan);
        
        // ぷよの行
        const puyoRow = document.createElement('div');
        puyoRow.className = 'next-puyo-row';
        
        const [c_main, c_sub] = editingNextPuyos[i];
        
        puyoRow.appendChild(createEditablePuyo(c_sub, i, 1)); // 上のぷよ (サブ)
        puyoRow.appendChild(createEditablePuyo(c_main, i, 0)); // 下のぷよ (メイン)

        pairContainer.appendChild(puyoRow);
        listContainer.appendChild(pairContainer);
    }
}


function updateUI() {
    document.getElementById('score').textContent = score;
    document.getElementById('chain-count').textContent = chainCount;
    updateHistoryButtons(); // スコア等の更新時にボタンの状態も確認
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
            // Undo/Redoと衝突しないよう、キーバインドのif文で制御済み
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
            event.preventDefault(); // スペースキーによるスクロールを防止
            hardDrop(); 
            break;
    }
}

// ゲーム開始
document.addEventListener('DOMContentLoaded', () => {
    initializeGame();
    // resizeイベントのリスナーを追加し、モバイル表示を再チェック
    window.addEventListener('resize', checkMobileControlsVisibility);
});
