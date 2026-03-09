// ぷよぷよシミュレーション（修正版：履歴上限300 / NextQueue / 連鎖安全化）
// 修正済み完全版（Edit→Play の currentPuyo 入替、Edit NEXT 表示修正、履歴初期化の重複防止、連鎖キャンセル）

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

let score = 0;
let chainCount = 0;
let gameState = 'playing'; // 'playing', 'chaining', 'gameover', 'editing', 'setting'
let currentEditColor = COLORS.EMPTY; // エディットモードで選択中の色
let editingNextPuyos = []; // エディットモード用 NEXT リスト

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

    // 既存DOMを使って色だけ差し替える方が望ましいが、ここでは確実性優先で再構築（将来の最適化候補）
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

        // 必須データ数チェック（board + MAX_NEXT_PUYOS*2）
        const required = HEIGHT * WIDTH + MAX_NEXT_PUYOS * 2;
        if (dataArray.length < required) {
            throw new Error("データが不足しています。");
        }

        let idx = 0;
        for (let y = 0; y < HEIGHT; y++) {
            board[y] = board[y] || Array(WIDTH).fill(COLORS.EMPTY);
            for (let x = 0; x < WIDTH; x++) {
                board[y][x] = dataArray[idx++];
            }
        }

        editingNextPuyos = [];
        for (let i = 0; i < MAX_NEXT_PUYOS; i++) {
            // dataArray に push した順序に合わせて、ここでは sub, main の順で復元する
            const subColor = dataArray[idx++];   // 上のぷよ
            const mainColor = dataArray[idx++];  // 下のぷよ
            editingNextPuyos.push([subColor, mainColor]); // [sub, main]
        }

        renderBoard();
        renderEditNextPuyos();
        alert('ステージコードを正常に読み込みました。');
    } catch (e) {
        console.error("ステージコードの復元中にエラー:", e);
        alert('ステージコードが無効です。形式を確認してください。');
    }
};

// ---------- 履歴（Undo / Redo） ----------
// saveState: 連鎖終了時のみ呼ぶことで「1手=1履歴」を実現する設計
function saveState(clearRedoStack = true) {
    const state = {
        board: copyBoard(board),
        nextQueue: copyNextQueue(nextQueue),
        queueIndex: queueIndex,
        score: score,
        chainCount: chainCount,
        currentPuyo: currentPuyo ? {
            mainColor: currentPuyo.mainColor,
            subColor: currentPuyo.subColor,
            mainX: currentPuyo.mainX,
            mainY: currentPuyo.mainY,
            rotation: currentPuyo.rotation
        } : null
    };

    historyStack.push(state);

    // 履歴上限を守る（古いものから削る）
    while (historyStack.length > MAX_HISTORY_SIZE) {
        historyStack.shift();
    }

    if (clearRedoStack) redoStack = [];
    updateHistoryButtons();
}

function restoreState(state) {
    if (!state) return;

    // stop any running chain
    stopChain();

    board = copyBoard(state.board);
    nextQueue = copyNextQueue(state.nextQueue);
    queueIndex = state.queueIndex;
    score = state.score;
    chainCount = state.chainCount;

    if (state.currentPuyo) {
        currentPuyo = { ...state.currentPuyo };
    } else {
        currentPuyo = null;
    }

    gameState = 'playing';
    clearInterval(dropTimer);

    // NOTE: 重要 — ここで generateNewPuyo() を自動呼び出ししない（履歴復元時の不整合対策）
    // 代わりに、復元後は盤面を安定化して連鎖判定を行う
    gravity();

    const groups = findConnectedPuyos();
    if (groups.length > 0) {
        gameState = 'chaining';
        chainCount = 0;
        runChain();
    } else {
        startPuyoDropLoop();
    }

    updateUI();
    renderBoard();
}

window.undoMove = function() {
    if (gameState !== 'playing' && gameState !== 'chaining' && gameState !== 'gameover') return;
    if (historyStack.length <= 1) return;

    // 連鎖中タイマーを止めておく
    stopChain();

    const currentState = historyStack.pop();
    redoStack.push(currentState);
    const previousState = historyStack[historyStack.length - 1];
    restoreState(previousState);
    updateHistoryButtons();
};

window.redoMove = function() {
    if (gameState !== 'playing' && gameState !== 'chaining' && gameState !== 'gameover') return;
    if (redoStack.length === 0) return;

    // 連鎖中タイマーを止めておく
    stopChain();

    const nextState = redoStack.pop();
    historyStack.push(nextState);
    restoreState(nextState);
    updateHistoryButtons();
};

function updateHistoryButtons() {
    const undoButton = document.getElementById('undo-button');
    const redoButton = document.getElementById('redo-button');
    if (undoButton) undoButton.disabled = historyStack.length <= 1;
    if (redoButton) redoButton.disabled = redoStack.length === 0;
}

// ---------- ゲームループ / 落下 ----------
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

// ---------- エディットモード ----------
function setupEditModeListeners() {
    const palette = document.getElementById('color-palette');
    if (palette) {
        palette.querySelectorAll('.palette-color').forEach(p => {
            p.addEventListener('click', () => {
                const color = parseInt(p.getAttribute('data-color'), 10);
                selectPaletteColor(color);
            });
        });
    }
}

function selectPaletteColor(color) {
    currentEditColor = color;
    document.querySelectorAll('.palette-color').forEach(el => el.classList.remove('selected'));
    const selectedPuyo = document.querySelector(`.palette-color[data-color="${color}"]`);
    if (selectedPuyo) selectedPuyo.classList.add('selected');
}

function handleBoardClickEditMode(event) {
    if (gameState !== 'editing') return;
    const boardElement = document.getElementById('puyo-board');
    if (!boardElement) return;
    const rect = boardElement.getBoundingClientRect();
    const cellSize = rect.width / WIDTH;
    let x = Math.floor((event.clientX - rect.left) / cellSize);
    let y_dom = Math.floor((event.clientY - rect.top) / cellSize);
    let y = HEIGHT - 1 - y_dom;
    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) {
        board[y][x] = currentEditColor;
        renderBoard();
    }
}

window.applyNextPuyos = function() {
    if (gameState === 'editing') {
        // editingNextPuyos は [ [sub, main], ... ] の配列になっている前提
        // nextQueue に丸ごと置き換えて queueIndex をリセットする（編集結果を即適用）
        nextQueue = copyNextQueue(editingNextPuyos.slice(0, Math.max(editingNextPuyos.length, 1)));
        queueIndex = 0;
        // ensure capacity after replacement
        ensureNextQueueCapacity();
        alert('ネクストぷよの設定を保存しました。プレイモードで適用されます。');
    }
};

window.clearEditNext = function() {
    if (gameState !== 'editing') return;
    editingNextPuyos = [];
    editingNextPuyos.push(getRandomPair());
    for (let i = 1; i < MAX_NEXT_PUYOS; i++) {
        let newPair, retries = 0;
        const MAX_RETRIES = 100;
        do {
            newPair = getRandomPair();
            retries++;
            if (retries > MAX_RETRIES) {
                console.warn("clearEditNext: Max retries reached.");
                break;
            }
        } while (hasFourUniqueColors(editingNextPuyos[i-1], newPair));
        editingNextPuyos.push(newPair);
    }
    renderEditNextPuyos();
    alert('ネクストぷよリストをランダムで再生成しました。');
};

// ---------- ぷよ生成 / 座標系 ----------
function getRandomColor() {
    return Math.floor(Math.random() * 4) + 1;
}

function getRandomPair() {
    // returns [sub, main]
    return [getRandomColor(), getRandomColor()];
}

function hasFourUniqueColors(pair1, pair2) {
    if (!pair1 || !pair2) return false;
    const s = new Set([...pair1, ...pair2]);
    return s.size === 4;
}

let _initializedOnce = false;
function initializeGame() {
    createBoardDOM();
    for (let y = 0; y < HEIGHT; y++) board[y] = Array(WIDTH).fill(COLORS.EMPTY);

    score = 0;
    chainCount = 0;
    gameState = 'playing';

    // NOTE: ユーザー要求により、リセット時に履歴を消さない -> historyStack / redoStack の初期化を除去
    // ただし、最初の初期化時は履歴が空なら初期状態を保存する（resetで何度もpushされるのを防ぐ）
    // NextQueue 初期化
    generateInitialNextQueue();

    // editingNextPuyos は nextQueue をコピーして初期化
    editingNextPuyos = copyNextQueue(nextQueue.slice(0, MAX_NEXT_PUYOS));
    currentEditColor = COLORS.EMPTY;

    const modeToggleButton = document.querySelector('.mode-toggle-btn');
    if (modeToggleButton) modeToggleButton.textContent = 'edit';
    const infoPanel = document.getElementById('info-panel');
    if (infoPanel) infoPanel.classList.remove('edit-mode-active');

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

    // 最初のぷよを生成（generateNewPuyoは nextQueue を消費する）
    // resetのたびに現在の currentPuyo を維持しない仕様にする（明示的に初期化）
    currentPuyo = null;
    ensureNextQueueCapacity();
    generateNewPuyo();
    startPuyoDropLoop();
    updateUI();

    if (!document.initializedKeyHandler) {
        document.addEventListener('keydown', handleInput);
        document.addEventListener('keydown', (event) => {
            const key = event.key.toLowerCase();
            if (key === 'u') { event.preventDefault(); undoMove(); }
            else if (key === 'y') { event.preventDefault(); redoMove(); }
            else if (key === 'r') { event.preventDefault(); resetGame(); }
            else if (key === 'e') { event.preventDefault(); toggleMode(); }
        });

        const btnLeft = document.getElementById('btn-left');
        const btnRight = document.getElementById('btn-right');
        const btnRotateCW = document.getElementById('btn-rotate-cw');
        const btnRotateCCW = document.getElementById('btn-rotate-ccw');
        const btnHardDrop = document.getElementById('btn-hard-drop');
        const btnSoftDrop = document.getElementById('btn-soft-drop');

        if (btnLeft) btnLeft.addEventListener('click', () => movePuyo(-1, 0));
        if (btnRight) btnRight.addEventListener('click', () => movePuyo(1, 0));
        if (btnRotateCW) btnRotateCW.addEventListener('click', window.rotatePuyoCW);
        if (btnRotateCCW) btnRotateCCW.addEventListener('click', window.rotatePuyoCCW);
        if (btnHardDrop) btnHardDrop.addEventListener('click', hardDrop);
        if (btnSoftDrop) btnSoftDrop.addEventListener('click', () => {
            if (gameState === 'playing') {
                clearInterval(dropTimer);
                movePuyo(0, -1);
                if (autoDropEnabled) startPuyoDropLoop();
            }
        });

        setupEditModeListeners();
        document.initializedKeyHandler = true;
    }

    checkMobileControlsVisibility();
    renderBoard();

    // 初回のみ履歴に保存（リセットのたびに履歴を増やさない）
    if (!_initializedOnce) {
        saveState(false);
        _initializedOnce = true;
    }
}

function generateNewPuyo() {
    if (gameState !== 'playing') return;

    // nextQueue からペアを取得（consumeNextPairは queueIndex を進める）
    ensureNextQueueCapacity();
    const [main, sub] = consumeNextPair(); // returns [sub, main]

    // currentPuyo の mainColor/subColor の表記は既存仕様に合わせる
    currentPuyo = {
        mainColor: main,
        subColor: sub,
        mainX: 2,
        mainY: HEIGHT - 2,
        rotation: 0
    };

    const startingCoords = getCoordsFromState(currentPuyo);
    const isOverlappingTarget = startingCoords.some(p => p.x === 2 && p.y === (HEIGHT - 3) && board[p.y][p.x] !== COLORS.EMPTY);

    if (checkCollision(startingCoords) || isOverlappingTarget) {
        gameState = 'gameover';
        alert('ゲームオーバーです！');
        clearInterval(dropTimer);
        updateUI();
        renderBoard();
        return;
    }
}

function getCoordsFromState(puyoState) {
    const { mainX, mainY, rotation } = puyoState;
    let subX = mainX;
    let subY = mainY;
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

// ゴースト計算（隠し行は最終的にフィルタで除外）
function getGhostFinalPositions() {
    if (!currentPuyo || gameState !== 'playing') return [];
    let tempBoard = board.map(row => [...row]);
    let tempPuyo = { ...currentPuyo };

    while (true) {
        let testPuyo = { ...tempPuyo, mainY: tempPuyo.mainY - 1 };
        const testCoords = getCoordsFromState(testPuyo);
        if (checkCollision(testCoords)) break;
        tempPuyo.mainY -= 1;
    }

    const finalCoordsBeforeGravity = getCoordsFromState(tempPuyo);
    const puyoColors = [tempPuyo.mainColor, tempPuyo.subColor];

    finalCoordsBeforeGravity.forEach(p => {
        if (p.y >= 0 && p.y < HEIGHT) {
            const color = (p.x === tempPuyo.mainX && p.y === tempPuyo.mainY) ? tempPuyo.mainColor : tempPuyo.subColor;
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
            if (originalColor === COLORS.EMPTY && puyoColors.includes(tempColor) && puyoCount < 2) {
                ghostPositions.push({ x, y, color: tempColor });
                puyoCount++;
            }
        }
    }

    // 隠し行（上 HIDDEN_ROWS 行）を除外して返す
    return ghostPositions.filter(p => p.y < HEIGHT - HIDDEN_ROWS);
}

// 衝突判定（境界チェックを HIDDEN_ROWS と統一）
function checkCollision(coords) {
    for (const puyo of coords) {
        if (puyo.x < 0 || puyo.x >= WIDTH || puyo.y < 0) return true;
        // 上部 HIDDEN_ROWS 行（y >= HEIGHT - HIDDEN_ROWS）は board の占有判定をスキップ
        if (puyo.y < HEIGHT - HIDDEN_ROWS && board[puyo.y][puyo.x] !== COLORS.EMPTY) return true;
    }
    return false;
}

// 移動（成功なら true）
function movePuyo(dx, dy, newRotation, shouldRender = true) {
    if (gameState !== 'playing' || !currentPuyo) return false;
    const { mainX, mainY, rotation } = currentPuyo;
    const test = { mainX: mainX + dx, mainY: mainY + dy, rotation: newRotation !== undefined ? newRotation : rotation };
    const testCoords = getCoordsFromState(test);
    if (!checkCollision(testCoords)) {
        currentPuyo.mainX = test.mainX;
        currentPuyo.mainY = test.mainY;
        if (newRotation !== undefined) currentPuyo.rotation = newRotation;
        if (shouldRender) renderBoard();
        return true;
    }
    return false;
}

// 回転（CW / CCW） — 簡易ウォールキック + クイックターン
window.rotatePuyoCW = function() {
    if (gameState !== 'playing' || !currentPuyo) return false;
    if (autoDropEnabled && dropTimer) { clearInterval(dropTimer); startPuyoDropLoop(); }

    const newRotation = (currentPuyo.rotation + 1) % 4;
    const oldRotation = currentPuyo.rotation;
    let rotationSuccess = movePuyo(0, 0, newRotation);
    if (!rotationSuccess) {
        if (oldRotation === 0 || oldRotation === 2) {
            if (newRotation === 1) {
                rotationSuccess = movePuyo(1, 0, newRotation) || movePuyo(0, 1, newRotation);
            } else if (newRotation === 3) {
                rotationSuccess = movePuyo(-1, 0, newRotation) || movePuyo(0, 1, newRotation);
            }
        } else {
            rotationSuccess = movePuyo(0, 1, newRotation);
        }
    }

    if (rotationSuccess) {
        lastFailedRotation.type = null;
        return true;
    }

    const now = Date.now();
    if (lastFailedRotation.type === 'CW' && (now - lastFailedRotation.timestamp) < QUICK_TURN_WINDOW) {
        [currentPuyo.mainColor, currentPuyo.subColor] = [currentPuyo.subColor, currentPuyo.mainColor];
        lastFailedRotation.type = null;
        renderBoard();
        return true;
    }

    lastFailedRotation.type = 'CW';
    lastFailedRotation.timestamp = now;
    return false;
};

window.rotatePuyoCCW = function() {
    if (gameState !== 'playing' || !currentPuyo) return false;
    if (autoDropEnabled && dropTimer) { clearInterval(dropTimer); startPuyoDropLoop(); }

    const newRotation = (currentPuyo.rotation - 1 + 4) % 4;
    const oldRotation = currentPuyo.rotation;
    let rotationSuccess = movePuyo(0, 0, newRotation);

    if (!rotationSuccess) {
        if (oldRotation === 0 || oldRotation === 2) {
            if (newRotation === 1) {
                rotationSuccess = movePuyo(1, 0, newRotation) || movePuyo(0, 1, newRotation);
            } else if (newRotation === 3) {
                rotationSuccess = movePuyo(-1, 0, newRotation) || movePuyo(0, 1, newRotation);
            }
        } else {
            rotationSuccess = movePuyo(0, 1, newRotation);
        }
    }

    if (rotationSuccess) {
        lastFailedRotation.type = null;
        return true;
    }

    const now = Date.now();
    if (lastFailedRotation.type === 'CCW' && (now - lastFailedRotation.timestamp) < QUICK_TURN_WINDOW) {
        [currentPuyo.mainColor, currentPuyo.subColor] = [currentPuyo.subColor, currentPuyo.mainColor];
        lastFailedRotation.type = null;
        renderBoard();
        return true;
    }

    lastFailedRotation.type = 'CCW';
    lastFailedRotation.timestamp = now;
    return false;
};

// ハードドロップ（即固定）
function hardDrop() {
    if (gameState !== 'playing' || !currentPuyo) return;
    clearInterval(dropTimer);
    while (movePuyo(0, -1, undefined, false)) { /* drop until cannot */ }
    renderBoard();
    lockPuyo();
}

// lockPuyo: 設置 -> gravity -> 上端行クリア -> 連鎖開始（設置直後の履歴保存は削除）
function lockPuyo() {
    if (gameState !== 'playing' || !currentPuyo) return;
    const coords = getPuyoCoords();
    coords.forEach(p => {
        if (p.y >= 0 && p.y < HEIGHT && p.x >= 0 && p.x < WIDTH) {
            board[p.y][p.x] = p.color;
        }
    });

    currentPuyo = null;

    // 自由落下（設置後に重力を適用）
    gravity();

    // 最上端行をクリア（既存仕様に合わせる）
    for (let x = 0; x < WIDTH; x++) {
        board[HEIGHT - 1][x] = COLORS.EMPTY;
    }

    renderBoard();
    updateUI();

    // NOTE: 設置直後の履歴保存は削除（B方式：連鎖終了時のみ保存）

    // 連鎖判定へ
    gameState = 'chaining';
    chainCount = 0;
    runChain();
}

// ---------- 連結検出（上部 HIDDEN_ROWS を除外） ----------
function findConnectedPuyos() {
    // 探索の対象は y = 0 .. (HEIGHT - HIDDEN_ROWS - 1)
    const MAX_SEARCH_Y = HEIGHT - HIDDEN_ROWS;
    let visited = Array(HEIGHT).fill(0).map(() => Array(WIDTH).fill(false));
    let groups = [];

    for (let y = 0; y < MAX_SEARCH_Y; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const color = board[y][x];
            if (color === COLORS.EMPTY || color === COLORS.GARBAGE || visited[y][x]) continue;

            let stack = [{ x, y }];
            visited[y][x] = true;
            let group = [];

            while (stack.length > 0) {
                const cur = stack.pop();
                group.push(cur);

                [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx,dy]) => {
                    const nx = cur.x + dx;
                    const ny = cur.y + dy;
                    if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < MAX_SEARCH_Y &&
                        !visited[ny][nx] && board[ny][nx] === color) {
                        visited[ny][nx] = true;
                        stack.push({ x: nx, y: ny });
                    }
                });
            }

            if (group.length >= 4) groups.push({ group, color });
        }
    }

    return groups;
}

// おじゃま消去（消した色に隣接するゴミを消す）
function clearGarbagePuyos(erasedCoords) {
    let clearedCount = 0;
    const garbageToClear = new Set();
    erasedCoords.forEach(({ x, y }) => {
        [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx,dy]) => {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT) {
                if (board[ny][nx] === COLORS.GARBAGE) {
                    garbageToClear.add(`${nx}-${ny}`);
                }
            }
        });
    });

    garbageToClear.forEach(k => {
        const [nx, ny] = k.split('-').map(Number);
        board[ny][nx] = COLORS.EMPTY;
        clearedCount++;
    });
    return clearedCount;
}

// 連鎖処理（async）
// - 連鎖終了時に履歴を保存（saveState()）
async function runChain() {
    // reset abort flag for this run
    chainAbortFlag = false;

    // 1) まず重力をかけて安定化
    gravity();
    renderBoard();

    // 2) 連結を検出
    const groups = findConnectedPuyos();

    if (groups.length === 0) {
        // 0連鎖時: 全消しボーナス
        if (checkBoardEmpty()) {
            score += 3600;
            updateUI();
        }

        // 新仕様: ゲームオーバー判定は spawn チェックとは別に、Y=HEIGHT-3 の中央列で判定
        const gameOverLineY = HEIGHT - 3;
        const checkX = 2;
        const isGameOver = board[gameOverLineY][checkX] !== COLORS.EMPTY;
        if (isGameOver) {
            gameState = 'gameover';
            alert('ゲームオーバーです！');
            clearInterval(dropTimer);
            updateUI();
            renderBoard();
            return;
        }

        // 操作可能に戻す
        gameState = 'playing';
        // NOTE: currentPuyo が null の場合 generateNewPuyo() が投入される。
        // これにより Edit→Play 直後の Next1 が currentPuyo になる。
        if (!currentPuyo) {
            ensureNextQueueCapacity();
            generateNewPuyo();
        }
        startPuyoDropLoop();
        checkMobileControlsVisibility();
        renderBoard();

        // 0連鎖も「1手の終了」なので、最終盤面を履歴として保存する
        saveState(true);

        return;
    }

    // 3) 連鎖発生: 着地からの待ち時間
    await sleep(chainWaitTime);
    if (chainAbortFlag) return;

    // 4) 消滅処理
    chainCount++;
    let chainScore = calculateScore(groups, chainCount);
    score += chainScore;

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

    // 5) 消滅後の待機（重力待ち）
    await sleep(gravityWaitTime);
    if (chainAbortFlag) return;

    // 6) 次段へ（重力・再判定）
    gravity();
    renderBoard();

    const nextGroups = findConnectedPuyos();
    if (nextGroups.length === 0) {
        // 連鎖終了
        gameState = 'playing';
        // currentPuyo が null の場合にのみ新規投入（これを守ることで履歴復元時の不整合を防ぐ）
        if (!currentPuyo) {
            ensureNextQueueCapacity();
            generateNewPuyo();
        }
        startPuyoDropLoop();
        checkMobileControlsVisibility();
        renderBoard();

        // 連鎖が終わった最終盤面を保存（ここで保存） — 1手 = 1履歴
        saveState(true);
    } else {
        // 続ける（await して順序を保証）
        await runChain();
    }
}

// スコア計算
function calculateScore(groups, currentChain) {
    let totalPuyos = 0;
    let colorSet = new Set();
    let bonusTotal = 0;

    groups.forEach(({ group, color }) => {
        totalPuyos += group.length;
        colorSet.add(color);
        const idx = Math.min(group.length, BONUS_TABLE.GROUP.length - 1);
        bonusTotal += BONUS_TABLE.GROUP[idx];
    });

    const chainIdx = Math.min(currentChain, BONUS_TABLE.CHAIN.length - 1);
    bonusTotal += BONUS_TABLE.CHAIN[chainIdx];

    const colorIdx = Math.min(colorSet.size, BONUS_TABLE.COLOR.length - 1);
    bonusTotal += BONUS_TABLE.COLOR[colorIdx];

    const finalBonus = Math.max(1, bonusTotal);
    const totalScore = (10 * totalPuyos) * finalBonus;
    return totalScore;
}

// 重力（各列を詰める）
function simulateGravity(targetBoard) {
    for (let x = 0; x < WIDTH; x++) {
        let newCol = [];
        for (let y = 0; y < HEIGHT; y++) {
            if (targetBoard[y][x] !== COLORS.EMPTY) newCol.push(targetBoard[y][x]);
        }
        for (let y = 0; y < HEIGHT; y++) {
            targetBoard[y][x] = y < newCol.length ? newCol[y] : COLORS.EMPTY;
        }
    }
}

function gravity() {
    simulateGravity(board);
}

// 盤面が空かチェック
function checkBoardEmpty() {
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            if (board[y][x] !== COLORS.EMPTY) return false;
        }
    }
    return true;
}

// ---------- 入力処理 ----------
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
            if (autoDropEnabled) startPuyoDropLoop();
            break;
        case ' ':
            event.preventDefault();
            hardDrop();
            break;
    }
}

// ---------- エディット用 NEXT 表示 ----------
function renderEditNextPuyos() {
    const listContainer = document.getElementById('edit-next-list-container');
    const visibleSlots = [document.getElementById('edit-next-1'), document.getElementById('edit-next-2')];
    if (!listContainer || !visibleSlots[0] || !visibleSlots[1]) return;

    const createEditablePuyo = (color, listIndex, puyoIndex) => {
        let puyo = document.createElement('div');
        puyo.className = `puyo puyo-${color}`;
        puyo.addEventListener('pointerdown', (ev) => {
            ev.stopPropagation();
            if (gameState !== 'editing') return;
            if (editingNextPuyos.length > listIndex) {
                // puyoIndex: 0 = main(下), 1 = sub(上)
                editingNextPuyos[listIndex][puyoIndex] = currentEditColor;
                renderEditNextPuyos();
            }
        });
        return puyo;
    };

    // ----- visible slots (NEXT1, NEXT2) -----
    visibleSlots.forEach((slot, idx) => {
        slot.innerHTML = '';

        if (editingNextPuyos.length > idx) {
            // ペアは [sub, main]（index 0 = sub / 上、index 1 = main / 下）
            const [c_main, c_sub] = editingNextPuyos[idx];
            
            slot.appendChild(createEditablePuyo(c_sub, idx, 1)); // 上
            slot.appendChild(createEditablePuyo(c_main, idx, 0)); // 下
        }
    });

    // ----- full list -----
    listContainer.innerHTML = '';
    for (let i = NUM_VISIBLE_NEXT_PUYOS; i < MAX_NEXT_PUYOS; i++) {
        if (editingNextPuyos.length <= i) break;
        const pairContainer = document.createElement('div');
        pairContainer.className = 'next-puyo-slot-pair';
        const countSpan = document.createElement('span');
        countSpan.textContent = `N${i + 1}`;
        pairContainer.appendChild(countSpan);
        const puyoRow = document.createElement('div');
        puyoRow.className = 'next-puyo-row';
        const [c_sub, c_main] = editingNextPuyos[i]; // fixed: [sub, main]
        puyoRow.appendChild(createEditablePuyo(c_sub, i, 1)); // 上 (sub)
        puyoRow.appendChild(createEditablePuyo(c_main, i, 0)); // 下 (main)
        pairContainer.appendChild(puyoRow);
        listContainer.appendChild(pairContainer);
    }
}

// ---------- モバイル表示 / モード切替 ----------
function checkMobileControlsVisibility() {
    const mobileControls = document.getElementById('mobile-controls');
    if (!mobileControls) return;
    if ((gameState === 'playing' || gameState === 'gameover') && window.innerWidth <= 650) {
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

let previousGameState = 'playing';
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

window.toggleMode = function() {
    const infoPanel = document.getElementById('info-panel');
    const modeToggleButton = document.querySelector('.mode-toggle-btn');
    const boardElement = document.getElementById('puyo-board');

    if (gameState === 'playing' || gameState === 'gameover') {
        // -> editing
        clearInterval(dropTimer);
        gameState = 'editing';
        if (infoPanel) infoPanel.classList.add('edit-mode-active');
        document.body.classList.add('edit-mode-active');
        if (modeToggleButton) modeToggleButton.textContent = 'play';
        checkMobileControlsVisibility();
        if (boardElement) boardElement.addEventListener('click', handleBoardClickEditMode);
        selectPaletteColor(COLORS.EMPTY);
        renderEditNextPuyos();
        renderBoard();
    } else if (gameState === 'editing') {
        // -> playing: ユーザー要求により、play に戻るときは Next1 を操作ぷよにしたい
        gameState = 'playing';
        if (infoPanel) infoPanel.classList.remove('edit-mode-active');
        document.body.classList.remove('edit-mode-active');
        if (modeToggleButton) modeToggleButton.textContent = 'edit';
        checkMobileControlsVisibility();
        if (boardElement) boardElement.removeEventListener('click', handleBoardClickEditMode);

        // ここで currentPuyo を Next1 に「差し替える」
        // applyNextPuyos() が呼ばれて nextQueue が編集済みで queueIndex==0 の想定
        // 安全に動かすため currentPuyo を null にして generateNewPuyo() に委ねる
        currentPuyo = null;
        ensureNextQueueCapacity();
        generateNewPuyo();

        if (autoDropEnabled) startPuyoDropLoop();
        renderBoard();
    }
};

// 速度設定 UI
window.updateGravityWait = function(value) {
    gravityWaitTime = parseInt(value);
    const display = document.getElementById('gravity-wait-value');
    if (display) display.textContent = gravityWaitTime + 'ms';
};
window.updateChainWait = function(value) {
    chainWaitTime = parseInt(value);
    const display = document.getElementById('chain-wait-value');
    if (display) display.textContent = chainWaitTime + 'ms';
};

// 自動落下の切替
window.toggleAutoDrop = function() {
    const button = document.getElementById('auto-drop-toggle-button');
    if (!button) return;
    autoDropEnabled = !autoDropEnabled;
    if (autoDropEnabled) {
        button.textContent = '自動落下: ON';
        button.classList.remove('disabled');
        if (gameState === 'playing') startPuyoDropLoop();
    } else {
        button.textContent = '自動落下: OFF';
        button.classList.add('disabled');
        if (dropTimer) clearInterval(dropTimer);
    }
};

// リセット
window.resetGame = function() {
    clearInterval(dropTimer);
    initializeGame();
};

// ---------- ユーティリティ / その他 ----------
// getDropY（指定列の落下先 y を返す）: y が見えない領域に行くと HEIGHT-1 を返さないよう調整
function getDropY(x, startY = 0) {
    if (x < 0 || x >= WIDTH) return -1;
    let y = Math.max(0, startY);
    while (y < HEIGHT && board[y][x] !== COLORS.EMPTY) y++;
    return y < HEIGHT ? y : HEIGHT - 1;
}

// raisePuyoOneRow（デバッグ用）: 境界チェックを HIDDEN_ROWS で統一
(function() {
    'use strict';
    try {
        window.raisePuyoOneRow = function() {
            try {
                if (typeof gameState === 'undefined') { alert('エラー: gameState が取得できません'); return; }
                if (gameState !== 'playing') { alert('プレイ中のみ使用できます。'); return; }
                if (typeof currentPuyo === 'undefined' || !currentPuyo) { alert('操作中のぷよがありません。'); return; }

                const mainX = currentPuyo.mainX;
                const mainY = currentPuyo.mainY;
                const rotation = currentPuyo.rotation;
                let subX = mainX;
                let subY = mainY;
                if (rotation === 0) subY = mainY + 1;
                else if (rotation === 1) subX = mainX - 1;
                else if (rotation === 2) subY = mainY - 1;
                else if (rotation === 3) subX = mainX + 1;

                const newMainY = mainY + 1;
                const newSubY = subY + 1;

                // 範囲超過判定（HEIGHT を基準）
                if (newMainY >= HEIGHT || newSubY >= HEIGHT) {
                    alert('これ以上上に移動できません。');
                    return;
                }

                let canMove = true;

                // board の占有判定は可視領域（y < HEIGHT - HIDDEN_ROWS）に対して実施
                if (newMainY < HEIGHT - HIDDEN_ROWS) {
                    if (board[newMainY][mainX] !== COLORS.EMPTY) canMove = false;
                }
                if (newSubY < HEIGHT - HIDDEN_ROWS) {
                    if (board[newSubY][subX] !== COLORS.EMPTY) canMove = false;
                }

                if (!canMove) { alert('移動先にぷよがあるため、上に移動できません。'); return; }

                currentPuyo.mainY = newMainY;
                if (typeof renderBoard === 'function') renderBoard();
            } catch (e) {
                console.error('raisePuyoOneRow error:', e);
                alert('エラーが発生しました: ' + e.message);
            }
        };

        // キーバインド: u キーで発火（既存の undo のショートカットと競合するので注意）
        document.addEventListener('keydown', function(e) {
            try {
                if (typeof gameState !== 'undefined' && gameState === 'playing' && e.key === 'u') {
                    window.raisePuyoOneRow();
                }
            } catch (err) {
                console.error('キーイベントエラー:', err);
            }
        });

    } catch (e) {
        console.error('raisePuyoOneRow init error:', e);
    }
})();

// 初期化
document.addEventListener('DOMContentLoaded', () => {
    initializeGame();
    window.addEventListener('resize', checkMobileControlsVisibility);
});