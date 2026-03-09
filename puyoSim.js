// ぷよぷよシミュレーション（修正版：履歴上限300 / NextQueue / 連鎖安全化 / オンライン対戦対応）
// 修正済み完全版（Edit→Play の currentPuyo 入替、Edit NEXT 表示修正、履歴初期化の重複防止、連鎖キャンセル、オンライン対戦フック追加）

// 盤面サイズ
const WIDTH = 6;
const HEIGHT = 14; // 全行数（インデックス 0..HEIGHT-1）
const HIDDEN_ROWS = 2; // 上部の隠し行数（可視領域 = HEIGHT - HIDDEN_ROWS）
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

// スコア計算の値（ボーナステーブル）
const BONUS_TABLE = {
    CHAIN: [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512],
    GROUP: [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    COLOR: [0, 0, 3, 6, 12]
};

// 履歴管理パラメータ（変更：300）
const MAX_HISTORY_SIZE = 300; // 履歴上限（メモリ対策のため上限を設ける）

// ゲームの状態管理
let board = [];
let currentPuyo = null;
// nextQueue / queueIndex を導入（NextQueue方式）
let nextQueue = [];
let queueIndex = 0;

// online.jsとの互換性のためのエイリアス
Object.defineProperty(window, 'nextPuyoColors', {
    get: function() {
        // 現在のキューから表示分（NEXT1, NEXT2）以降を返すか、全体を返す
        // online.jsの同期用には全体を返すのが望ましい
        return nextQueue;
    },
    set: function(val) {
        nextQueue = val;
        queueIndex = 0; // 同期されたら最初から
    }
});

let score = 0;
let chainCount = 0;
let gameState = 'playing'; // 'playing', 'chaining', 'gameover', 'editing', 'setting'
let currentEditColor = COLORS.EMPTY; // エディットモードで選択中の色
let editingNextPuyos = []; // エディットモード用 NEXT リスト
let nextEdited = false;

// 履歴スタック（Undo / Redo）
let historyStack = [];
let redoStack = [];

// 落下ループ
let dropInterval = 1000; // ms
let dropTimer = null;
let autoDropEnabled = false;

// 連鎖速度設定
let gravityWaitTime = 300;
let chainWaitTime = 300;

// クイックターン
let lastFailedRotation = { type: null, timestamp: 0 };
const QUICK_TURN_WINDOW = 300; // ms

// 連鎖非同期制御（追加）
let chainTimer = null;
let chainAbortFlag = false;

// ---------- ユーティリティ関数 ----------
function copyBoard(srcBoard) {
    return srcBoard.map(row => row.slice());
}
function copyNextQueue(srcQueue) {
    return srcQueue.map(pair => pair.slice());
}

// sleep helper that registers chainTimer so it can be cancelled
function sleep(ms) {
    return new Promise(resolve => {
        // clear previous timer reference (safety)
        if (chainTimer) {
            clearTimeout(chainTimer);
            chainTimer = null;
        }
        chainTimer = setTimeout(() => {
            chainTimer = null;
            resolve();
        }, ms);
    });
}

function stopChain() {
    // 連鎖中タイマーをキャンセルし、フラグを立てる
    if (chainTimer) {
        clearTimeout(chainTimer);
        chainTimer = null;
    }
    chainAbortFlag = true;
}

// ---------- NextQueue 管理 ----------
function generateInitialNextQueue() {
    nextQueue = [];
    queueIndex = 0;
    // ここでは pair の内部形式を [sub, main] とする（index0 = sub(上), index1 = main(下)）
    const initialCount = Math.max(MAX_NEXT_PUYOS, 100);
    for (let i = 0; i < initialCount; i++) {
        nextQueue.push(getRandomPair());
    }
}
function ensureNextQueueCapacity() {
    // queueIndex が末尾に近づいたら補充
    const threshold = 40; // 残り少なくなったら補充（調整可）
    if (nextQueue.length - queueIndex < threshold) {
        for (let i = 0; i < 100; i++) {
            nextQueue.push(getRandomPair());
        }
    }
}
function consumeNextPair() {
    if (queueIndex >= nextQueue.length) {
        // もし何らかの理由で尽きたら補充
        for (let i = 0; i < 100; i++) nextQueue.push(getRandomPair());
    }
    const pair = nextQueue[queueIndex];
    queueIndex++;
    ensureNextQueueCapacity();
    // pair の順は [sub, main]（上, 下）
    return [pair[0], pair[1]];
}

// ---------- DOM 初期化 / 描画 ----------
function createBoardDOM() {
    const boardElement = document.getElementById('puyo-board');
    if (!boardElement) return;
    boardElement.innerHTML = '';

    // DOMは y = HEIGHT-1 (top) から 0 (bottom) の順で作る（描画上上から下へ）
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
    const boardElement = document.getElementById('puyo-board');
    if (!boardElement) return;

    // 盤面のぷよを描画（board[y][x] の y=0 が一番下）
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const cellElement = document.getElementById('cell-' + x + '-' + y);
            if (!cellElement) continue;
            const puyoElement = cellElement.firstChild;
            if (!puyoElement) continue;
            const color = board[y][x];
            puyoElement.className = 'puyo puyo-' + color;
            puyoElement.setAttribute('data-color', color);
        }
    }

    // 操作中のぷよとゴースト
    if (currentPuyo && gameState === 'playing') {
        renderCurrentPuyo();
    }

    // NEXT 表示
    if (gameState === 'playing') {
        renderPlayNextPuyo();
    } else if (gameState === 'editing') {
        renderEditNextPuyos();
    }

    // オンライン対戦用の盤面送信
    if (window.sendBoardData) window.sendBoardData();
}

function renderCurrentPuyo() {
    if (!currentPuyo) return;
    const currentCoords = getPuyoCoords();
    const ghostCoords = getGhostFinalPositions();

    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const cell = document.getElementById(`cell-${x}-${y}`);
            if (!cell) continue;
            const puyo = cell.firstChild;
            if (!puyo) continue;

            let cellColor = board[y][x];
            let puyoClasses = 'puyo puyo-' + cellColor;

            const inFlight = currentCoords.find(p => p.x === x && p.y === y);
            if (inFlight) {
                cellColor = inFlight.color;
                puyoClasses = 'puyo puyo-' + cellColor;
            } else {
                const ghost = ghostCoords.find(p => p.x === x && p.y === y);
                if (ghost) {
                    cellColor = ghost.color;
                    puyoClasses = 'puyo puyo-' + cellColor + ' puyo-ghost';
                }
            }

            puyo.className = puyoClasses;
            puyo.setAttribute('data-color', cellColor);
        }
    }
}

function renderPlayNextPuyo() {
    // NextQueue方式に合わせる（queueIndex を基準に表示）
    const next1Element = document.getElementById('next-puyo-1');
    const next2Element = document.getElementById('next-puyo-2');
    if (!next1Element || !next2Element) return;

    const createPuyo = (color) => {
        const el = document.createElement('div');
        el.className = 'puyo puyo-' + color;
        return el;
    };

    // show next at queueIndex (NEXT1) and queueIndex+1 (NEXT2)
    const pairs = [
        nextQueue[queueIndex] || [COLORS.EMPTY, COLORS.EMPTY],
        nextQueue[queueIndex + 1] || [COLORS.EMPTY, COLORS.EMPTY]
    ];

    [next1Element, next2Element].forEach((slot, idx) => {
        slot.innerHTML = '';
        const pair = pairs[idx];
        if (pair) {
            // pair is [sub, main] by construction earlier; show sub (top) then main (bottom)
            slot.appendChild(createPuyo(pair[1]));
            slot.appendChild(createPuyo(pair[0]));
        }
    });
}

// ---------- UI 更新 ----------
function updateUI() {
    const scoreElement = document.getElementById('score');
    const chainElement = document.getElementById('chain-count');
    if (scoreElement) scoreElement.textContent = score;
    if (chainElement) chainElement.textContent = chainCount;
    updateHistoryButtons();
}

// ---------- ステージコード化 / 復元 ----------
window.copyStageCode = function() {
    if (gameState !== 'editing') {
        alert("ステージコード化はエディットモードでのみ実行できます。");
        return;
    }

    let dataArray = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            dataArray.push(board[y][x]);
        }
    }
    // editingNextPuyos は編集用 NEXT（pair = [sub, main]）
    editingNextPuyos.forEach(pair => {
        dataArray.push(pair[0]); // sub
        dataArray.push(pair[1]); // main
    });

    // 3bit -> バイナリ -> バイト列 -> Base64
    let binaryString = "";
    dataArray.forEach(color => {
        binaryString += color.toString(2).padStart(3, '0');
    });

    let byteString = "";
    for (let i = 0; i < binaryString.length; i += 8) {
        const byte = binaryString.substring(i, i + 8).padEnd(8, '0');
        byteString += String.fromCharCode(parseInt(byte, 2));
    }

    const stageCode = btoa(byteString);
    const codeInput = document.getElementById('stage-code-input');
    if (codeInput) {
        codeInput.value = stageCode;
        codeInput.select();
        document.execCommand('copy');
        alert('現在のステージコードをクリップボードにコピーしました！');
    }
};

window.loadStageCode = function() {
    if (gameState !== 'editing') {
        alert("ステージコードの読み込みはエディットモードでのみ実行できます。");
        return;
    }
    const codeInput = document.getElementById('stage-code-input');
    const stageCode = codeInput ? codeInput.value.trim() : "";
    if (!stageCode) {
        alert("ステージコードが入力されていません。");
        return;
    }

    try {
        const byteString = atob(stageCode);
        let binaryString = "";
        for (let i = 0; i < byteString.length; i++) {
            binaryString += byteString.charCodeAt(i).toString(2).padStart(8, '0');
        }

        let dataArray = [];
        for (let i = 0; i < binaryString.length; i += 3) {
            const colorBinary = binaryString.substring(i, i + 3);
            if (colorBinary.length === 3) {
                dataArray.push(parseInt(colorBinary, 2));
            }
        }

        if (dataArray.length < 184) throw new Error("データ不足");

        let idx = 0;
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                board[y][x] = dataArray[idx++];
            }
        }
        editingNextPuyos = [];
        for (let i = 0; i < MAX_NEXT_PUYOS; i++) {
            const sub = dataArray[idx++];
            const main = dataArray[idx++];
            editingNextPuyos.push([sub, main]);
        }
        renderBoard();
        renderEditNextPuyos();
        alert('ステージコードを読み込みました。');
    } catch (e) {
        console.error("ステージコード復元エラー:", e);
        alert('無効なステージコードです。');
    }
};

// ---------- 履歴管理 ----------
function saveState(clearRedo = true) {
    const state = {
        board: copyBoard(board),
        nextQueue: copyNextQueue(nextQueue),
        queueIndex: queueIndex,
        score: score,
        chainCount: chainCount
    };
    historyStack.push(state);
    if (historyStack.length > MAX_HISTORY_SIZE) historyStack.shift();
    if (clearRedo) redoStack = [];
    updateHistoryButtons();
}

function restoreState(state) {
    if (!state) return;
    board = copyBoard(state.board);
    nextQueue = copyNextQueue(state.nextQueue);
    queueIndex = state.queueIndex;
    score = state.score;
    chainCount = state.chainCount;

    currentPuyo = null;
    gameState = 'playing';
    clearInterval(dropTimer);

    generateNewPuyo();
    startPuyoDropLoop();
    updateUI();
    renderBoard();
}

window.undoMove = function() {
    if (gameState !== 'playing' && gameState !== 'gameover') return;
    if (historyStack.length <= 1) return;
    const current = historyStack.pop();
    redoStack.push(current);
    const prev = historyStack[historyStack.length - 1];
    restoreState(prev);
};

window.redoMove = function() {
    if (gameState !== 'playing' && gameState !== 'gameover') return;
    if (redoStack.length === 0) return;
    const next = redoStack.pop();
    historyStack.push(next);
    restoreState(next);
};

function updateHistoryButtons() {
    const undoBtn = document.getElementById('undo-button');
    const redoBtn = document.getElementById('redo-button');
    if (undoBtn) undoBtn.disabled = historyStack.length <= 1;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

// ---------- ゲームロジック ----------
function getRandomColor() {
    return Math.floor(Math.random() * 4) + 1;
}
function getRandomPair() {
    return [getRandomColor(), getRandomColor()];
}

function generateNewPuyo() {
    if (gameState !== 'playing') return;

    // NextQueue から 1組消費
    const [c_sub, c_main] = consumeNextPair();

    currentPuyo = {
        mainColor: c_main,
        subColor: c_sub,
        mainX: 2,
        mainY: HEIGHT - 2, // 12
        rotation: 0 // sub が main の上
    };

    const startCoords = getCoordsFromState(currentPuyo);
    // 窒息判定
    const isOverlapping = startCoords.some(p => p.x === 2 && p.y === (HEIGHT - 3) && board[p.y][p.x] !== COLORS.EMPTY);

    if (checkCollision(startCoords) || isOverlapping) {
        gameState = 'gameover';
        clearInterval(dropTimer);
        updateUI();
        renderBoard();
        
        // オンライン対戦用のゲームオーバー通知
        if (window.notifyGameOver) {
            window.notifyGameOver();
        } else {
            alert('ゲームオーバー！');
        }
        return;
    }
}

function getCoordsFromState(puyo) {
    const { mainX, mainY, rotation } = puyo;
    let subX = mainX, subY = mainY;
    if (rotation === 0) subY = mainY + 1;
    else if (rotation === 1) subX = mainX - 1;
    else if (rotation === 2) subY = mainY - 1;
    else if (rotation === 3) subX = mainX + 1;
    return [{ x: mainX, y: mainY }, { x: subX, y: subY }];
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
        // y >= HEIGHT (隠し行より上) は衝突とみなさない
        if (p.y < HEIGHT && board[p.y][p.x] !== COLORS.EMPTY) return true;
    }
    return false;
}

function movePuyo(dx, dy, newRot, shouldRender = true) {
    if (gameState !== 'playing' || !currentPuyo) return false;
    const test = {
        mainX: currentPuyo.mainX + dx,
        mainY: currentPuyo.mainY + dy,
        rotation: newRot !== undefined ? newRot : currentPuyo.rotation
    };
    if (!checkCollision(getCoordsFromState(test))) {
        currentPuyo.mainX = test.mainX;
        currentPuyo.mainY = test.mainY;
        if (newRot !== undefined) currentPuyo.rotation = newRot;
        if (shouldRender) renderBoard();
        return true;
    }
    return false;
}

function rotatePuyoCW() {
    if (gameState !== 'playing' || !currentPuyo) return;
    const nextRot = (currentPuyo.rotation + 1) % 4;
    if (!movePuyo(0, 0, nextRot)) {
        // 壁蹴り
        if (currentPuyo.rotation === 0 || currentPuyo.rotation === 2) {
            if (!movePuyo(1, 0, nextRot)) {
                if (!movePuyo(-1, 0, nextRot)) movePuyo(0, 1, nextRot);
            }
        } else {
            movePuyo(0, 1, nextRot);
        }
    }
}

function rotatePuyoCCW() {
    if (gameState !== 'playing' || !currentPuyo) return;
    const nextRot = (currentPuyo.rotation + 3) % 4;
    if (!movePuyo(0, 0, nextRot)) {
        if (currentPuyo.rotation === 0 || currentPuyo.rotation === 2) {
            if (!movePuyo(1, 0, nextRot)) {
                if (!movePuyo(-1, 0, nextRot)) movePuyo(0, 1, nextRot);
            }
        } else {
            movePuyo(0, 1, nextRot);
        }
    }
}

function getGhostFinalPositions() {
    if (!currentPuyo || gameState !== 'playing') return [];
    const temp = { ...currentPuyo };
    while (!checkCollision(getCoordsFromState({ ...temp, mainY: temp.mainY - 1 }))) {
        temp.mainY--;
    }
    const coords = getCoordsFromState(temp);
    coords[0].color = currentPuyo.mainColor;
    coords[1].color = currentPuyo.subColor;
    return coords;
}

function hardDrop() {
    if (gameState !== 'playing' || !currentPuyo) return;
    while (movePuyo(0, -1, undefined, false));
    placePuyo();
}

function placePuyo() {
    if (!currentPuyo) return;
    const coords = getPuyoCoords();
    coords.forEach(p => {
        if (p.y >= 0 && p.y < HEIGHT) board[p.y][p.x] = p.color;
    });
    currentPuyo = null;
    gameState = 'chaining';
    clearInterval(dropTimer);
    chainCount = 0;
    chainAbortFlag = false;
    runChain();
}

function findConnectedPuyos() {
    let visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
    let groups = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const color = board[y][x];
            if (color !== COLORS.EMPTY && color !== COLORS.GARBAGE && !visited[y][x]) {
                let group = [];
                let q = [{ x, y }];
                visited[y][x] = true;
                while (q.length > 0) {
                    let curr = q.shift();
                    group.push(curr);
                    [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }].forEach(d => {
                        let nx = curr.x + d.x, ny = curr.y + d.y;
                        if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT && !visited[ny][nx] && board[ny][nx] === color) {
                            visited[ny][nx] = true;
                            q.push({ x: nx, y: ny });
                        }
                    });
                }
                if (group.length >= 4) groups.push({ group, color });
            }
        }
    }
    return groups;
}

function clearGarbagePuyos(erased) {
    let toClear = new Set();
    erased.forEach(p => {
        [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }].forEach(d => {
            let nx = p.x + d.x, ny = p.y + d.y;
            if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT && board[ny][nx] === COLORS.GARBAGE) {
                toClear.add(`${nx},${ny}`);
            }
        });
    });
    toClear.forEach(s => {
        const [x, y] = s.split(',').map(Number);
        board[y][x] = COLORS.EMPTY;
    });
}

async function runChain() {
    // 1) 落下
    gravity();
    renderBoard();

    // 2) 連結チェック
    const groups = findConnectedPuyos();
    if (groups.length === 0) {
        // 14段目（最上段）のぷよを消去（仕様）
        let cleared = false;
        for (let x = 0; x < WIDTH; x++) {
            if (board[HEIGHT - 1][x] !== COLORS.EMPTY) {
                board[HEIGHT - 1][x] = COLORS.EMPTY;
                cleared = true;
            }
        }
        if (cleared) {
            renderBoard();
            await sleep(gravityWaitTime);
            await runChain();
            return;
        }

        gameState = 'playing';
        if (!currentPuyo) {
            ensureNextQueueCapacity();
            generateNewPuyo();
        }
        startPuyoDropLoop();
        checkMobileControlsVisibility();
        renderBoard();
        saveState(true);
        return;
    }

    // 3) 連鎖発生
    await sleep(chainWaitTime);
    if (chainAbortFlag) return;

    // 4) 消滅
    chainCount++;
    score += calculateScore(groups, chainCount);
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

    // 5) 待機
    await sleep(gravityWaitTime);
    if (chainAbortFlag) return;

    // 6) 重力・再判定
    gravity();
    renderBoard();
    const nextGroups = findConnectedPuyos();
    if (nextGroups.length === 0) {
        gameState = 'playing';
        if (!currentPuyo) {
            ensureNextQueueCapacity();
            generateNewPuyo();
        }
        startPuyoDropLoop();
        checkMobileControlsVisibility();
        renderBoard();
        saveState(true);
    } else {
        await runChain();
    }
}

function calculateScore(groups, chain) {
    let puyos = 0, colors = new Set(), bonus = 0;
    groups.forEach(({ group, color }) => {
        puyos += group.length;
        colors.add(color);
        bonus += BONUS_TABLE.GROUP[Math.min(group.length, BONUS_TABLE.GROUP.length - 1)];
    });
    bonus += BONUS_TABLE.CHAIN[Math.min(chain, BONUS_TABLE.CHAIN.length - 1)];
    bonus += BONUS_TABLE.COLOR[Math.min(colors.size, BONUS_TABLE.COLOR.length - 1)];
    return (10 * puyos) * Math.max(1, bonus);
}

function simulateGravity(tBoard) {
    for (let x = 0; x < WIDTH; x++) {
        let col = [];
        for (let y = 0; y < HEIGHT; y++) if (tBoard[y][x] !== COLORS.EMPTY) col.push(tBoard[y][x]);
        for (let y = 0; y < HEIGHT; y++) tBoard[y][x] = y < col.length ? col[y] : COLORS.EMPTY;
    }
}
function gravity() { simulateGravity(board); }

// ---------- 入力処理 ----------
function handleInput(event) {
    if (gameState !== 'playing') return;
    switch (event.key) {
        case 'ArrowLeft': movePuyo(-1, 0); break;
        case 'ArrowRight': movePuyo(1, 0); break;
        case 'z': case 'Z': rotatePuyoCW(); break;
        case 'x': case 'X': rotatePuyoCCW(); break;
        case 'ArrowDown':
            clearInterval(dropTimer);
            movePuyo(0, -1);
            if (autoDropEnabled) startPuyoDropLoop();
            break;
        case ' ': event.preventDefault(); hardDrop(); break;
    }
}

// ---------- エディット ----------
function renderEditNextPuyos() {
    const listContainer = document.getElementById('edit-next-list-container');
    const visibleSlots = [document.getElementById('edit-next-1'), document.getElementById('edit-next-2')];
    if (!listContainer || !visibleSlots[0] || !visibleSlots[1]) return;

    const createEditablePuyo = (color, lIdx, pIdx) => {
        let p = document.createElement('div');
        p.className = `puyo puyo-${color}`;
        p.addEventListener('pointerdown', (ev) => {
            ev.stopPropagation();
            if (gameState !== 'editing') return;
            if (editingNextPuyos.length > lIdx) {
                editingNextPuyos[lIdx][pIdx] = currentEditColor;
                nextEdited = true;
                renderEditNextPuyos();
            }
        });
        return p;
    };

    visibleSlots.forEach((slot, idx) => {
        slot.innerHTML = '';
        if (editingNextPuyos.length > idx) {
            const [c_sub, c_main] = editingNextPuyos[idx];
            slot.appendChild(createEditablePuyo(c_sub, idx, 0)); // 上 (sub)
            slot.appendChild(createEditablePuyo(c_main, idx, 1)); // 下 (main)
        }
    });

    listContainer.innerHTML = '';
    for (let i = NUM_VISIBLE_NEXT_PUYOS; i < MAX_NEXT_PUYOS; i++) {
        if (editingNextPuyos.length <= i) break;
        const pairC = document.createElement('div');
        pairC.className = 'next-puyo-slot-pair';
        const span = document.createElement('span');
        span.textContent = `N${i + 1}`;
        pairC.appendChild(span);
        const row = document.createElement('div');
        row.className = 'next-puyo-row';
        const [c_sub, c_main] = editingNextPuyos[i];
        row.appendChild(createEditablePuyo(c_sub, i, 0));
        row.appendChild(createEditablePuyo(c_main, i, 1));
        pairC.appendChild(row);
        listContainer.appendChild(pairC);
    }
}

function handleBoardClickEditMode(event) {
    if (gameState !== 'editing') return;
    const rect = event.target.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / (rect.width / WIDTH));
    const y = HEIGHT - 1 - Math.floor((event.clientY - rect.top) / (rect.height / HEIGHT));
    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) {
        board[y][x] = currentEditColor;
        renderBoard();
    }
}

function selectPaletteColor(color) {
    currentEditColor = color;
    document.querySelectorAll('.palette-color').forEach(el => {
        el.classList.toggle('selected', parseInt(el.getAttribute('data-color')) === color);
    });
}

window.applyNextPuyos = function() {
    nextQueue = JSON.parse(JSON.stringify(editingNextPuyos));
    queueIndex = 0;
    nextEdited = true;
    alert('ネクスト設定を適用しました。');
};

// ---------- 初期化 / モード切替 ----------
function initializeGame() {
    stopChain();
    createBoardDOM();
    board = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(COLORS.EMPTY));
    score = 0;
    chainCount = 0;
    gameState = 'playing';
    historyStack = [];
    redoStack = [];
    generateInitialNextQueue();
    editingNextPuyos = JSON.parse(JSON.stringify(nextQueue.slice(0, MAX_NEXT_PUYOS)));
    currentEditColor = COLORS.EMPTY;

    const modeBtn = document.querySelector('.mode-toggle-btn');
    if (modeBtn) modeBtn.textContent = 'edit';
    const infoP = document.getElementById('info-panel');
    if (infoP) infoP.classList.remove('edit-mode-active');

    generateNewPuyo();
    startPuyoDropLoop();
    updateUI();
    renderBoard();
    saveState(false);
}

function startPuyoDropLoop() {
    clearInterval(dropTimer);
    dropTimer = setInterval(() => {
        if (gameState === 'playing' && autoDropEnabled) {
            if (!movePuyo(0, -1)) placePuyo();
        }
    }, dropInterval);
}

function checkMobileControlsVisibility() {
    const mc = document.getElementById('mobile-controls');
    if (!mc) return;
    const isMobile = window.innerWidth <= 650;
    mc.classList.toggle('visible', isMobile && (gameState === 'playing' || gameState === 'gameover'));
    document.body.classList.toggle('edit-mode-active', gameState === 'editing');
}

window.toggleMode = function() {
    const infoP = document.getElementById('info-panel');
    const modeBtn = document.querySelector('.mode-toggle-btn');
    const bEl = document.getElementById('puyo-board');
    if (gameState === 'playing' || gameState === 'gameover') {
        clearInterval(dropTimer);
        gameState = 'editing';
        if (infoP) infoP.classList.add('edit-mode-active');
        document.body.classList.add('edit-mode-active');
        if (modeBtn) modeBtn.textContent = 'play';
        if (bEl) bEl.addEventListener('click', handleBoardClickEditMode);
        selectPaletteColor(COLORS.EMPTY);
        renderEditNextPuyos();
        renderBoard();
    } else if (gameState === 'editing') {
        gameState = 'playing';
        if (infoP) infoP.classList.remove('edit-mode-active');
        document.body.classList.remove('edit-mode-active');
        if (modeBtn) modeBtn.textContent = 'edit';
        if (bEl) bEl.removeEventListener('click', handleBoardClickEditMode);
        if (nextEdited) {
            currentPuyo = null;
            generateNewPuyo();
            nextEdited = false;
        }
        if (autoDropEnabled) startPuyoDropLoop();
        renderBoard();
    }
    checkMobileControlsVisibility();
};

window.toggleSettingMode = function() {
    const overlay = document.getElementById('setting-overlay');
    if (!overlay) return;
    if (gameState !== 'setting') {
        previousGameState = gameState;
        gameState = 'setting';
        overlay.style.display = 'flex';
    } else {
        gameState = previousGameState;
        overlay.style.display = 'none';
    }
    checkMobileControlsVisibility();
};

window.updateGravityWait = function(v) { gravityWaitTime = parseInt(v); const d = document.getElementById('gravity-wait-value'); if (d) d.textContent = v + 'ms'; };
window.updateChainWait = function(v) { chainWaitTime = parseInt(v); const d = document.getElementById('chain-wait-value'); if (d) d.textContent = v + 'ms'; };
window.toggleAutoDrop = function() {
    autoDropEnabled = !autoDropEnabled;
    const btn = document.getElementById('auto-drop-toggle-button');
    if (btn) {
        btn.textContent = `自動落下: ${autoDropEnabled ? 'ON' : 'OFF'}`;
        btn.classList.toggle('disabled', !autoDropEnabled);
    }
    if (autoDropEnabled && gameState === 'playing') startPuyoDropLoop();
    else clearInterval(dropTimer);
};
window.resetGame = function() { clearInterval(dropTimer); initializeGame(); };

// raisePuyoOneRow
(function() {
    'use strict';
    window.raisePuyoOneRow = function() {
        if (gameState !== 'playing' || !currentPuyo) return;
        const { mainX, mainY, rotation } = currentPuyo;
        let subX = mainX, subY = mainY;
        if (rotation === 0) subY++; else if (rotation === 1) subX--; else if (rotation === 2) subY--; else if (rotation === 3) subX++;
        const nMY = mainY + 1, nSY = subY + 1;
        if (nMY >= HEIGHT || nSY >= HEIGHT) { alert('上限です'); return; }
        if ((nMY < HEIGHT - HIDDEN_ROWS && board[nMY][mainX] !== COLORS.EMPTY) || (nSY < HEIGHT - HIDDEN_ROWS && board[nSY][subX] !== COLORS.EMPTY)) { alert('障害物あり'); return; }
        currentPuyo.mainY = nMY;
        renderBoard();
    };
    document.addEventListener('keydown', e => { if (gameState === 'playing' && e.key === 'u') window.raisePuyoOneRow(); });
})();

document.addEventListener('DOMContentLoaded', () => {
    initializeGame();
    document.addEventListener('keydown', handleInput);
    window.addEventListener('resize', checkMobileControlsVisibility);
});
