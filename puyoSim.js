// ぷよぷよシミュレーションのシステム (おじゃまぷよ・相殺・テトリス2準拠)

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

// スコア計算の値 (ぷよぷよ通/テトリス2準拠)
const BONUS_TABLE = {
    CHAIN: [0, 0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512],
    GROUP: [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    COLOR: [0, 0, 3, 6, 12, 24]
};

// おじゃまぷよ設定
const GARBAGE_RATE = 70; // スコア70点につきおじゃま1個

// ゲームの状態管理
let board = []; 
let currentPuyo = null; 
let nextPuyoColors = []; 
let score = 0;
let chainCount = 0;
let gameState = 'playing'; // 'playing', 'chaining', 'gameover', 'editing'
let currentEditColor = COLORS.EMPTY;
let editingNextPuyos = [];

// おじゃまぷよスタック
let myGarbageStack = 0; // 自分の盤面に降る予定
let pendingGarbageToOpponent = 0; // 相手に送る予定（相殺前）

// 履歴管理
let historyStack = [];
let redoStack = [];
const MAX_HISTORY_SIZE = 10000;

// 落下ループ
let dropInterval = 1000;
let dropTimer = null; 
let autoDropEnabled = false; 

// 連鎖速度
let gravityWaitTime = 300;
let chainWaitTime = 300;

// クイックターン
let lastFailedRotation = { type: null, timestamp: 0 };
const QUICK_TURN_WINDOW = 300;

// 初期化
function createBoardDOM() {
    const boardElement = document.getElementById('puyo-board');
    if (!boardElement) return;
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

window.resetGame = function() { 
    clearInterval(dropTimer); 
    initializeGame();
}

function initializeGame() {
    board = Array(HEIGHT).fill().map(() => Array(WIDTH).fill(COLORS.EMPTY));
    score = 0;
    chainCount = 0;
    myGarbageStack = 0;
    pendingGarbageToOpponent = 0;
    gameState = 'playing';
    
    historyStack = [];
    redoStack = [];
    
    nextPuyoColors = [];
    for (let i = 0; i < MAX_NEXT_PUYOS; i++) {
        nextPuyoColors.push(getRandomPair());
    }
    
    createBoardDOM();
    generateNewPuyo();
    updateUI();
    renderBoard();
}

function generateNewPuyo() {
    if (gameState !== 'playing') return;

    // おじゃまぷよの落下処理
    if (myGarbageStack > 0) {
        dropGarbage();
        myGarbageStack = 0; // 一旦全部降らせる（または最大30個などの制限を入れる）
        updateUI();
        renderBoard();
    }

    if (nextPuyoColors.length === 0) {
        for (let i = 0; i < MAX_NEXT_PUYOS; i++) nextPuyoColors.push(getRandomPair());
    }
    
    const pair = nextPuyoColors.shift();
    currentPuyo = {
        mainColor: pair[0],
        subColor: pair[1],
        mainX: 2,
        mainY: 12,
        rotation: 0
    };

    const startingCoords = getCoordsFromState(currentPuyo);
    if (checkCollision(startingCoords)) {
        gameState = 'gameover';
        clearInterval(dropTimer); 
        updateUI();
        renderBoard();
        if (window.notifyGameOver) window.notifyGameOver();
        return; 
    }
    nextPuyoColors.push(getRandomPair());
}

function dropGarbage() {
    let amount = Math.min(myGarbageStack, 30); // 1回に最大5段分
    myGarbageStack -= amount;
    
    // おじゃまぷよを上から詰める
    for (let i = 0; i < amount; i++) {
        let x = i % WIDTH;
        // 空いている一番上の行を探す
        for (let y = HEIGHT - 1; y >= 0; y--) {
            if (board[y][x] === COLORS.EMPTY) {
                board[y][x] = COLORS.GARBAGE;
                break;
            }
        }
    }
    gravity();
}

function gravity() {
    for (let x = 0; x < WIDTH; x++) {
        let col = [];
        for (let y = 0; y < HEIGHT; y++) {
            if (board[y][x] !== COLORS.EMPTY) col.push(board[y][x]);
        }
        for (let y = 0; y < HEIGHT; y++) {
            board[y][x] = (y < col.length) ? col[y] : COLORS.EMPTY;
        }
    }
}

async function runChain() {
    gravity();
    renderBoard();

    const groups = findConnectedPuyos();
    if (groups.length === 0) {
        // 連鎖終了
        if (pendingGarbageToOpponent > 0) {
            if (window.sendGarbage) window.sendGarbage(pendingGarbageToOpponent);
            pendingGarbageToOpponent = 0;
        }
        
        gameState = 'playing';
        generateNewPuyo(); 
        if (autoDropEnabled) startPuyoDropLoop();
        renderBoard();
        updateUI();
        saveState(true);
        return;
    }

    await new Promise(resolve => setTimeout(resolve, chainWaitTime));

    chainCount++;
    let chainScore = calculateScore(groups, chainCount);
    score += chainScore;

    // おじゃまぷよ計算
    let generatedGarbage = Math.floor(chainScore / GARBAGE_RATE);
    
    // 相殺ロジック
    if (myGarbageStack > 0) {
        let offset = Math.min(myGarbageStack, generatedGarbage);
        myGarbageStack -= offset;
        generatedGarbage -= offset;
    }
    pendingGarbageToOpponent += generatedGarbage;

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

function updateUI() {
    const scoreElement = document.getElementById('score');
    const chainElement = document.getElementById('chain-count');
    if (scoreElement) scoreElement.textContent = score;
    if (chainElement) chainElement.textContent = chainCount;
    
    // おじゃまぷよスタックの表示更新（数値）
    const myStackEl = document.getElementById('my-garbage-stack');
    if (myStackEl) myStackEl.textContent = myGarbageStack;
    
    renderBoard();
    updateHistoryButtons();
}

// 外部からおじゃまぷよを受け取る関数
window.receiveGarbage = function(amount) {
    myGarbageStack += amount;
    updateUI();
};

// --- 以下、既存の基本機能の維持 ---
function getRandomColor() { return Math.floor(Math.random() * 4) + 1; }
function getRandomPair() { return [getRandomColor(), getRandomColor()]; }
function getCoordsFromState(p) {
    let { mainX, mainY, rotation } = p;
    let subX = mainX, subY = mainY;
    if (rotation === 0) subY++; else if (rotation === 1) subX--; else if (rotation === 2) subY--; else if (rotation === 3) subX++;
    return [{x: mainX, y: mainY}, {x: subX, y: subY}];
}
function checkCollision(coords) {
    for (const p of coords) {
        if (p.x < 0 || p.x >= WIDTH || p.y < 0) return true;
        if (p.y < HEIGHT && board[p.y][p.x] !== COLORS.EMPTY) return true;
    }
    return false;
}
function getPuyoCoords() {
    if (!currentPuyo) return [];
    const coords = getCoordsFromState(currentPuyo);
    coords[0].color = currentPuyo.mainColor;
    coords[1].color = currentPuyo.subColor;
    return coords;
}
function renderBoard() {
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const cell = document.getElementById(`cell-${x}-${y}`);
            if (!cell) continue;
            const puyo = cell.firstChild;
            const color = board[y][x];
            puyo.className = `puyo puyo-${color}`;
        }
    }
    if (currentPuyo && gameState === 'playing') {
        const coords = getPuyoCoords();
        coords.forEach(p => {
            const cell = document.getElementById(`cell-${p.x}-${p.y}`);
            if (cell) cell.firstChild.className = `puyo puyo-${p.color}`;
        });
    }
    if (window.sendBoardData) window.sendBoardData();
}
function movePuyo(dx, dy, newRot) {
    if (gameState !== 'playing' || !currentPuyo) return false;
    const test = { ...currentPuyo, mainX: currentPuyo.mainX + dx, mainY: currentPuyo.mainY + dy, rotation: newRot !== undefined ? newRot : currentPuyo.rotation };
    if (!checkCollision(getCoordsFromState(test))) {
        currentPuyo = test;
        renderBoard();
        return true;
    }
    return false;
}
function rotatePuyoCW() {
    const nextRot = (currentPuyo.rotation + 1) % 4;
    if (!movePuyo(0, 0, nextRot)) {
        if (!movePuyo(1, 0, nextRot)) movePuyo(-1, 0, nextRot);
    }
}
function rotatePuyoCCW() {
    const nextRot = (currentPuyo.rotation + 3) % 4;
    if (!movePuyo(0, 0, nextRot)) {
        if (!movePuyo(1, 0, nextRot)) movePuyo(-1, 0, nextRot);
    }
}
function placePuyo() {
    const coords = getPuyoCoords();
    coords.forEach(p => { if (p.y >= 0 && p.y < HEIGHT) board[p.y][p.x] = p.color; });
    currentPuyo = null;
    gameState = 'chaining';
    clearInterval(dropTimer);
    chainCount = 0;
    runChain();
}
function hardDrop() { while (movePuyo(0, -1)); placePuyo(); }
function handleInput(e) {
    if (gameState !== 'playing') return;
    if (e.key === 'ArrowLeft') movePuyo(-1, 0);
    else if (e.key === 'ArrowRight') movePuyo(1, 0);
    else if (e.key === 'ArrowDown') movePuyo(0, -1);
    else if (e.key === 'z') rotatePuyoCW();
    else if (e.key === 'x') rotatePuyoCCW();
    else if (e.key === ' ') hardDrop();
}
function findConnectedPuyos() {
    let visited = Array(HEIGHT).fill().map(() => Array(WIDTH).fill(false));
    let groups = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const color = board[y][x];
            if (color !== COLORS.EMPTY && color !== COLORS.GARBAGE && !visited[y][x]) {
                let group = [], q = [{x, y}];
                visited[y][x] = true;
                while (q.length > 0) {
                    let c = q.shift(); group.push(c);
                    [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}].forEach(d => {
                        let nx = c.x+d.x, ny = c.y+d.y;
                        if (nx>=0 && nx<WIDTH && ny>=0 && ny<HEIGHT && !visited[ny][nx] && board[ny][nx]===color) {
                            visited[ny][nx]=true; q.push({x:nx,y:ny});
                        }
                    });
                }
                if (group.length >= 4) groups.push({group, color});
            }
        }
    }
    return groups;
}
function clearGarbagePuyos(erased) {
    erased.forEach(c => {
        [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}].forEach(d => {
            let nx = c.x+d.x, ny = c.y+d.y;
            if (nx>=0 && nx<WIDTH && ny>=0 && ny<HEIGHT && board[ny][nx]===COLORS.GARBAGE) board[ny][nx]=COLORS.EMPTY;
        });
    });
}
function saveState(c) { historyStack.push({board: board.map(r=>[...r]), score, myGarbageStack}); if (historyStack.length > MAX_HISTORY_SIZE) historyStack.shift(); if (c) redoStack = []; updateHistoryButtons(); }
function updateHistoryButtons() {}
function startPuyoDropLoop() { clearInterval(dropTimer); dropTimer = setInterval(() => { if (gameState === 'playing' && autoDropEnabled) { if (!movePuyo(0, -1)) placePuyo(); } }, dropInterval); }

document.addEventListener('keydown', handleInput);
window.addEventListener('load', initializeGame);
