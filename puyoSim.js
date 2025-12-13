// puyoSim.js

// --- ぷよぷよシミュレーションの定数と設定 ---

// 盤面サイズ
const WIDTH = 6;
const HEIGHT = 14; // 可視領域12 + 隠し領域2 (Y=0 から Y=13)
const VISIBLE_HEIGHT = 12; // 可視領域の高さ (Y=0 から Y=11)
const TOP_HIDDEN_ROW = HEIGHT - 1; // Y=13 (最上段、隠し領域の上端)
const START_Y = HEIGHT - 2; // Y=12 からスタート
const NUM_NEXT_PUYOS = 2; // NEXT 1 と NEXT 2 の 2組
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
let gameState = 'playing'; // 'playing', 'chaining', 'gameover', 'editing'
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
        
        // ★ Bボタン (左側) のIDが 'btn-rotate-ccw'、Aボタン (右側) のIDが 'btn-rotate-cw' と仮定し、
        // 機能を入れ替える。
        // モバイル操作: B (CCW) -> CW, A (CW) -> CCW
        
        // BボタンのDOM (ID: btn-rotate-ccw) に、CWの機能（時計回り）を割り当てる
        document.getElementById('btn-rotate-ccw')?.addEventListener('click', rotatePuyoCW); 
        // AボタンのDOM (ID: btn-rotate-cw) に、CCWの機能（反時計回り）を割り当てる
        document.getElementById('btn-rotate-cw')?.addEventListener('click', rotatePuyoCCW); 
        
        document.getElementById('btn-hard-drop')?.addEventListener('click', hardDrop);
        
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
    
    if (gameState === 'playing' || gameState === 'gameover') {
        // -> エディットモードへ切り替え
        clearInterval(dropTimer); 
        gameState = 'editing';
        document.body.classList.add('edit-mode-active');
        
        checkMobileControlsVisibility();
        
        selectPaletteColor(COLORS.EMPTY); 
        renderEditNextListDOM();
        renderBoard(); 
        
    } else if (gameState === 'editing') {
        // -> プレイモードへ切り替え
        gameState = 'playing';
        document.body.classList.remove('edit-mode-active');
        
        checkMobileControlsVisibility();
        
        gravity(); 
        
        nextPuyoColors = editingNextPuyos.slice(0, NUM_NEXT_PUYOS);
        
        currentPuyo = null; 
        generateNewPuyo(); 
        if (autoDropEnabled) startPuyoDropLoop(); 
        
        renderBoard();
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


// --- エディットモード機能 (中略) ---

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
    renderEditNextListDOM();
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
    if (gameState !== 'editing' && !document.body.classList.contains('edit-mode-active')) return;
    
    const targetCell = event.currentTarget;
    const x = parseInt(targetCell.id.split('-')[1]);
    const y = parseInt(targetCell.id.split('-')[2]);
    
    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) { 
        board[y][x] = currentEditColor;
        renderBoard(); 
    }
}


/**
 * エディットモードの50手先ネクストリストをDOMに描画する
 */
function renderEditNextListDOM() {
    const container = document.getElementById('edit-next-list-container');
    if (!container) return;
    container.innerHTML = '';

    editingNextPuyos.forEach((pair, index) => {
        const [c_main, c_sub] = pair;
        
        const pairDiv = document.createElement('div');
        pairDiv.className = 'next-puyo-slot-pair';
        
        const indexSpan = document.createElement('span');
        indexSpan.textContent = `(${index + 1})`;
        pairDiv.appendChild(indexSpan);

        const rowDiv = document.createElement('div');
        rowDiv.className = 'next-puyo-row';
        
        const createEditPuyoElement = (color, puyoIndex) => {
            const slot = document.createElement('div');
            slot.className = 'next-puyo-slot';
            const puyo = document.createElement('div');
            puyo.className = `puyo puyo-${color}`;
            
            puyo.addEventListener('click', (event) => {
                event.stopPropagation(); 
                if (gameState !== 'editing') return;
                
                // puyoIndex: 0=メイン(下), 1=サブ(上)
                editingNextPuyos[index][puyoIndex] = currentEditColor; 
                renderEditNextListDOM(); // 再描画
            });
            slot.appendChild(puyo);
            return slot;
        };

        // サブぷよ(c_sub, index=1)を先に、メインぷよ(c_main, index=0)を後に配置
        rowDiv.appendChild(createEditPuyoElement(c_sub, 1)); 
        rowDiv.appendChild(createEditPuyoElement(c_main, 0)); 

        pairDiv.appendChild(rowDiv);
        container.appendChild(pairDiv);
    });
}

/**
 * エディットモードで設定したネクストを全て空にする (グローバル公開)
 */
window.clearEditNext = function() {
    if (confirm('ネクスト設定を全て空にしますか？')) {
        editingNextPuyos = Array(NEXT_MAX_COUNT).fill(0).map(() => [COLORS.EMPTY, COLORS.EMPTY]);
        renderEditNextListDOM();
    }
}


// --- ぷよの生成と操作 (プレイモード時のみ有効) (中略) ---

function getRandomColor() {
    return Math.floor(Math.random() * 4) + 1; 
}

function getRandomPair() {
    return [getRandomColor(), getRandomColor()];
}

function generateNewPuyo() {
    if (gameState !== 'playing') return;

    while (nextPuyoColors.length < NUM_NEXT_PUYOS + 1) {
        nextPuyoColors.push(getRandomPair());
    }
    
    const [c1, c2] = nextPuyoColors.shift();

    currentPuyo = {
        mainColor: c1,
        subColor: c2,
        mainX: 2, 
        mainY: START_Y, // Y=12
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
    
    renderPlayNextPuyo(); 
}

/**
 * ぷよの状態から2つのぷよの座標 (x, y) を取得する
 */
function getCoordsFromState(puyoState) {
    const { mainX, mainY, rotation } = puyoState;
    let subX = mainX;
    let subY = mainY;

    // rotation の定義: 0=上, 1=右, 2=下, 3=左
    if (rotation === 0) subY = mainY + 1; 
    if (rotation === 1) subX = mainX + 1; 
    if (rotation === 2) subY = mainY - 1; 
    if (rotation === 3) subX = mainX - 1; 

    return [
        { x: mainX, y: mainY, isMain: true },
        { x: subX, y: subY, isMain: false }
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
    
    const coords = getCoordsFromState(currentPuyo);
    let ghostPositions = [];
    
    // 各ぷよが独立して落下できる最終位置 (y_final) を計算するヘルパー関数
    const finalY = (x, y) => {
        let y_final = y;
        for (let dy = y - 1; dy >= 0; dy--) {
            if (board[dy][x] !== COLORS.EMPTY) break;
            y_final = dy;
        }
        return y_final;
    };

    const puyo1 = coords[0];
    const puyo2 = coords[1];
    let y1_final = finalY(puyo1.x, puyo1.y);
    let y2_final = finalY(puyo2.x, puyo2.y);

    // 2. 落下位置を調整し、ゴーストとして成立するかチェック
    
    // Puyo 1
    if (puyo1.y !== y1_final) {
        if (puyo1.x === puyo2.x && y1_final === puyo2.y) {
             y1_final = puyo2.y + 1;
        }
        if (y1_final < puyo1.y) {
             ghostPositions.push({ x: puyo1.x, y: y1_final, color: puyo1.color });
        }
    }
    
    // Puyo 2
    if (puyo2.y !== y2_final) {
        if (puyo2.x === puyo1.x && y2_final === puyo1.y) {
             y2_final = puyo1.y + 1;
        }
        
        const ghost1 = ghostPositions.find(g => g.x === puyo2.x);
        if (ghost1 && y2_final === ghost1.y) {
            y2_final = ghost1.y + 1;
        }

        if (y2_final < puyo2.y) {
             ghostPositions.push({ x: puyo2.x, y: y2_final, color: puyo2.color });
        }
    }

    // ゴースト同士の衝突チェック (同じセルに二つあれば削除)
    if (ghostPositions.length === 2 && ghostPositions[0].x === ghostPositions[1].x && ghostPositions[0].y === ghostPositions[1].y) {
        return [];
    }
    
    // 操作中のぷよとゴーストが重ならないようにフィルタリング
    const currentPuyoCoords = getPuyoCoords();
    const finalGhosts = ghostPositions.filter(ghost => {
        return !currentPuyoCoords.some(p => p.x === ghost.x && p.y === ghost.y);
    });

    // 可視領域 (Y=0からY=11) のみ描画対象
    return finalGhosts.filter(p => p.y < VISIBLE_HEIGHT); 
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
    // 壁蹴りチェック
    if (movePuyo(0, 0, newRotation)) return true; 
    if (movePuyo(-1, 0, newRotation)) return true; 
    if (movePuyo(1, 0, newRotation)) return true; 
    return false;
}

function rotatePuyoCCW() {
    if (gameState !== 'playing') return false;
    const newRotation = (currentPuyo.rotation - 1 + 4) % 4;
    // 壁蹴りチェック
    if (movePuyo(0, 0, newRotation)) return true; 
    if (movePuyo(-1, 0, newRotation)) return true; 
    if (movePuyo(1, 0, newRotation)) return true; 
    return false;
}

function hardDrop() {
    if (gameState !== 'playing' || !currentPuyo) return;

    clearInterval(dropTimer); 

    while (movePuyo(0, -1, undefined, false)); 

    lockPuyo(); 
}

/**
 * 落下中のぷよを盤面に固定する (中略)
 */
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
                    // ★ 色情報を使用してゴーストクラスを設定: puyo-N と puyo-ghost
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
            // Zキー (Aボタン) に反時計回り (CCW) を割り当て
            rotatePuyoCCW(); 
            break;
        case 'x': 
        case 'X':
            // Xキー (Bボタン) に時計回り (CW) を割り当て
            rotatePuyoCW(); 
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
