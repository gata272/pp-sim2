// ぷよぷよシミュレーションシステム (v3: おじゃまぷよ・相殺・テトリス2準拠)

// 盤面サイズ
const WIDTH = 6;
const HEIGHT = 14; 
const HIDDEN_ROWS = 2;
const MAX_NEXT_PUYOS = 50;
const NUM_VISIBLE_NEXT_PUYOS = 2;

// ぷよの色定義
const COLORS = {
    EMPTY: 0,
    RED: 1,
    BLUE: 2,
    GREEN: 3,
    YELLOW: 4,
    GARBAGE: 5 // おじゃまぷよ
};

// スコア計算（テトリス2準拠）
const BONUS_TABLE = {
    CHAIN: [0, 0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512],
    GROUP: [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    COLOR: [0, 0, 3, 6, 12, 24]
};

const GARBAGE_RATE = 70; // スコア70点につきおじゃま1個

// 状態管理
let board = [];
let currentPuyo = null;
let nextQueue = [];
let queueIndex = 0;
let score = 0;
let chainCount = 0;
let gameState = 'playing'; 
let currentEditColor = COLORS.EMPTY;
let editingNextPuyos = [];

// おじゃまぷよスタック
let myGarbageStack = 0;
let pendingGarbageToOpponent = 0;

// 履歴管理
let historyStack = [];
let redoStack = [];
const MAX_HISTORY_SIZE = 300;

// 落下・連鎖設定
let dropInterval = 1000;
let dropTimer = null;
let autoDropEnabled = false;
let gravityWaitTime = 300;
let chainWaitTime = 300;

// クイックターン
let lastFailedRotation = { type: null, timestamp: 0 };
const QUICK_TURN_WINDOW = 300;

// 初期化
function initializeGame() {
    board = Array(HEIGHT).fill().map(() => Array(WIDTH).fill(COLORS.EMPTY));
    score = 0;
    chainCount = 0;
    myGarbageStack = 0;
    pendingGarbageToOpponent = 0;
    gameState = 'playing';
    historyStack = [];
    redoStack = [];
    
    generateInitialNextQueue();
    createBoardDOM();
    generateNewPuyo();
    updateUI();
    renderBoard();
}

function generateInitialNextQueue() {
    nextQueue = [];
    queueIndex = 0;
    for (let i = 0; i < 100; i++) nextQueue.push(getRandomPair());
}

function getRandomColor() { return Math.floor(Math.random() * 4) + 1; }
function getRandomPair() { return [getRandomColor(), getRandomColor()]; }

function createBoardDOM() {
    const boardElement = document.getElementById('puyo-board');
    if (!boardElement) return;
    boardElement.innerHTML = '';
    for (let y = HEIGHT - 1; y >= 0; y--) {
        for (let x = 0; x < WIDTH; x++) {
            const cell = document.createElement('div');
            cell.id = `cell-${x}-${y}`;
            cell.className = 'puyo-cell';
            const puyo = document.createElement('div');
            puyo.className = 'puyo puyo-0';
            puyo.setAttribute('data-color', 0);
            cell.appendChild(puyo);
            boardElement.appendChild(cell);
        }
    }
}

function generateNewPuyo() {
    if (gameState !== 'playing') return;

    // おじゃまぷよ落下
    if (myGarbageStack > 0) {
        dropGarbage();
        myGarbageStack = 0;
        updateUI();
        renderBoard();
    }

    if (queueIndex >= nextQueue.length - 10) {
        for (let i = 0; i < 50; i++) nextQueue.push(getRandomPair());
    }
    
    const pair = nextQueue[queueIndex++];
    currentPuyo = {
        mainColor: pair[1], // main
        subColor: pair[0],  // sub
        mainX: 2,
        mainY: 12,
        rotation: 0
    };

    if (checkCollision(getCoordsFromState(currentPuyo))) {
        gameState = 'gameover';
        clearInterval(dropTimer);
        updateUI();
        renderBoard();
        if (window.notifyGameOver) window.notifyGameOver();
        else alert('ゲームオーバー！');
        return;
    }
}

function dropGarbage() {
    let amount = Math.min(myGarbageStack, 30);
    for (let i = 0; i < amount; i++) {
        let x = i % WIDTH;
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

    // おじゃま・相殺
    let generated = Math.floor(chainScore / GARBAGE_RATE);
    if (myGarbageStack > 0) {
        let offset = Math.min(myGarbageStack, generated);
        myGarbageStack -= offset;
        generated -= offset;
    }
    pendingGarbageToOpponent += generated;

    let erased = [];
    groups.forEach(({ group }) => {
        group.forEach(({ x, y }) => {
            board[y][x] = COLORS.EMPTY;
            erased.push({ x, y });
        });
    });
    clearGarbagePuyos(erased);
    
    renderBoard();
    updateUI();

    await new Promise(resolve => setTimeout(resolve, gravityWaitTime));
    runChain();
}

function calculateScore(groups, chain) {
    let puyos = 0, colors = new Set(), bonus = 0;
    groups.forEach(({ group, color }) => {
        puyos += group.length;
        colors.add(color);
        bonus += BONUS_TABLE.GROUP[Math.min(group.length, 15)] || 0;
    });
    bonus += BONUS_TABLE.CHAIN[Math.min(chain, 19)] || 0;
    bonus += BONUS_TABLE.COLOR[Math.min(colors.size, 5)] || 0;
    return (10 * puyos) * Math.max(1, bonus);
}

function renderBoard() {
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const cell = document.getElementById(`cell-${x}-${y}`);
            if (!cell) continue;
            cell.firstChild.className = `puyo puyo-${board[y][x]}`;
        }
    }
    if (currentPuyo && gameState === 'playing') {
        const coords = getPuyoCoords();
        coords.forEach(p => {
            const cell = document.getElementById(`cell-${p.x}-${p.y}`);
            if (cell) cell.firstChild.className = `puyo puyo-${p.color}`;
        });
    }
    if (gameState === 'playing') renderPlayNextPuyo();
    if (window.sendBoardData) window.sendBoardData();
}

function renderPlayNextPuyo() {
    const n1 = document.getElementById('next-puyo-1'), n2 = document.getElementById('next-puyo-2');
    if (!n1 || !n2) return;
    const draw = (el, pair) => {
        el.innerHTML = '';
        if (!pair) return;
        [pair[0], pair[1]].forEach(c => {
            const p = document.createElement('div');
            p.className = `puyo puyo-${c}`;
            el.appendChild(p);
        });
    };
    draw(n1, nextQueue[queueIndex]);
    draw(n2, nextQueue[queueIndex+1]);
}

function updateUI() {
    const s = document.getElementById('score'), c = document.getElementById('chain-count');
    if (s) s.textContent = score;
    if (c) c.textContent = chainCount;
    const g = document.getElementById('my-garbage-stack');
    if (g) g.textContent = myGarbageStack;
    updateHistoryButtons();
}

// --- 既存機能の維持 ---
function getCoordsFromState(p) {
    let { mainX, mainY, rotation } = p;
    let sx = mainX, sy = mainY;
    if (rotation === 0) sy++; else if (rotation === 1) sx--; else if (rotation === 2) sy--; else if (rotation === 3) sx++;
    return [{x: mainX, y: mainY}, {x: sx, y: sy}];
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
function movePuyo(dx, dy, nr) {
    if (gameState !== 'playing' || !currentPuyo) return false;
    const test = { ...currentPuyo, mainX: currentPuyo.mainX + dx, mainY: currentPuyo.mainY + dy, rotation: nr !== undefined ? nr : currentPuyo.rotation };
    if (!checkCollision(getCoordsFromState(test))) {
        currentPuyo = test;
        renderBoard();
        return true;
    }
    return false;
}
function rotatePuyoCW() {
    const nr = (currentPuyo.rotation + 1) % 4;
    if (!movePuyo(0, 0, nr)) { if (!movePuyo(1, 0, nr)) movePuyo(-1, 0, nr); }
}
function rotatePuyoCCW() {
    const nr = (currentPuyo.rotation + 3) % 4;
    if (!movePuyo(0, 0, nr)) { if (!movePuyo(1, 0, nr)) movePuyo(-1, 0, nr); }
}
function placePuyo() {
    const coords = getPuyoCoords();
    coords.forEach(p => { if (p.y >= 0 && p.y < HEIGHT) board[p.y][p.x] = p.color; });
    currentPuyo = null; gameState = 'chaining'; clearInterval(dropTimer);
    chainCount = 0; runChain();
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
                let group = [], q = [{x, y}]; visited[y][x] = true;
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
function saveState(c) {
    historyStack.push({board: board.map(r=>[...r]), score, myGarbageStack, queueIndex});
    if (historyStack.length > MAX_HISTORY_SIZE) historyStack.shift();
    if (c) redoStack = [];
}
function updateHistoryButtons() {
    const u = document.getElementById('undo-button'), r = document.getElementById('redo-button');
    if (u) u.disabled = historyStack.length <= 1;
    if (r) r.disabled = redoStack.length === 0;
}
window.undoMove = function() {
    if (historyStack.length <= 1) return;
    redoStack.push(historyStack.pop());
    const s = historyStack[historyStack.length - 1];
    board = s.board.map(r=>[...r]); score = s.score; myGarbageStack = s.myGarbageStack; queueIndex = s.queueIndex;
    gameState = 'playing'; generateNewPuyo(); renderBoard(); updateUI();
};
window.redoMove = function() {
    if (redoStack.length === 0) return;
    const s = redoStack.pop(); historyStack.push(s);
    board = s.board.map(r=>[...r]); score = s.score; myGarbageStack = s.myGarbageStack; queueIndex = s.queueIndex;
    gameState = 'playing'; generateNewPuyo(); renderBoard(); updateUI();
};
window.resetGame = function() { clearInterval(dropTimer); initializeGame(); };
function startPuyoDropLoop() { clearInterval(dropTimer); dropTimer = setInterval(() => { if (gameState === 'playing' && autoDropEnabled) { if (!movePuyo(0, -1)) placePuyo(); } }, dropInterval); }

window.receiveGarbage = function(amount) { myGarbageStack += amount; updateUI(); };

document.addEventListener('keydown', handleInput);
window.addEventListener('load', initializeGame);
