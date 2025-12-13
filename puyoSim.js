// puyoSim.js

// --- ぷよぷよシミュレーションの定数と設定 ---

// 盤面サイズ
const WIDTH = 6;
const HEIGHT = 14; // 可視領域12 + 隠し領域2 (Y=0 から Y=13)
const NUM_NEXT_PUYOS = 2; // NEXT 1 と NEXT 2 の 2組

// ぷよの色定義
const COLORS = {
    EMPTY: 0,
    RED: 1,
    BLUE: 2,
    GREEN: 3,
    YELLOW: 4,
    GARBAGE: 5
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
let nextPuyoColors = []; // [ [c1, c2], [c3, c4] ] の形式でNEXT 2組を保持
let score = 0;
let chainCount = 0;
let gameState = 'playing'; // 'playing', 'chaining', 'gameover', 'editing'
let currentEditColor = COLORS.EMPTY; // エディットモードで選択中の色 (デフォルトは消しゴム: 0)
let editingNextPuyos = []; 

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
    // DOMが既に存在する場合は何もしない (重要な修正)
    if (boardElement.children.length > 0) return; 
    
    boardElement.innerHTML = ''; 

    // 描画は全領域 (HEIGHT = 14行) を行う。y=13からy=0の順で配置
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
        mobileControls.style.display = 'flex';
    } else {
        mobileControls.style.display = 'none';
    }
}


function initializeGame() {
    // ★修正点: createBoardDOM() の呼び出しを初回DOMロード時のみにするため、ここから削除★
    
    // 盤面データのリセット
    for (let y = 0; y < HEIGHT; y++) {
        board[y] = Array(WIDTH).fill(COLORS.EMPTY);
    }

    score = 0;
    chainCount = 0;
    gameState = 'playing';

    // ネクストぷよリストを完全にランダムなぷよで初期化
    nextPuyoColors = [getRandomPair(), getRandomPair()];
    // エディット用のネクストリストも初期化
    editingNextPuyos = JSON.parse(JSON.stringify(nextPuyoColors));
    currentEditColor = COLORS.EMPTY; 

    // UIリセット
    const modeToggleButton = document.getElementById('mode-toggle-button');
    if (modeToggleButton) modeToggleButton.textContent = 'edit';
    const infoPanel = document.getElementById('info-panel');
    if (infoPanel) infoPanel.classList.remove('edit-mode-active');
    
    // 自動落下ボタンの初期化
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

    // 重力処理と盤面表示の更新
    gravity(); 
    renderBoard(); 
    
    // 最初のぷよを生成
    generateNewPuyo(); 
    startPuyoDropLoop(); 
    
    updateUI();
    
    // イベントリスナーの設定 (初回のみ)
    if (!document.initializedKeyHandler) {
        // ... (イベントリスナーの設定ロジックは変更なし) ...
        document.addEventListener('keydown', handleInput);
        
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
}

/**
 * 盤面リセット関数 (グローバル公開)
 */
window.resetGame = function() { 
    clearInterval(dropTimer); 
    // ★修正点: createBoardDOM() の呼び出しを削除★
    initializeGame();
}

/**
 * モード切り替え関数 (グローバル公開)
 */
window.toggleMode = function() {
    const infoPanel = document.getElementById('info-panel');
    const modeToggleButton = document.getElementById('mode-toggle-button');
    const boardElement = document.getElementById('puyo-board');
    
    if (gameState === 'playing' || gameState === 'gameover') {
        // -> エディットモードへ切り替え
        clearInterval(dropTimer); 
        gameState = 'editing';
        infoPanel.classList.add('edit-mode-active');
        
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
        
        if (modeToggleButton) modeToggleButton.textContent = 'edit';
        
        checkMobileControlsVisibility();

        boardElement.removeEventListener('click', handleBoardClickEditMode);
        
        // ★修正点: createBoardDOM() を削除。DOMを再構築するとデータが消えるため。★
        // createBoardDOM(); // <-- 削除
        
        // エディットモードで配置したぷよに重力をかけ、描画を更新
        gravity(); 
        renderBoard(); // エディットで配置されたぷよを描画
        
        currentPuyo = null; 
        generateNewPuyo(); 
        startPuyoDropLoop(); 
        
        // renderBoard() は generateNewPuyo() の中で呼ばれるが、念のため
        renderBoard();
    }
}


// --- メインゲームループ ---
// ... (その他の関数は変更なし) ...

// ゲーム開始
document.addEventListener('DOMContentLoaded', () => {
    // ★修正点: DOMContentLoaded でまずDOMを作成し、それからゲームを初期化する★
    createBoardDOM(); 
    initializeGame();
    window.addEventListener('resize', checkMobileControlsVisibility);
});
