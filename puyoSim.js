// puyoSim.js

// --- ぷよぷよシミュレーションの定数と設定 ---

// 盤面サイズ
const WIDTH = 6;
const HEIGHT = 14; // 可視領域12 + 隠し領域2 (Y=0 から Y=13)
const VISIBLE_HEIGHT = 12; // 可視領域の高さ (Y=2 から Y=13)
const NUM_NEXT_PUYOS = 2; // NEXT 1 と NEXT 2 の 2組
const NEXT_MAX_COUNT = 50; // エディットモードのネクスト最大数

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
let currentEditColor = COLORS.EMPTY; // エディットモードで選択中の色
let editingNextPuyos = []; // エディットモード用の50手先リスト

// --- 落下ループのための変数 ---
let dropInterval = 1000; // 1秒ごとに落下
let dropTimer = null; 
let autoDropEnabled = true; // デフォルトをONに変更


// --- 初期化関数 ---

/**
 * 盤面のDOM要素を一度だけ生成する (6列x14行)
 */
function createBoardDOM() {
    const boardElement = document.getElementById('puyo-board');
    boardElement.innerHTML = ''; 

    // DOMの配置は y=13 (最上段) から y=0 (最下段) の順。
    for (let y = HEIGHT - 1; y >= 0; y--) { 
        for (let x = 0; x < WIDTH; x++) {
            const cell = document.createElement('div');
            // データ配列の座標に合わせたID: cell-x-y (y=0が最下段)
            cell.id = `cell-${x}-${y}`; 
            
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

    // プレイモードかつ画面幅が800px以下の場合に表示
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
    // 1. 盤面DOMが未構築なら構築
    if (document.getElementById('puyo-board').children.length === 0) {
        createBoardDOM(); 
    }
    
    // 2. 盤面データを空で初期化
    for (let y = 0; y < HEIGHT; y++) {
        board[y] = Array(WIDTH).fill(COLORS.EMPTY);
    }

    score = 0;
    chainCount = 0;
    gameState = 'playing';
    currentPuyo = null;

    // ネクストぷよリストを完全にランダムなぷよで初期化
    nextPuyoColors = [getRandomPair(), getRandomPair()];
    // エディット用の50手ネクストリストを初期化
    if (editingNextPuyos.length === 0) {
        for (let i = 0; i < NEXT_MAX_COUNT; i++) {
            editingNextPuyos.push(getRandomPair());
        }
    }
    
    // UIリセット
    document.getElementById('mode-toggle-button-play-only').textContent = 'edit';
    document.body.classList.remove('edit-mode-active');
    
    // 自動落下ボタンの初期化
    const autoDropButton = document.getElementById('auto-drop-toggle-button');
    if (autoDropButton) {
        autoDropEnabled = true; // 明示的にONに戻す
        autoDropButton.textContent = '自動落下: ON';
        autoDropButton.classList.remove('disabled');
    }

    // 最初のぷよを生成
    generateNewPuyo(); 
    startPuyoDropLoop(); 
    
    updateUI();
    
    // イベントリスナーの設定 (初回のみ)
    if (!document.initializedKeyHandler) {
        document.addEventListener('keydown', handleInput);
        
        // モバイル操作ボタンのイベント設定 (CW/CCWを修正)
        document.getElementById('btn-left')?.addEventListener('click', () => movePuyo(-1, 0));
        document.getElementById('btn-right')?.addEventListener('click', () => movePuyo(1, 0));
        // ★修正: Bボタンを時計回り (CW)
        document.getElementById('btn-rotate-cw')?.addEventListener('click', rotatePuyoCW); 
        // ★修正: Aボタンを反時計回り (CCW)
        document.getElementById('btn-rotate-ccw')?.addEventListener('click', rotatePuyoCCW); 
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
        
        document.getElementById('puyo-board').addEventListener('click', handleBoardClickEditMode);
        
        selectPaletteColor(COLORS.EMPTY); 
        renderEditNextListDOM(); // 50手リストを生成・描画
        renderBoard(); 
        
    } else if (gameState === 'editing') {
        // -> プレイモードへ切り替え
        gameState = 'playing';
        document.body.classList.remove('edit-mode-active');
        
        checkMobileControlsVisibility();

        document.getElementById('puyo-board').removeEventListener('click', handleBoardClickEditMode);
        
        // エディットモードで配置したぷよを重力で落として安定させる
        gravity(); 
        
        // エディットモードのネクスト設定をプレイモードに適用
        nextPuyoColors = editingNextPuyos.slice(0, NUM_NEXT_PUYOS);
        
        currentPuyo = null; 
        generateNewPuyo(); 
        startPuyoDropLoop(); 
        
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
    // エディットモードのネクストリスト初期描画を初回実行時に行う
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
    if (gameState !== 'editing') return;
    
    const boardElement = document.getElementById('puyo-board');
    const rect = boardElement.getBoundingClientRect();
    const cellWidth = rect.width / WIDTH; 
    const cellHeight = rect.height / HEIGHT; 

    let x = Math.floor((event.clientX - rect.left) / cellWidth);
    let y_dom = Math.floor((event.clientY - rect.top) / cellHeight); 

    // DOMのY座標 (上=0, 下=13) をデータ配列のY座標 (下=0, 上=13) に変換
    let y = HEIGHT - 1 - y_dom;

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
        rowDiv.appendChild(createEditPuyoElement(c_sub, 1)); // 上のぷよ (サブ)
        rowDiv.appendChild(createEditPuyoElement(c_main, 0)); // 下のぷよ (メイン)

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


// --- ぷよの生成と操作 (プレイモード時のみ有効) ---

function getRandomColor() {
    // 1 (赤) から 4 (黄) までの色をランダムに返す
    return Math.floor(Math.random() * 4) + 1; 
}

function getRandomPair() {
    // [メインの色, サブの色]
    return [getRandomColor(), getRandomColor()];
}

function generateNewPuyo() {
    if (gameState !== 'playing') return;

    // ネクストリストが足りない場合、ランダムに補充
    while (nextPuyoColors.length < NUM_NEXT_PUYOS + 1) {
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
        rotation: 0 // 0: 上 (サブぷよがメインぷよの上に乗る状態)
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
    
    renderPlayNextPuyo(); // ネクスト表示を更新
}

/**
 * ぷよの状態から2つのぷよの座標 (x, y) を取得する
 */
function getCoordsFromState(puyoState) {
    const { mainX, mainY, rotation } = puyoState;
    let subX = mainX;
    let subY = mainY;

    // rotation の定義を修正: 0=上, 1=右, 2=下, 3=左
    if (rotation === 0) subY = mainY + 1; // 上
    if (rotation === 1) subX = mainX + 1; // 右
    if (rotation === 2) subY = mainY - 1; // 下
    if (rotation === 3) subX = mainX - 1; // 左

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
 * ★修正: ゴーストぷよの描画ロジックを大幅に改善
 */
function getGhostFinalPositions() {
    if (!currentPuyo || gameState !== 'playing') return [];
    
    const { mainX, mainY, rotation, mainColor, subColor } = currentPuyo;
    const { dx, dy } = getChildDelta(rotation);
    const subX = mainX + dx;
    const subY = mainY + dy;
    
    const coords = getCoordsFromState(currentPuyo);
    
    let mainFixedY = mainY;
    let subFixedY = subY;
    
    // 1. メインぷよの最終落下位置を計算
    for (let y = mainY - 1; y >= -1; y--) {
        if (y < 0 || board[y][mainX] !== COLORS.EMPTY) {
            break;
        }
        mainFixedY = y;
    }
    
    // 2. サブぷよの最終落下位置を計算
    for (let y = subY - 1; y >= -1; y--) {
        // ボードのぷよに衝突するか、メインぷよの固定位置と重なるか
        if (y < 0 || board[y][subX] !== COLORS.EMPTY || 
            (subX === mainX && y === mainFixedY)) { // サブがメインの固定位置に衝突する場合
            break;
        }
        subFixedY = y;
    }

    let ghostPositions = [];
    
    // 3. ゴーストの位置決定 (元の位置と固定位置が異なる場合のみ)
    // メインぷよ
    if (mainFixedY !== mainY) {
        ghostPositions.push({ x: mainX, y: mainFixedY, color: mainColor });
    }
    // サブぷよ
    if (subFixedY !== subY) {
        ghostPositions.push({ x: subX, y: subFixedY, color: subColor });
    }

    // 4. 重なり防止と最終チェック
    // 最終固定位置が同じセルになった場合、先にメインぷよがその色を持つべきなので、サブを削除
    if (mainX === subX && mainFixedY === subFixedY) {
         return []; // このケースは HardDropで処理されるべきため、ゴーストでは描画しない
    }

    // 可視領域 (Y=0からY=11) のみ描画対象
    return ghostPositions.filter(p => p.y < VISIBLE_HEIGHT); 
}

function getChildDelta(rotation) {
    const deltas = [
        {dx: 0, dy: 1},  // 0: 上
        {dx: 1, dy: 0},  // 1: 右
        {dx: 0, dy: -1}, // 2: 下
        {dx: -1, dy: 0}  // 3: 左
    ];
    return deltas[rotation % 4];
}

function checkCollision(coords) {
    for (const puyo of coords) {
        // 盤面外チェック (左右, 下)
        if (puyo.x < 0 || puyo.x >= WIDTH || puyo.y < 0) return true;

        // 固定ぷよとの衝突チェック
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
    // 衝突チェックと壁蹴り（通常、右、左の順）
    if (movePuyo(0, 0, newRotation)) return true; 
    if (movePuyo(-1, 0, newRotation)) return true; // 左壁蹴り
    if (movePuyo(1, 0, newRotation)) return true; // 右壁蹴り
    // ★TODO: 回転後のY座標チェック (床蹴り) も追加する
    return false;
}

function rotatePuyoCCW() {
    if (gameState !== 'playing') return false;
    const newRotation = (currentPuyo.rotation - 1 + 4) % 4;
    // 衝突チェックと壁蹴り（通常、右、左の順）
    if (movePuyo(0, 0, newRotation)) return true; 
    if (movePuyo(-1, 0, newRotation)) return true; // 左壁蹴り
    if (movePuyo(1, 0, newRotation)) return true; // 右壁蹴り
    return false;
}

function hardDrop() {
    if (gameState !== 'playing' || !currentPuyo) return;

    clearInterval(dropTimer); 

    // 落下できる限り落下させる (移動中の描画はしない)
    while (movePuyo(0, -1, undefined, false)); 

    // ★修正: 落下後の固定処理と描画
    lockPuyo(); 
}

/**
 * 落下中のぷよを盤面に固定する
 * ★修正: 固定後にrenderBoard()を呼び出す
 */
function lockPuyo() {
    if (gameState !== 'playing' || !currentPuyo) return;

    const coords = getPuyoCoords();
    let isGameOver = false;

    for (const puyo of coords) {
        // Y=13 (最上段) に固定されたらゲームオーバー
        if (puyo.y >= HEIGHT - 1) { 
            isGameOver = true;
            break;
        }
        if (puyo.y >= 0 && puyo.y < HEIGHT) {
            board[puyo.y][puyo.x] = puyo.color;
        }
    }

    currentPuyo = null;
    renderBoard(); // ★修正: ぷよ固定後の盤面を描画

    if (isGameOver) {
        gameState = 'gameover';
        alert('ゲームオーバーです！');
        clearInterval(dropTimer); 
        updateUI();
        return;
    }
    
    gameState = 'chaining';
    chainCount = 0;
    
    runChain();
}

// ... (findConnectedPuyos, calculateScore, simulateGravity, gravity 関数は変更なし) ...

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

    const totalScore = Math.floor((10 * totalPuyos) * finalBonus); // 整数化

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
 * ★修正: ゴーストぷよの描画順序を調整
 */
function renderBoard() {
    const isPlaying = gameState === 'playing' && currentPuyo;
    const currentPuyoCoords = isPlaying ? getPuyoCoords() : [];
    // ★修正: ゴーストぷよを計算
    const ghostPuyoCoords = isPlaying ? getGhostFinalPositions() : []; 

    // 描画は全領域 (y=13 から y=0) を行う
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
            // 2. ゴーストぷよのチェック (固定ぷよや操作中ぷよがなければ)
            else if (cellColor === COLORS.EMPTY) {
                const puyoGhost = ghostPuyoCoords.find(p => p.x === x && p.y === y);
                if (puyoGhost) {
                    cellColor = puyoGhost.color; 
                    puyoClasses = `puyo puyo-${cellColor} puyo-ghost`;
                }
            }
            // 3. 固定ぷよ (cellColorはboard[y][x]のまま)
            
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

    // ヘルパー: スロット内のぷよを描画
    const drawSlotPuyos = (slotElement, colors) => {
        slotElement.innerHTML = '';
        if (colors) {
            const [c_main, c_sub] = colors; 
            
            const createPuyoDiv = (color) => {
                let puyo = document.createElement('div');
                puyo.className = `puyo puyo-${color}`;
                return puyo;
            };
            
            // 上のぷよ (サブ) を先にDOMに追加
            slotElement.appendChild(createPuyoDiv(c_sub)); 
            // 下のぷよ (メイン) を後にDOMに追加
            slotElement.appendChild(createPuyoDiv(c_main));
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
        case 'z': // Aボタンの代わり
        case 'Z':
            // ★修正: Zを反時計回り (CCW) に設定
            rotatePuyoCCW(); 
            break;
        case 'x': // Bボタンの代わり
        case 'X':
            // ★修正: Xを時計回り (CW) に設定
            rotatePuyoCW(); 
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
