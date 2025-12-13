// puyoSim.js

// --- ぷよぷよシミュレーションの定数と設定 ---

// 盤面サイズ
const WIDTH = 6;
const HEIGHT = 14; 
const VISIBLE_HEIGHT = 12; 
const TOP_HIDDEN_ROW = HEIGHT - 1; 
const START_Y = HEIGHT - 2; 
const NUM_NEXT_PUYOS = 2; 
const NEXT_MAX_COUNT = 50; 

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
let gameState = 'playing'; 
let currentEditColor = COLORS.EMPTY; 
let editingNextPuyos = []; 

// --- 落下ループのための変数 ---
let dropInterval = 1000; 
let dropTimer = null; 
let autoDropEnabled = false;


// --- 初期化関数 ---

/**
 * 盤面のDOM要素を一度だけ生成する (6列x14行)
 */
function createBoardDOM() {
    const boardElement = document.getElementById('puyo-board');
    boardElement.innerHTML = ''; 

    for (let y = HEIGHT - 1; y >= 0; y--) { 
        for (let x = 0; x < WIDTH; x++) {
            const cell = document.createElement('div');
            cell.id = `cell-${x}-${y}`; 
            
            cell.addEventListener('click', handleBoardClickEditMode);

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

    if (gameState === 'playing' && window.innerWidth <= 800) {
        mobileControls.style.display = 'flex';
    } else {
        mobileControls.style.display = 'none';
    }
}

/**
 * ゲームの初期化、またはリセットを行う
 */
function initializeGame() {
    if (document.getElementById('puyo-board').children.length === 0) {
        createBoardDOM(); 
    }
    
    for (let y = 0; y < HEIGHT; y++) {
        board[y] = Array(WIDTH).fill(COLORS.EMPTY);
    }

    score = 0;
    chainCount = 0;
    gameState = 'playing';
    currentPuyo = null;

    nextPuyoColors = [getRandomPair(), getRandomPair()];
    if (editingNextPuyos.length === 0 || editingNextPuyos.length < NEXT_MAX_COUNT) {
        editingNextPuyos = [];
        for (let i = 0; i < NEXT_MAX_COUNT; i++) {
            editingNextPuyos.push(getRandomPair());
        }
    }
    
    document.body.classList.remove('edit-mode-active');
    
    const autoDropButton = document.getElementById('auto-drop-toggle-button');
    if (autoDropButton) {
        autoDropEnabled = false; 
        autoDropButton.textContent = '自動落下: OFF';
        autoDropButton.classList.add('disabled');
    }

    generateNewPuyo(); 
    updateUI();
    
    if (!document.initializedKeyHandler) {
        document.addEventListener('keydown', handleInput);
        
        document.getElementById('btn-left')?.addEventListener('click', () => movePuyo(-1, 0));
        document.getElementById('btn-right')?.addEventListener('click', () => movePuyo(1, 0));
        
        // ★ モバイル操作ボタンの割り当てを変更
        // btn-rotate-ccw が左側 (Bボタン)
        document.getElementById('btn-rotate-ccw')?.addEventListener('click', rotatePuyoCCW); 
        // btn-rotate-cw が右側 (Aボタン)
        document.getElementById('btn-rotate-cw')?.addEventListener('click', rotatePuyoCW); 
        
        document.getElementById('btn-hard-drop')?.addEventListener('click', hardDrop);
        
        setupEditModeListeners(); 
        document.initializedKeyHandler = true;
    }
    
    checkMobileControlsVisibility();
    renderBoard();
}

// ... (他の関数: resetGame, toggleMode, startPuyoDropLoop, dropPuyo, toggleAutoDrop, 
//      setupEditModeListeners, selectPaletteColor, handleBoardClickEditMode, 
//      renderEditNextListDOM, clearEditNext, getRandomColor, getRandomPair, 
//      generateNewPuyo, getCoordsFromState, getPuyoCoords, getGhostFinalPositions, 
//      checkCollision, movePuyo, rotatePuyoCW, rotatePuyoCCW, hardDrop, lockPuyo, 
//      findConnectedPuyos, runChain, calculateScore, simulateGravity, gravity は省略)
// ... (中略。前回のコードと同一の内容です。)


// --- 落下中のぷよを盤面に固定する (lockPuyo) ---
function lockPuyo() {
    if (gameState !== 'playing' || !currentPuyo) return;

    const coords = getPuyoCoords();
    let isGameOver = false;

    for (const puyo of coords) {
        if (puyo.y >= TOP_HIDDEN_ROW) { 
            isGameOver = true;
        }
        if (puyo.y >= 0 && puyo.y < HEIGHT) {
            board[puyo.y][puyo.x] = puyo.color;
        }
    }

    currentPuyo = null;
    renderBoard(); 

    if (isGameOver) {
        gameState = 'gameover';
        alert('ゲームオーバーです！');
        clearInterval(dropTimer); 
        updateUI();
        return;
    }
    
    gameState = 'chaining';
    chainCount = 0;
    
    setTimeout(runChain, 50); 
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
        if (autoDropEnabled) startPuyoDropLoop(); 
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

    const totalScore = Math.floor((10 * totalPuyos) * finalBonus); 

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

/**
 * 盤面全体 (固定ぷよ、操作ぷよ、ゴーストぷよ) を描画する
 */
function renderBoard() {
    const isPlaying = gameState === 'playing' && currentPuyo;
    const currentPuyoCoords = isPlaying ? getPuyoCoords() : [];
    
    // ★ ゴーストぷよの座標と色を計算
    const ghostPuyoCoords = isPlaying ? getGhostFinalPositions() : []; 

    for (let y = HEIGHT - 1; y >= 0; y--) { 
        for (let x = 0; x < WIDTH; x++) {
            const cellElement = document.getElementById(`cell-${x}-${y}`);
            if (!cellElement) continue;

            const puyoElement = cellElement.firstChild; 
            
            let cellColor = board[y][x]; 
            let puyoClasses = `puyo puyo-${cellColor}`;
            
            // 1. 操作中ぷよのチェック (最優先)
            const puyoInFlight = currentPuyoCoords.find(p => p.x === x && p.y === y);
            if (puyoInFlight) {
                cellColor = puyoInFlight.color; 
                puyoClasses = `puyo puyo-${cellColor}`; 
            } 
            // 2. ゴーストぷよのチェック (操作中ぷよがなく、かつ固定ぷよがなければ描画)
            else if (cellColor === COLORS.EMPTY) { 
                const puyoGhost = ghostPuyoCoords.find(p => p.x === x && p.y === y);
                if (puyoGhost) {
                    // ★ puyo-N クラスと puyo-ghost クラスの両方を付与し、色情報を渡す
                    cellColor = puyoGhost.color; 
                    puyoClasses = `puyo puyo-${puyoGhost.color} puyo-ghost`;
                }
            }
            // 3. 固定ぷよ
            
            puyoElement.className = puyoClasses;
            puyoElement.setAttribute('data-color', cellColor);
        }
    }

    if (gameState === 'playing') {
        renderPlayNextPuyo();
    } 
}

/**
 * プレイモードのネクスト描画
 */
function renderPlayNextPuyo() {
    const next1Slot = document.getElementById('next-puyo-1');
    const next2Slot = document.getElementById('next-puyo-2');
    
    if (!next1Slot || !next2Slot) return;

    const drawSlotPuyos = (slotElement, colors) => {
        slotElement.innerHTML = '';
        if (colors) {
            const [c_main, c_sub] = colors; 
            
            const createPuyoDiv = (color) => {
                let puyo = document.createElement('div');
                puyo.className = `puyo puyo-${color}`;
                return puyo;
            };
            
            slotElement.appendChild(createPuyoDiv(c_sub)); // 上のぷよ (サブ)
            slotElement.appendChild(createPuyoDiv(c_main)); // 下のぷよ (メイン)
        }
    };
    
    drawSlotPuyos(next1Slot, nextPuyoColors[0]);
    drawSlotPuyos(next2Slot, nextPuyoColors[1]);
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
            // ★ Aボタン (Zキー) で時計回り (CW) 
            rotatePuyoCW(); 
            break;
        case 'x': 
        case 'X':
            // ★ Bボタン (Xキー) で反時計回り (CCW) 
            rotatePuyoCCW(); 
            break;
        case 'ArrowDown':
            if (dropTimer) clearInterval(dropTimer); 
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
