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
    // 1. 盤面DOMを一度だけ構築
    createBoardDOM(); 
    
    // 2. 盤面データを空で初期化
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
    currentEditColor = COLORS.EMPTY; // エディットモードの初期色をリセット

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

    // 最初のぷよを生成
    generateNewPuyo(); 
    startPuyoDropLoop(); 
    
    updateUI();
    
    // イベントリスナーの設定 (初回のみ)
    if (!document.initializedKeyHandler) {
        document.addEventListener('keydown', handleInput);
        
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
        
        // 消しゴム (COLORS.EMPTY = 0) を初期選択色にする
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
        
        // ★修正点１: createBoardDOM() の呼び出しを削除 (DOM再利用) ★
        // createBoardDOM(); 
        
        // ★修正点２: エディットモードで設定したネクストをプレイモードに適用★
        nextPuyoColors = JSON.parse(JSON.stringify(editingNextPuyos));
        
        currentPuyo = null; 
        generateNewPuyo(); 
        startPuyoDropLoop(); 
        
        renderBoard();
    }
}


// --- メインゲームループ ---

function startPuyoDropLoop() {
    if (dropTimer) clearInterval(dropTimer);
    // autoDropEnabled が true の場合のみタイマーをセット
    if (gameState === 'playing' && autoDropEnabled) { 
        dropTimer = setInterval(dropPuyo, dropInterval);
    }
}

function dropPuyo() {
    if (gameState !== 'playing' || !currentPuyo) return;

    // 1マス下に移動を試行
    const moved = movePuyo(0, -1, undefined, true);

    if (!moved) {
        // 移動できなかった場合、固定
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
    
    // 状態を反転
    autoDropEnabled = !autoDropEnabled;

    if (autoDropEnabled) {
        // ONに戻す場合
        button.textContent = '自動落下: ON';
        button.classList.remove('disabled');
        if (gameState === 'playing') {
             // プレイモードであれば、タイマーを再開
            startPuyoDropLoop();
        }
    } else {
        // OFFにする場合
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

    // ネクストリストが足りない場合、ランダムに補充
    while (nextPuyoColors.length < NUM_NEXT_PUYOS) {
        nextPuyoColors.push(getRandomPair());
    }
    
    // リストの先頭から1組取り出す: [メインの色, サブの色]
    const [c1, c2] = nextPuyoColors.shift();

    currentPuyo = {
        mainColor: c1,
        subColor: c2,
        mainX: 2, 
        // メインぷよの初期Y座標を Y=12 (隠し領域の1列目) に設定 
        mainY: HEIGHT - 2, // 14 - 2 = 12 
        rotation: 0 // 縦に並ぶ初期回転 (サブぷよがメインぷよの上に乗る状態)
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

    // 次のネクストを補充
    nextPuyoColors.push(getRandomPair());
}

/**
 * ぷよの状態から2つのぷよの座標 (x, y) を取得する
 */
function getCoordsFromState(puyoState) {
    const { mainX, mainY, rotation } = puyoState;
    let subX = mainX;
    let subY = mainY;

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
    // 落下可能な限り下に移動
    while (true) {
        let testPuyo = { ...tempPuyo, mainY: tempPuyo.mainY - 1 };
        const testCoords = getCoordsFromState(testPuyo);
        
        if (checkCollision(testCoords)) {
            break; 
        }
        tempPuyo.mainY -= 1; 
    }
    
    const fixedCoords = getCoordsFromState(tempPuyo);
    const puyoColors = [tempPuyo.mainColor, tempPuyo.subColor];
    
    // 仮配置: 最終位置にぷよを置く
    fixedCoords.forEach(p => {
        if (p.y >= 0 && p.y < HEIGHT) {
            const color = (p.x === tempPuyo.mainX && p.y === tempPuyo.mainY) 
                          ? tempPuyo.mainColor 
                          : tempPuyo.subColor;
            
            tempBoard[p.y][p.x] = color;
        }
    });

    // 重力処理をシミュレート
    simulateGravity(tempBoard); 

    let ghostPositions = [];
    let puyoCount = 0;
    
    // 元のボードがEMPTYで、シミュレーション後のボードに操作ぷよの色が入った場所を探す
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const tempColor = tempBoard[y][x];
            const originalColor = board[y][x];
            
            if (originalColor === COLORS.EMPTY && 
                tempColor !== COLORS.EMPTY &&
                puyoColors.includes(tempColor) && 
                puyoCount < 2) 
            {
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

function rotatePuyoCW() {
    if (gameState !== 'playing') return false;
    const newRotation = (currentPuyo.rotation + 1) % 4;
    // 衝突チェック（通常、右、左の順）
    if (movePuyo(0, 0, newRotation)) return true; 
    if (movePuyo(1, 0, newRotation)) return true; 
    if (movePuyo(-1, 0, newRotation)) return true; 
    return false;
}

function rotatePuyoCCW() {
    if (gameState !== 'playing') return false;
    const newRotation = (currentPuyo.rotation - 1 + 4) % 4;
    // 衝突チェック（通常、右、左の順）
    if (movePuyo(0, 0, newRotation)) return true; 
    if (movePuyo(1, 0, newRotation)) return true; 
    if (movePuyo(-1, 0, newRotation)) return true; 
    return false;
}

function hardDrop() {
    if (gameState !== 'playing' || !currentPuyo) return;

    clearInterval(dropTimer); 

    // 落下できる限り落下させる
    while (movePuyo(0, -1, undefined, false)); 

    renderBoard(); 
    
    lockPuyo(); 
}

function lockPuyo() {
    if (gameState !== 'playing' || !currentPuyo) return;

    const coords = getPuyoCoords();
    let isGameOver = false;

    for (const puyo of coords) {
        // 14列目 (Y=13, HEIGHT-1) に固定されたらゲームオーバー
        if (puyo.y >= HEIGHT - 1) { 
            isGameOver = true;
            break;
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
    
    currentPuyo = null;
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

    groups.forEach(({ group }) => {
        group.forEach(({ x, y }) => {
            board[y][x] = COLORS.EMPTY; 
        });
    });

    renderBoard(); 
    updateUI();

    await new Promise(resolve => setTimeout(resolve, 300));

    // フェーズ4: 次の連鎖へ
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
    const ghostPuyoCoords = isPlaying ? getGhostFinalPositions() : []; 

    // 描画は全領域 (y=13 から y=0) を行う
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
 * プレイモードのネクスト描画 (メイン=下, サブ=上)
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
            // nextPuyoColors[i] は [メインの色(0), サブの色(1)]
            const [c_main, c_sub] = nextPuyoColors[index]; 
            
            // メインぷよ (c_main) が下、サブぷよ (c_sub) が上
            slot.appendChild(createPuyo(c_main)); 
            slot.appendChild(createPuyo(c_sub)); 
        }
    });
}

/**
 * エディットモードのネクスト描画 (メイン=下, サブ=上, タップイベント組み込み)
 */
function renderEditNextPuyos() {
    const slots = [document.getElementById('edit-next-1'), document.getElementById('edit-next-2')];
    
    const createPuyo = (color, listIndex, puyoIndex) => {
        let puyo = document.createElement('div');
        puyo.className = `puyo puyo-${color}`;
        
        puyo.addEventListener('click', (event) => {
            event.stopPropagation(); 
            if (gameState !== 'editing') return;
            
            if (editingNextPuyos.length > listIndex) {
                // puyoIndex: 0=メイン, 1=サブ
                editingNextPuyos[listIndex][puyoIndex] = currentEditColor; 
                renderEditNextPuyos(); 
            }
        });
        
        return puyo;
    };
    
    slots.forEach((slot, listIndex) => { 
        if (!slot) return;
        slot.innerHTML = '';
        if (editingNextPuyos.length > listIndex) {
            // [c_main (0), c_sub (1)] の形式
            const [c_main, c_sub] = editingNextPuyos[listIndex];
            
            // メインぷよ (c_main) が下、サブぷよ (c_sub) が上
            slot.appendChild(createPuyo(c_main, listIndex, 0)); // 下のぷよ (メイン)
            slot.appendChild(createPuyo(c_sub, listIndex, 1)); // 上のぷよ (サブ)
        }
    });
}


function updateUI() {
    document.getElementById('score').textContent = score;
    document.getElementById('chain-count').textContent = chainCount;
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
            // 自動落下OFF時は、手動落下後はタイマーを再開しない
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
