// puyoSim.js

// --- ぷよぷよシミュレーションの定数と設定 ---
const WIDTH = 6;
const HEIGHT = 14; 
const MAX_NEXT_PUYOS = 50; 
const NUM_VISIBLE_NEXT_PUYOS = 2; 

const COLORS = {
    EMPTY: 0,
    RED: 1,
    BLUE: 2,
    GREEN: 3,
    YELLOW: 4,
    GARBAGE: 5
};

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
let historyStack = []; 
let redoStack = [];    

let dropInterval = 1000; 
let dropTimer = null; 
let autoDropEnabled = false; 

let lastFailedRotation = { type: null, timestamp: 0 };
const QUICK_TURN_WINDOW = 300; 

// --- 初期化関数 ---
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

function checkMobileControlsVisibility() {
    const mobileControls = document.getElementById('mobile-controls');
    if (!mobileControls) return;
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
    createBoardDOM(); 
    for (let y = 0; y < HEIGHT; y++) {
        board[y] = Array(WIDTH).fill(COLORS.EMPTY);
    }
    score = 0;
    chainCount = 0;
    gameState = 'playing';
    historyStack = []; 
    redoStack = [];
    nextPuyoColors = [];
    for (let i = 0; i < MAX_NEXT_PUYOS; i++) {
        nextPuyoColors.push(getRandomPair());
    }
    editingNextPuyos = JSON.parse(JSON.stringify(nextPuyoColors));
    currentEditColor = COLORS.EMPTY;

    generateNewPuyo(); 
    startPuyoDropLoop(); 
    updateUI();
    
    if (!document.initializedKeyHandler) {
        document.addEventListener('keydown', handleInput);
        document.addEventListener('keydown', (event) => {
            if ((event.key === 'z' || event.key === 'Z') && !event.shiftKey) {
                // handleInputで回転処理
            } else if (event.key === 'y' || event.key === 'Y' || ((event.key === 'z' || event.key === 'Z') && event.shiftKey)) {
                event.preventDefault();
                redoMove();
            }
        });

        const btnLeft = document.getElementById('btn-left');
        const btnRight = document.getElementById('btn-right');
        const btnRotateCW = document.getElementById('btn-rotate-cw'); 
        const btnRotateCCW = document.getElementById('btn-rotate-ccw'); 
        const btnHardDrop = document.getElementById('btn-hard-drop');

        if (btnLeft) btnLeft.addEventListener('click', () => movePuyo(-1, 0));
        if (btnRight) btnRight.addEventListener('click', () => movePuyo(1, 0));
        if (btnRotateCW) btnRotateCW.addEventListener('click', window.rotatePuyoCW); 
        if (btnRotateCCW) btnRotateCCW.addEventListener('click', window.rotatePuyoCCW); 
        if (btnHardDrop) btnHardDrop.addEventListener('click', hardDrop);
        
        setupEditModeListeners(); 
        document.initializedKeyHandler = true;
    }
    checkMobileControlsVisibility();
    renderBoard();
    saveState(false); 
}

window.resetGame = function() { 
    clearInterval(dropTimer); 
    initializeGame();
}

// --- モード切り替え ---
window.toggleMode = function() {
    const infoPanel = document.getElementById('info-panel');
    const modeToggleButton = document.querySelector('.mode-toggle-btn');
    const boardElement = document.getElementById('puyo-board');
    
    if (gameState === 'playing' || gameState === 'gameover') {
        clearInterval(dropTimer); 
        gameState = 'editing';
        if (infoPanel) infoPanel.classList.add('edit-mode-active');
        document.body.classList.add('edit-mode-active'); 
        if (modeToggleButton) modeToggleButton.textContent = 'play';
        checkMobileControlsVisibility();
        boardElement.addEventListener('click', handleBoardClickEditMode);
        selectPaletteColor(COLORS.EMPTY);
        renderBoard(); 
    } else if (gameState === 'editing') {
        gameState = 'playing';
        if (infoPanel) infoPanel.classList.remove('edit-mode-active');
        document.body.classList.remove('edit-mode-active'); 
        if (modeToggleButton) modeToggleButton.textContent = 'edit';
        checkMobileControlsVisibility();
        boardElement.removeEventListener('click', handleBoardClickEditMode);
        gravity(); 
        nextPuyoColors = JSON.parse(JSON.stringify(editingNextPuyos));
        currentPuyo = null; 
        generateNewPuyo(); 
        startPuyoDropLoop(); 
        saveState();
        renderBoard();
    }
}

// --- ステージコード機能 ---
window.copyStageCode = function() {
    if (gameState !== 'editing') return alert("エディットモードのみ実行可能です");
    let dataArray = [];
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) dataArray.push(board[y][x]);
    editingNextPuyos.forEach(pair => { dataArray.push(pair[0]); dataArray.push(pair[1]); });
    let binaryString = "";
    dataArray.forEach(color => binaryString += color.toString(2).padStart(3, '0'));
    let byteString = "";
    for (let i = 0; i < binaryString.length; i += 8) byteString += String.fromCharCode(parseInt(binaryString.substring(i, i + 8).padEnd(8, '0'), 2));
    const stageCode = btoa(byteString);
    const codeInput = document.getElementById('stage-code-input');
    if (codeInput) { codeInput.value = stageCode; codeInput.select(); document.execCommand('copy'); alert('コピーしました'); }
}

window.loadStageCode = function() {
    if (gameState !== 'editing') return alert("エディットモードのみ実行可能です");
    const codeInput = document.getElementById('stage-code-input');
    if (!codeInput || !codeInput.value) return;
    try {
        const byteString = atob(codeInput.value.trim());
        let binaryString = "";
        for (let i = 0; i < byteString.length; i++) binaryString += byteString.charCodeAt(i).toString(2).padStart(8, '0');
        let dataArray = [];
        for (let i = 0; i < binaryString.length; i += 3) {
            const chunk = binaryString.substring(i, i + 3);
            if (chunk.length === 3) dataArray.push(parseInt(chunk, 2));
        }
        let idx = 0;
        for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) board[y][x] = dataArray[idx++];
        editingNextPuyos = [];
        for (let i = 0; i < MAX_NEXT_PUYOS; i++) editingNextPuyos.push([dataArray[idx++], dataArray[idx++]]);
        renderBoard(); alert('読み込み完了');
    } catch (e) { alert('無効なコードです'); }
}

// --- 履歴管理 ---
function saveState(clearRedoStack = true) {
    const state = {
        board: board.map(row => [...row]),
        nextPuyoColors: nextPuyoColors.map(pair => [...pair]),
        score: score,
        chainCount: chainCount,
        currentPuyo: currentPuyo ? JSON.parse(JSON.stringify(currentPuyo)) : null
    };
    historyStack.push(state);
    if (clearRedoStack) redoStack = [];
    updateHistoryButtons();
}

function restoreState(state) {
    if (!state) return;
    board = state.board.map(row => [...row]);
    nextPuyoColors = state.nextPuyoColors.map(pair => [...pair]);
    score = state.score;
    chainCount = state.chainCount;
    currentPuyo = state.currentPuyo ? JSON.parse(JSON.stringify(state.currentPuyo)) : null;
    gameState = 'playing';
    clearInterval(dropTimer);
    if (currentPuyo === null) generateNewPuyo(); 
    gravity(); 
    const groups = findConnectedPuyos();
    if (groups.length > 0) { gameState = 'chaining'; chainCount = 0; runChain(); }
    else { startPuyoDropLoop(); }
    updateUI();
    renderBoard();
}

window.undoMove = function() {
    if (historyStack.length <= 1) return; 
    redoStack.push(historyStack.pop());
    restoreState(historyStack[historyStack.length - 1]);
}

window.redoMove = function() {
    if (redoStack.length === 0) return;
    const nextState = redoStack.pop();
    historyStack.push(nextState); 
    restoreState(nextState);
}

function updateHistoryButtons() {
    const undoBtn = document.getElementById('undo-button');
    const redoBtn = document.getElementById('redo-button');
    if (undoBtn) undoBtn.disabled = historyStack.length <= 1;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

// --- 落下・移動 ---
function startPuyoDropLoop() {
    if (dropTimer) clearInterval(dropTimer);
    if (gameState === 'playing' && autoDropEnabled) dropTimer = setInterval(dropPuyo, dropInterval);
}

function dropPuyo() {
    if (gameState !== 'playing' || !currentPuyo) return;
    if (!movePuyo(0, -1, undefined, true)) { clearInterval(dropTimer); lockPuyo(); }
}

function movePuyo(dx, dy, newRotation, shouldRender = true) {
    if (gameState !== 'playing' || !currentPuyo) return false; 
    const testPuyo = { 
        mainX: currentPuyo.mainX + dx, 
        mainY: currentPuyo.mainY + dy, 
        rotation: newRotation !== undefined ? newRotation : currentPuyo.rotation 
    };
    const testCoords = getCoordsFromState(testPuyo);
    if (!checkCollision(testCoords)) {
        currentPuyo.mainX = testPuyo.mainX;
        currentPuyo.mainY = testPuyo.mainY;
        if (newRotation !== undefined) currentPuyo.rotation = newRotation;
        if (shouldRender) renderBoard();
        return true;
    }
    return false;
}

function hardDrop() {
    if (gameState !== 'playing' || !currentPuyo) return;
    clearInterval(dropTimer); 
    while (movePuyo(0, -1, undefined, false)); 
    renderBoard(); lockPuyo(); 
}

// --- 回転 (床蹴り・壁蹴り・クイックターン) ---
function getPuyoOrientation() {
    if (!currentPuyo) return 'vertical';
    return (currentPuyo.rotation === 0 || currentPuyo.rotation === 2) ? 'vertical' : 'horizontal';
}

window.rotatePuyoCW = function() {
    if (gameState !== 'playing' || !currentPuyo) return false;
    if (autoDropEnabled) { clearInterval(dropTimer); startPuyoDropLoop(); }
    const newRotation = (currentPuyo.rotation + 1) % 4;
    const orientation = getPuyoOrientation();
    let success = movePuyo(0, 0, newRotation) || movePuyo(1, 0, newRotation) || movePuyo(-1, 0, newRotation);
    if (!success && orientation === 'horizontal') {
        const isMainGrounded = (currentPuyo.mainY === 0 || board[currentPuyo.mainY - 1][currentPuyo.mainX] !== COLORS.EMPTY);
        if (isMainGrounded && movePuyo(0, 1, newRotation)) success = true;
    }
    if (success) { lastFailedRotation.type = null; renderBoard(); return true; }
    const now = Date.now();
    if (lastFailedRotation.type === 'CW' && (now - lastFailedRotation.timestamp) < QUICK_TURN_WINDOW) {
        [currentPuyo.mainColor, currentPuyo.subColor] = [currentPuyo.subColor, currentPuyo.mainColor];
        lastFailedRotation.type = null; renderBoard(); return true;
    }
    lastFailedRotation.type = 'CW'; lastFailedRotation.timestamp = now;
    return false;
};

window.rotatePuyoCCW = function() {
    if (gameState !== 'playing' || !currentPuyo) return false;
    if (autoDropEnabled) { clearInterval(dropTimer); startPuyoDropLoop(); }
    const newRotation = (currentPuyo.rotation - 1 + 4) % 4;
    const orientation = getPuyoOrientation();
    let success = movePuyo(0, 0, newRotation) || movePuyo(1, 0, newRotation) || movePuyo(-1, 0, newRotation);
    if (!success && orientation === 'horizontal') {
        const isMainGrounded = (currentPuyo.mainY === 0 || board[currentPuyo.mainY - 1][currentPuyo.mainX] !== COLORS.EMPTY);
        if (isMainGrounded && movePuyo(0, 1, newRotation)) success = true;
    }
    if (success) { lastFailedRotation.type = null; renderBoard(); return true; }
    const now = Date.now();
    if (lastFailedRotation.type === 'CCW' && (now - lastFailedRotation.timestamp) < QUICK_TURN_WINDOW) {
        [currentPuyo.mainColor, currentPuyo.subColor] = [currentPuyo.subColor, currentPuyo.mainColor];
        lastFailedRotation.type = null; renderBoard(); return true;
    }
    lastFailedRotation.type = 'CCW'; lastFailedRotation.timestamp = now;
    return false;
};

// --- コアロジック ---
function generateNewPuyo() {
    if (gameState !== 'playing') return;
    while (nextPuyoColors.length < MAX_NEXT_PUYOS) nextPuyoColors.push(getRandomPair());
    const [c1, c2] = nextPuyoColors.shift();
    currentPuyo = { mainColor: c1, subColor: c2, mainX: 2, mainY: HEIGHT - 2, rotation: 0 };
    if (checkCollision(getCoordsFromState(currentPuyo)) || board[HEIGHT - 3][2] !== COLORS.EMPTY) {
        gameState = 'gameover'; alert('ゲームオーバー'); clearInterval(dropTimer); renderBoard(); return; 
    }
    nextPuyoColors.push(getRandomPair());
}

function getCoordsFromState(puyo) {
    let subX = puyo.mainX, subY = puyo.mainY;
    if (puyo.rotation === 0) subY++; 
    else if (puyo.rotation === 1) subX--; 
    else if (puyo.rotation === 2) subY--; 
    else if (puyo.rotation === 3) subX++;
    return [{ x: puyo.mainX, y: puyo.mainY, color: puyo.mainColor }, { x: subX, y: subY, color: puyo.subColor }];
}

function checkCollision(coords) {
    return coords.some(p => p.x < 0 || p.x >= WIDTH || p.y < 0 || (p.y < HEIGHT && board[p.y][p.x] !== COLORS.EMPTY));
}

function getGhostFinalPositions() {
    if (!currentPuyo || gameState !== 'playing') return [];
    let tempBoard = board.map(row => [...row]);
    let tempPuyo = JSON.parse(JSON.stringify(currentPuyo));
    while (!checkCollision(getCoordsFromState({ ...tempPuyo, mainY: tempPuyo.mainY - 1 }))) tempPuyo.mainY--;
    const coords = getCoordsFromState(tempPuyo);
    coords.forEach(p => { if (p.y >= 0 && p.y < HEIGHT) tempBoard[p.y][p.x] = p.color; });
    simulateGravity(tempBoard);
    let ghosts = [];
    for (let y = 0; y < HEIGHT - 2; y++) {
        for (let x = 0; x < WIDTH; x++) {
            if (board[y][x] === COLORS.EMPTY && tempBoard[y][x] !== COLORS.EMPTY) {
                ghosts.push({ x, y, color: tempBoard[y][x] });
            }
        }
    }
    return ghosts;
}

function lockPuyo() {
    const coords = getCoordsFromState(currentPuyo);
    coords.forEach(p => { if (p.y >= 0 && p.y < HEIGHT) board[p.y][p.x] = p.color; });
    for (let x = 0; x < WIDTH; x++) board[HEIGHT - 1][x] = COLORS.EMPTY;
    currentPuyo = null; saveState(true); 
    gameState = 'chaining'; chainCount = 0; runChain();
}

async function runChain() {
    gravity(); renderBoard(); await new Promise(r => setTimeout(r, 300));
    const groups = findConnectedPuyos();
    if (groups.length === 0) {
        if (checkBoardEmpty()) { score += 3600; updateUI(); }
        if (board[HEIGHT - 3][2] !== COLORS.EMPTY) { gameState = 'gameover'; alert('ゲームオーバー'); return; }
        gameState = 'playing'; generateNewPuyo(); startPuyoDropLoop(); renderBoard(); return;
    }
    chainCount++; score += calculateScore(groups, chainCount);
    let erased = [];
    groups.forEach(g => g.group.forEach(p => { board[p.y][p.x] = COLORS.EMPTY; erased.push(p); }));
    clearGarbagePuyos(erased);
    renderBoard(); updateUI(); await new Promise(r => setTimeout(r, 300));
    runChain();
}

function findConnectedPuyos() {
    let groups = [];
    let visited = Array(HEIGHT).fill(0).map(() => Array(WIDTH).fill(false));
    for (let y = 0; y < HEIGHT - 2; y++) {
        for (let x = 0; x < WIDTH; x++) {
            if (board[y][x] === COLORS.EMPTY || board[y][x] === COLORS.GARBAGE || visited[y][x]) continue;
            let color = board[y][x], group = [], stack = [{x, y}];
            visited[y][x] = true;
            while (stack.length > 0) {
                let curr = stack.pop(); group.push(curr);
                [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dx, dy]) => {
                    let nx = curr.x + dx, ny = curr.y + dy;
                    if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT - 2 && !visited[ny][nx] && board[ny][nx] === color) {
                        visited[ny][nx] = true; stack.push({x: nx, y: ny});
                    }
                });
            }
            if (group.length >= 4) groups.push({group, color});
        }
    }
    return groups;
}

function simulateGravity(targetBoard) {
    for (let x = 0; x < WIDTH; x++) {
        let col = [];
        for (let y = 0; y < HEIGHT; y++) if (targetBoard[y][x] !== COLORS.EMPTY) col.push(targetBoard[y][x]);
        for (let y = 0; y < HEIGHT; y++) targetBoard[y][x] = (y < col.length) ? col[y] : COLORS.EMPTY;
    }
}
function gravity() { simulateGravity(board); }

// --- UI / Rendering ---
function renderBoard() {
    const coords = currentPuyo ? getCoordsFromState(currentPuyo) : [];
    const ghosts = (gameState === 'playing' && currentPuyo) ? getGhostFinalPositions() : [];
    for (let y = HEIGHT - 1; y >= 0; y--) {
        for (let x = 0; x < WIDTH; x++) {
            const cell = document.getElementById(`cell-${x}-${y}`);
            if (!cell) continue;
            let color = board[y][x], className = `puyo puyo-${color}`;
            let active = coords.find(p => p.x === x && p.y === y);
            if (active) color = active.color;
            else {
                let ghost = ghosts.find(p => p.x === x && p.y === y);
                if (ghost) { color = ghost.color; className += ' puyo-ghost'; }
            }
            cell.firstChild.className = `puyo puyo-${color}${className.includes('ghost') ? ' puyo-ghost' : ''}`;
        }
    }
    if (gameState === 'playing') renderPlayNextPuyo(); else if (gameState === 'editing') renderEditNextPuyos();
}

function renderPlayNextPuyo() {
    [1, 2].forEach(i => {
        const el = document.getElementById(`next-puyo-${i}`);
        if (el && nextPuyoColors[i - 1]) el.innerHTML = `<div class="puyo puyo-${nextPuyoColors[i - 1][1]}"></div><div class="puyo puyo-${nextPuyoColors[i - 1][0]}"></div>`;
    });
}

function renderEditNextPuyos() {
    const list = document.getElementById('edit-next-list-container');
    const slots = [document.getElementById('edit-next-1'), document.getElementById('edit-next-2')];
    if (!list || !slots[0]) return;
    const create = (c, li, pi) => {
        let p = document.createElement('div'); p.className = `puyo puyo-${c}`;
        p.onclick = () => { if (gameState === 'editing') { editingNextPuyos[li][pi] = currentEditColor; renderEditNextPuyos(); } };
        return p;
    };
    slots.forEach((s, i) => { s.innerHTML = ''; if (editingNextPuyos[i]) { s.appendChild(create(editingNextPuyos[i][1], i, 1)); s.appendChild(create(editingNextPuyos[i][0], i, 0)); } });
    list.innerHTML = '';
    for (let i = 2; i < MAX_NEXT_PUYOS; i++) {
        let div = document.createElement('div'); div.className = 'next-puyo-slot-pair';
        div.innerHTML = `<span>N${i+1}</span>`;
        let row = document.createElement('div'); row.className = 'next-puyo-row';
        row.appendChild(create(editingNextPuyos[i][1], i, 1)); row.appendChild(create(editingNextPuyos[i][0], i, 0));
        div.appendChild(row); list.appendChild(div);
    }
}

// --- その他補助 ---
function selectPaletteColor(c) { currentEditColor = c; document.querySelectorAll('.palette-color').forEach(p => p.classList.toggle('selected', parseInt(p.dataset.color) === c)); }
function setupEditModeListeners() { document.querySelectorAll('.palette-color').forEach(p => p.onclick = () => selectPaletteColor(parseInt(p.dataset.color))); }
function handleBoardClickEditMode(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / (rect.width / WIDTH));
    const y = HEIGHT - 1 - Math.floor((e.clientY - rect.top) / (rect.height / HEIGHT));
    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) { board[y][x] = currentEditColor; renderBoard(); }
}

function calculateScore(groups, chain) {
    let p = 0, colors = new Set(), b = 0;
    groups.forEach(g => { p += g.group.length; colors.add(g.color); b += BONUS_TABLE.GROUP[Math.min(g.group.length, 15)]; });
    b += BONUS_TABLE.CHAIN[Math.min(chain, 18)] + BONUS_TABLE.COLOR[Math.min(colors.size, 4)];
    return (10 * p) * Math.max(1, b);
}
function clearGarbagePuyos(erased) { erased.forEach(p => { [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx,dy]) => { let nx=p.x+dx,ny=p.y+dy; if(nx>=0&&nx<WIDTH&&ny>=0&&ny<HEIGHT&&board[ny][nx]===COLORS.GARBAGE) board[ny][nx]=COLORS.EMPTY; }); }); }
function handleInput(e) {
    if (gameState !== 'playing') return;
    if (e.key === 'ArrowLeft') movePuyo(-1, 0);
    else if (e.key === 'ArrowRight') movePuyo(1, 0);
    else if (e.key === 'ArrowDown') { movePuyo(0, -1); if (autoDropEnabled) { clearInterval(dropTimer); startPuyoDropLoop(); } }
    else if (e.key === 'z' || e.key === 'Z') window.rotatePuyoCW();
    else if (e.key === 'x' || e.key === 'X') window.rotatePuyoCCW();
    else if (e.key === ' ') { e.preventDefault(); hardDrop(); }
}
function getRandomColor() { return Math.floor(Math.random() * 4) + 1; }
function getRandomPair() { return [getRandomColor(), getRandomColor()]; }
function checkBoardEmpty() { return board.every(row => row.every(c => c === COLORS.EMPTY)); }
function updateUI() { document.getElementById('score').textContent = score; document.getElementById('chain-count').textContent = chainCount; updateHistoryButtons(); }

window.toggleAutoDrop = function() {
    autoDropEnabled = !autoDropEnabled;
    const btn = document.getElementById('auto-drop-toggle-button');
    if (btn) { btn.textContent = `自動落下: ${autoDropEnabled ? 'ON' : 'OFF'}`; btn.classList.toggle('disabled', !autoDropEnabled); }
    if (autoDropEnabled) startPuyoDropLoop(); else clearInterval(dropTimer);
};
window.applyNextPuyos = () => { nextPuyoColors = JSON.parse(JSON.stringify(editingNextPuyos)); alert('保存しました'); };
window.clearEditNext = () => { editingNextPuyos = []; for(let i=0;i<MAX_NEXT_PUYOS;i++) editingNextPuyos.push(getRandomPair()); renderEditNextPuyos(); };

document.addEventListener('DOMContentLoaded', () => { initializeGame(); window.addEventListener('resize', checkMobileControlsVisibility); });
