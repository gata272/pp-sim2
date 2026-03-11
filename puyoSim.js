// ぷよぷよシミュレーションシステム (バックアップ完全復元版 + おじゃまスタック用変数)

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
    GARBAGE: 5
};

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
let nextEdited = false;

// おじゃまぷよスタック (追加分)
let myGarbageStack = 0;

// 履歴管理
let historyStack = [];
let redoStack = [];
const MAX_HISTORY_SIZE = 300;

// 落下・連鎖設定
let dropInterval = 1000;
let dropTimer = null;
let autoDropEnabled = true;
let gravityWaitTime = 300;
let chainWaitTime = 300;

// 連鎖非同期制御
let chainTimer = null;
let chainAbortFlag = false;

// ---------- ユーティリティ関数 ----------
function copyBoard(src) { return src.map(row => [...row]); }
function copyNextQueue(src) { return src.map(pair => [...pair]); }

function sleep(ms) {
    return new Promise(resolve => {
        if (chainTimer) clearTimeout(chainTimer);
        chainTimer = setTimeout(() => { chainTimer = null; resolve(); }, ms);
    });
}

function stopChain() {
    if (chainTimer) { clearTimeout(chainTimer); chainTimer = null; }
    chainAbortFlag = true;
}

// ---------- NextQueue 管理 ----------
function generateInitialNextQueue() {
    nextQueue = [];
    queueIndex = 0;
    for (let i = 0; i < 100; i++) nextQueue.push(getRandomPair());
}

function ensureNextQueueCapacity() {
    if (nextQueue.length - queueIndex < 40) {
        for (let i = 0; i < 100; i++) nextQueue.push(getRandomPair());
    }
}

function consumeNextPair() {
    ensureNextQueueCapacity();
    return nextQueue[queueIndex++];
}

// ---------- DOM 初期化 / 描画 (バックアップ完全復元) ----------
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

function renderBoard() {
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const cell = document.getElementById(`cell-${x}-${y}`);
            if (!cell) continue;
            const color = board[y][x];
            cell.firstChild.className = `puyo puyo-${color}`;
            cell.firstChild.setAttribute('data-color', color);
        }
    }
    if (currentPuyo && gameState === 'playing') renderCurrentPuyo();
    if (gameState === 'playing') renderPlayNextPuyo();
    else if (gameState === 'editing') renderEditNextPuyos();
    
    // online.js への通知用
    if (window.sendBoardData) window.sendBoardData();
}

function renderCurrentPuyo() {
    if (!currentPuyo) return;
    const coords = getPuyoCoords();
    const ghost = getGhostFinalPositions();
    
    ghost.forEach(p => {
        const cell = document.getElementById(`cell-${p.x}-${p.y}`);
        if (cell && board[p.y][p.x] === COLORS.EMPTY) {
            cell.firstChild.className = `puyo puyo-${p.color} puyo-ghost`;
        }
    });
    
    coords.forEach(p => {
        const cell = document.getElementById(`cell-${p.x}-${p.y}`);
        if (cell) {
            cell.firstChild.className = `puyo puyo-${p.color}`;
        }
    });
}

function renderPlayNextPuyo() {
    const n1 = document.getElementById('next-puyo-1'), n2 = document.getElementById('next-puyo-2');
    if (!n1 || !n2) return;
    const draw = (el, pair) => {
        el.innerHTML = '';
        if (!pair) return;
        [pair[1], pair[0]].forEach(c => {
            const p = document.createElement('div');
            p.className = `puyo puyo-${c}`;
            el.appendChild(p);
        });
    };
    draw(n1, nextQueue[queueIndex]);
    draw(n2, nextQueue[queueIndex+1]);
}

function renderEditNextPuyos() {
    for (let i = 1; i <= 2; i++) {
        const el = document.getElementById(`edit-next-${i}`);
        if (!el) continue;
        el.innerHTML = '';
        const pair = editingNextPuyos[i-1];
        if (pair) {
            [pair[1], pair[0]].forEach(c => {
                const p = document.createElement('div');
                p.className = `puyo puyo-${c}`;
                el.appendChild(p);
            });
        }
    }
}

// ---------- ゲームロジック ----------
function initializeGame() {
    board = Array(HEIGHT).fill().map(() => Array(WIDTH).fill(COLORS.EMPTY));
    score = 0;
    chainCount = 0;
    myGarbageStack = 0;
    gameState = 'playing';
    
    generateInitialNextQueue();
    editingNextPuyos = copyNextQueue(nextQueue.slice(0, MAX_NEXT_PUYOS));
    
    createBoardDOM();
    generateNewPuyo();
    updateUI();
    renderBoard();
    
    if (!document.initializedKeyHandler) {
        document.addEventListener('keydown', handleInput);
        setupMobileControls();
        document.initializedKeyHandler = true;
    }
    startPuyoDropLoop();
}

function generateNewPuyo() {
    if (gameState !== 'playing') return;
    const pair = consumeNextPair();
    currentPuyo = {
        mainColor: pair[1],
        subColor: pair[0],
        mainX: 2,
        mainY: HEIGHT - 2,
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
    if (chainAbortFlag) { chainAbortFlag = false; return; }

    const groups = findConnectedPuyos();
    if (groups.length === 0) {
        gameState = 'playing';
        generateNewPuyo();
        if (autoDropEnabled) startPuyoDropLoop();
        renderBoard();
        updateUI();
        saveState(true);
        return;
    }

    await sleep(chainWaitTime);
    chainCount++;
    // バックアップの得点計算 (簡易)
    score += (10 * groups.reduce((acc, g) => acc + g.group.length, 0)) * chainCount;

    groups.forEach(({ group }) => {
        group.forEach(({ x, y }) => {
            board[y][x] = COLORS.EMPTY;
        });
    });
    
    renderBoard();
    updateUI();

    await sleep(gravityWaitTime);
    runChain();
}

function updateUI() {
    const s = document.getElementById('score'), c = document.getElementById('chain-count');
    if (s) s.textContent = score;
    if (c) c.textContent = chainCount;
    // スタック数値表示用 (online.js側で作成された要素を更新)
    const g = document.getElementById('my-garbage-stack-val');
    if (g) g.textContent = myGarbageStack;
    updateHistoryButtons();
    checkMobileControlsVisibility();
}

function checkMobileControlsVisibility() {
    const mobileControls = document.getElementById('mobile-controls');
    if (!mobileControls) return;
    mobileControls.style.display = (gameState === 'playing') ? 'flex' : 'none';
}

// ---------- 入力・操作 ----------
function setupMobileControls() {
    const add = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', (e) => { e.preventDefault(); fn(); });
    };
    add('btn-left', () => movePuyo(-1, 0));
    add('btn-right', () => movePuyo(1, 0));
    add('btn-soft-drop', () => movePuyo(0, -1));
    add('btn-hard-drop', () => hardDrop());
    add('btn-rotate-cw', () => rotatePuyoCW());
    add('btn-rotate-ccw', () => rotatePuyoCCW());
}

function handleInput(e) {
    if (gameState !== 'playing') return;
    const key = e.key.toLowerCase();
    if (key === 'arrowleft') movePuyo(-1, 0);
    else if (key === 'arrowright') movePuyo(1, 0);
    else if (key === 'arrowdown') movePuyo(0, -1);
    else if (key === 'z' || key === 'x') key === 'z' ? rotatePuyoCCW() : rotatePuyoCW();
    else if (key === ' ') hardDrop();
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
    if (!movePuyo(0, 0, nr)) { if (!movePuyo(1, 0, nr)) if (!movePuyo(-1, 0, nr)) movePuyo(0, 1, nr); }
}
function rotatePuyoCCW() {
    const nr = (currentPuyo.rotation + 3) % 4;
    if (!movePuyo(0, 0, nr)) { if (!movePuyo(1, 0, nr)) if (!movePuyo(-1, 0, nr)) movePuyo(0, 1, nr); }
}
function hardDrop() { while (movePuyo(0, -1)); placePuyo(); }

function placePuyo() {
    const coords = getPuyoCoords();
    coords.forEach(p => { if (p.y >= 0 && p.y < HEIGHT) board[p.y][p.x] = p.color; });
    currentPuyo = null; gameState = 'chaining'; clearInterval(dropTimer);
    chainCount = 0; runChain();
}

// ---------- その他既存機能 ----------
function getCoordsFromState(p) {
    let { mainX, mainY, rotation } = p;
    let sx = mainX, sy = mainY;
    if (rotation === 0) sy++; else if (rotation === 1) sx--; else if (rotation === 2) sy--; else if (rotation === 3) sx++;
    return [{x: mainX, y: mainY}, {x: sx, y: sy}];
}
function getPuyoCoords() {
    if (!currentPuyo) return [];
    const coords = getCoordsFromState(currentPuyo);
    coords[0].color = currentPuyo.mainColor;
    coords[1].color = currentPuyo.subColor;
    return coords;
}
function checkCollision(coords) {
    for (const p of coords) {
        if (p.x < 0 || p.x >= WIDTH || p.y < 0) return true;
        if (p.y < HEIGHT && board[p.y][p.x] !== COLORS.EMPTY) return true;
    }
    return false;
}
function getGhostFinalPositions() {
    if (!currentPuyo) return [];
    let testY = currentPuyo.mainY;
    while (!checkCollision(getCoordsFromState({...currentPuyo, mainY: testY - 1}))) testY--;
    const coords = getCoordsFromState({...currentPuyo, mainY: testY});
    coords[0].color = currentPuyo.mainColor; coords[1].color = currentPuyo.subColor;
    return coords;
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

// 履歴・リセット
window.undoMove = function() {
    if (historyStack.length <= 1) return;
    redoStack.push(historyStack.pop());
    const s = historyStack[historyStack.length - 1];
    board = s.board.map(r=>[...r]); score = s.score; queueIndex = s.queueIndex;
    gameState = 'playing'; generateNewPuyo(); renderBoard(); updateUI();
};
window.redoMove = function() {
    if (redoStack.length === 0) return;
    const s = redoStack.pop(); historyStack.push(s);
    board = s.board.map(r=>[...r]); score = s.score; queueIndex = s.queueIndex;
    gameState = 'playing'; generateNewPuyo(); renderBoard(); updateUI();
};
window.resetGame = function() { stopChain(); initializeGame(); };
function saveState(c) {
    historyStack.push({board: board.map(r=>[...r]), score, queueIndex});
    if (historyStack.length > MAX_HISTORY_SIZE) historyStack.shift();
    if (c) redoStack = [];
}
function updateHistoryButtons() {
    const u = document.getElementById('undo-button'), r = document.getElementById('redo-button');
    if (u) u.disabled = historyStack.length <= 1;
    if (r) r.disabled = redoStack.length === 0;
}
function startPuyoDropLoop() { clearInterval(dropTimer); dropTimer = setInterval(() => { if (gameState === 'playing' && autoDropEnabled) { if (!movePuyo(0, -1)) placePuyo(); } }, dropInterval); }
window.toggleAutoDrop = function() { autoDropEnabled = !autoDropEnabled; startPuyoDropLoop(); updateUI(); };
window.raisePuyoOneRow = function() { if (gameState === 'playing' && movePuyo(0, 1)) renderBoard(); };

window.toggleMode = function() {
    gameState = (gameState === 'editing') ? 'playing' : 'editing';
    const panel = document.getElementById('info-panel');
    if (panel) panel.classList.toggle('edit-mode-active');
    if (gameState === 'playing') generateNewPuyo();
    renderBoard();
};

window.addEventListener('load', initializeGame);
function getRandomColor() { return Math.floor(Math.random() * 4) + 1; }
function getRandomPair() { return [getRandomColor(), getRandomColor()]; }
