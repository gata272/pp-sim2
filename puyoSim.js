// puyoSim.js

// --- ぷよぷよシミュレーションの定数と設定 ---

// 盤面サイズ
const WIDTH = 6;
const HEIGHT = 14; // 可視領域12 + 隠し領域2

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
let nextPuyoColors = []; 
let score = 0;
let chainCount = 0;
let gameState = 'playing'; // 'playing', 'chaining', 'gameover', 'editing'
let currentEditColor = COLORS.RED; // エディットモードで選択中の色 (デフォルトは赤)
let editingNextPuyos = []; // エディットモードで編集中のネクストぷよリスト

// --- 落下ループのための変数 ---
let dropInterval = 1000; // 1秒ごとに落下
let dropTimer = null; 


// --- 初期化関数 ---

/**
 * 盤面のDOM要素を一度だけ生成する (6列x12行)
 */
function createBoardDOM() {
    const boardElement = document.getElementById('puyo-board');
    boardElement.innerHTML = ''; // 既存のものをクリア

    // 描画は可視領域 (HEIGHT - 2 = 12行) のみ。y=11からy=0の順で配置
    for (let y = HEIGHT - 3; y >= 0; y--) { 
        for (let x = 0; x < WIDTH; x++) {
            const cell = document.createElement('div');
            // セルを一意に識別するためのIDを付与
            cell.id = `cell-${x}-${y}`; 
            
            // 内部のぷよ要素 (常に存在させる)
            const puyo = document.createElement('div');
            puyo.className = 'puyo puyo-0'; // 初期は空
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
    // 1. 盤面DOMを一度だけ構築 (描画バグ修正のため)
    createBoardDOM(); 
    
    // 2. 盤面データを空で初期化
    for (let y = 0; y < HEIGHT; y++) {
        board[y] = [];
        for (let x = 0; x < WIDTH; x++) {
            board[y][x] = COLORS.EMPTY;
        }
    }

    score = 0;
    chainCount = 0;
    gameState = 'playing';

    // ネクストぷよリストを完全にランダムなぷよで初期化 (最低2組)
    nextPuyoColors = [getRandomPair(), getRandomPair()];
    // エディット用のネクストリストも初期化
    editingNextPuyos = JSON.parse(JSON.stringify(nextPuyoColors));

    // 初期状態はプレイモードなので、エディットモードへのテキストを設定
    const modeToggleButton = document.getElementById('mode-toggle-button');
    if (modeToggleButton) {
        modeToggleButton.textContent = 'edit';
    }
    
    // #info-panelのクラスをリセット
    const infoPanel = document.getElementById('info-panel');
    if (infoPanel) infoPanel.classList.remove('edit-mode-active');

    // 最初のぷよを生成し、落下ループを開始
    generateNewPuyo(); 
    startPuyoDropLoop(); 
    
    updateUI();
    
    // イベントリスナーの設定
    if (!document.initializedKeyHandler) {
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
        
        selectPaletteColor(currentEditColor); 
        renderEditNextPuyos(); 
        renderBoard(); 
        
    } else if (gameState === 'editing') {
        // -> プレイモードへ切り替え
        gameState = 'playing';
        infoPanel.classList.remove('edit-mode-active');
        
        if (modeToggleButton) modeToggleButton.textContent = 'edit';
        
        checkMobileControlsVisibility();

        boardElement.removeEventListener('click', handleBoardClickEditMode);
        
        // ★ DOMを確実にリフレッシュ (描画バグ対策)
        createBoardDOM(); 
        
        currentPuyo = null; 
        generateNewPuyo(); 
        startPuyoDropLoop(); 
        
        renderBoard();
    }
}


// --- メインゲームループ ---

function startPuyoDropLoop() {
    if (dropTimer) clearInterval(dropTimer);
    if (gameState === 'playing') {
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


// --- エディットモード機能 (変更なし) ---

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
    let y = Math.floor((rect.bottom - event.clientY) / cellSize);

    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT - 2) { 
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
    return Math.floor(Math.random() * 4) + 1; 
}

function getRandomPair() {
    return [getRandomColor(), getRandomColor()];
}

function generateNewPuyo() {
    if (gameState !== 'playing') return;

    if (nextPuyoColors.length < 2) {
        while (nextPuyoColors.length < 2) {
            nextPuyoColors.push(getRandomPair());
        }
    }
    
    const [c1, c2] = nextPuyoColors.shift();

    currentPuyo = {
        mainColor: c1,
        subColor: c2,
        mainX: 2, 
        mainY: HEIGHT - 3, 
        rotation: 0 
    };
    
    const startingCoords = getCoordsFromState(currentPuyo);
    if (checkCollision(startingCoords)) {
        gameState = 'gameover';
        alert('ゲームオーバーです！');
        clearInterval(dropTimer); 
        updateUI();
        renderBoard();
        return; 
    }

    nextPuyoColors.push(getRandomPair());
}

/**
 * ぷよの状態から2つのぷよの座標 (x, y) を取得する
 */
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
    while (true) {
        let testPuyo = { ...tempPuyo, mainY: tempPuyo.mainY - 1 };
        const testCoords = getCoordsFromState(testPuyo);
        
        if (checkCollision(testCoords)) {
            break; 
        }
        tempPuyo.mainY -= 1; 
    }
    
    const fixedCoords = getCoordsFromState(tempPuyo);
    const puyo1Color = tempPuyo.mainColor;
    const puyo2Color = tempPuyo.subColor;
    const puyoColors = [puyo1Color, puyo2Color];
    
    
    fixedCoords.forEach(p => {
        if (p.y >= 0 && p.y < HEIGHT) {
            const color = (p.x === tempPuyo.mainX && p.y === tempPuyo.mainY) 
                          ? puyo1Color 
                          : puyo2Color;
            
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
                tempColor !== COLORS.EMPTY &&
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

function rotatePuyoCW() {
    if (gameState !== 'playing') return false;
    const newRotation = (currentPuyo.rotation + 1) % 4;
    if (movePuyo(0, 0, newRotation)) return true; 
    if (movePuyo(1, 0, newRotation)) return true; 
    if (movePuyo(-1, 0, newRotation)) return true; 
    return false;
}

function rotatePuyoCCW() {
    if (gameState !== 'playing') return false;
    const newRotation = (currentPuyo.rotation - 1 + 4) % 4;
    if (movePuyo(0, 0, newRotation)) return true; 
    if (movePuyo(1, 0, newRotation)) return true; 
    if (movePuyo(-1, 0, newRotation)) return true; 
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
    let isGameOver = false;

    for (const puyo of coords) {
        if (puyo.y >= HEIGHT - 2) { 
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

/**
 * 渡された盤面データに対して、ぷよの落下処理のみを実行する。
 */
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

/**
 * 盤面を描画し、落下中のぷよ、ゴーストぷよを処理する
 */
function renderBoard() {
    const isPlaying = gameState === 'playing';
    const currentPuyoCoords = isPlaying ? getPuyoCoords() : [];
    const ghostPuyoCoords = isPlaying ? getGhostFinalPositions() : []; 

    // 描画は可視領域 (y=11 から y=0) のみ
    for (let y = HEIGHT - 3; y >= 0; y--) { 
        for (let x = 0; x < WIDTH; x++) {
            const cellElement = document.getElementById(`cell-${x}-${y}`);
            if (!cellElement) continue;

            const puyoElement = cellElement.firstChild; 
            
            let cellColor = board[y][x]; 
            let puyoClasses = `puyo puyo-${cellColor}`;
            
            // 優先順位: 1. 操作中ぷよ, 2. ゴーストぷよ, 3. 盤面データ
            
            // 1. 落下中のぷよ
            const puyoInFlight = currentPuyoCoords.find(p => p.x === x && p.y === y);
            if (puyoInFlight) {
                cellColor = puyoInFlight.color; 
                puyoClasses = `puyo puyo-${cellColor}`; 
            } 
            // 2. ゴーストぷよ (操作中ぷよがなければ)
            else {
                const puyoGhost = ghostPuyoCoords.find(p => p.x === x && puyo.y === y);
                if (puyoGhost) {
                    cellColor = puyoGhost.color; 
                    puyoClasses = `puyo puyo-${cellColor} puyo-ghost`;
                }
            }
            
            // 3. 盤面データ (何もなければそのまま)
            
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

    next1Element.innerHTML = '';
    next2Element.innerHTML = '';

    const createPuyo = (color) => {
        let puyo = document.createElement('div');
        puyo.className = `puyo puyo-${color}`;
        return puyo;
    };
    
    if (nextPuyoColors.length >= 1) {
        const [c1_1, c1_2] = nextPuyoColors[0];
        next1Element.appendChild(createPuyo(c1_1)); 
        next1Element.appendChild(createPuyo(c1_2)); 
    }

    if (nextPuyoColors.length >= 2) {
        const [c2_1, c2_2] = nextPuyoColors[1];
        next2Element.appendChild(createPuyo(c2_1)); 
        next2Element.appendChild(createPuyo(c2_2)); 
    }
}

/**
 * エディットモードのネクスト描画 (タップイベントの組み込み)
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
                editingNextPuyos[listIndex][puyoIndex] = currentEditColor; 
                selectPaletteColor(currentEditColor);
                renderEditNextPuyos(); 
            }
        });
        
        return puyo;
    };
    
    slots.forEach((slot, listIndex) => { 
        if (!slot) return;
        slot.innerHTML = '';
        if (editingNextPuyos[listIndex]) {
            const [c1, c2] = editingNextPuyos[listIndex];
            slot.appendChild(createPuyo(c1, listIndex, 0)); 
            slot.appendChild(createPuyo(c2, listIndex, 1)); 
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
            startPuyoDropLoop(); 
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
