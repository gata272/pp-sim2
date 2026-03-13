// シュミレーションシステム

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
        const expectedLength = WIDTH * HEIGHT + NUM_VISIBLE_NEXT_PUYOS * 2;
        if (dataArray.length < expectedLength) {
            alert("ステージコードが短すぎます。盤面とNEXTぷよの情報が不足しています。");
            return;
        }

        // 盤面を復元
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                board[y][x] = dataArray.shift();
            }
        }

        // NEXT ぷよを復元
        editingNextPuyos = [];
        for (let i = 0; i < NUM_VISIBLE_NEXT_PUYOS; i++) {
            const sub = dataArray.shift();
            const main = dataArray.shift();
            if (sub !== undefined && main !== undefined) {
                editingNextPuyos.push([sub, main]);
            } else {
                // データが足りない場合はランダムで補充
                editingNextPuyos.push(getRandomPair());
            }
        }
        nextEdited = true;

        renderBoard();
        renderEditNextPuyos();
        alert('ステージコードを読み込みました！');
    } catch (e) {
        alert('ステージコードの読み込みに失敗しました。形式が正しくない可能性があります。' + e.message);
        console.error(e);
    }
};

// ---------- ゲームロジック ----------
function initBoard() {
    board = [];
    for (let y = 0; y < HEIGHT; y++) {
        board.push(Array(WIDTH).fill(COLORS.EMPTY));
    }
}

function getRandomColor() {
    return Math.floor(Math.random() * 4) + 1; // 1-4 (赤、青、緑、黄)
}

function getRandomPair() {
    return [getRandomColor(), getRandomColor()];
}

window.generateNewPuyo = function() {
    currentPuyo = {
        x: Math.floor(WIDTH / 2) - 1,
        y: HEIGHT - HIDDEN_ROWS - 1, // 隠し行のすぐ下からスタート
        mainColor: null,
        subColor: null,
        rotation: 0 // 0:縦、1:右横、2:縦逆、3:左横
    };

    const nextPair = consumeNextPair();
    currentPuyo.subColor = nextPair[0]; // 上
    currentPuyo.mainColor = nextPair[1]; // 下

    // ゲームオーバー判定
    // ぷよが初期位置に配置できない場合
    if (board[currentPuyo.y][currentPuyo.x] !== COLORS.EMPTY ||
        board[currentPuyo.y + 1][currentPuyo.x] !== COLORS.EMPTY) {
        gameState = 'gameover';
        stopPuyoDropLoop()        if (window.isMatchActive) {
            console.log(\'オンライン対戦中のゲームオーバーを検知しました。\');
            if (typeof window.notifyGameOverToOpponent === \'function\') {
                window.notifyGameOverToOpponent();
            }
        } else {
            alert(\'ゲームオーバーです！\');
        }
        return false;
    }
    renderBoard();
    return true;
}

function getPuyoCoords(puyo = currentPuyo) {
    if (!puyo) return [];
    const coords = [];
    // mainPuyo
    coords.push({ x: puyo.x, y: puyo.y, color: puyo.mainColor });

    // subPuyo
    switch (puyo.rotation) {
        case 0: // 縦 (subが上)
            coords.push({ x: puyo.x, y: puyo.y + 1, color: puyo.subColor });
            break;
        case 1: // 右横 (subが右)
            coords.push({ x: puyo.x + 1, y: puyo.y, color: puyo.subColor });
            break;
        case 2: // 縦逆 (subが下)
            coords.push({ x: puyo.x, y: puyo.y - 1, color: puyo.subColor });
            break;
        case 3: // 左横 (subが左)
            coords.push({ x: puyo.x - 1, y: puyo.y, color: puyo.subColor });
            break;
    }
    return coords;
}

function isValidMove(newX, newY, newRotation) {
    const testPuyo = {
        x: newX,
        y: newY,
        mainColor: currentPuyo.mainColor,
        subColor: currentPuyo.subColor,
        rotation: newRotation
    };
    const coords = getPuyoCoords(testPuyo);

    for (const p of coords) {
        // 盤面外チェック
        if (p.x < 0 || p.x >= WIDTH || p.y < 0 || p.y >= HEIGHT) {
            return false;
        }
        // 他のぷよとの衝突チェック (ただし、移動元・回転元の currentPuyo 自身とは衝突しない)
        // currentPuyo の座標はまだ board には反映されていないので、単純に board の値を見る
        if (board[p.y][p.x] !== COLORS.EMPTY) {
            return false;
        }
    }
    return true;
}

function movePuyo(dx, dy) {
    if (gameState !== 'playing' || !currentPuyo) return false;
    const newX = currentPuyo.x + dx;
    const newY = currentPuyo.y + dy;
    if (isValidMove(newX, newY, currentPuyo.rotation)) {
        currentPuyo.x = newX;
        currentPuyo.y = newY;
        renderBoard();
        return true;
    }
    return false;
}

function rotatePuyo() {
    if (gameState !== 'playing' || !currentPuyo) return;

    const originalRotation = currentPuyo.rotation;
    let newRotation = (currentPuyo.rotation + 1) % 4;

    // 回転後の位置を試す
    if (isValidMove(currentPuyo.x, currentPuyo.y, newRotation)) {
        currentPuyo.rotation = newRotation;
        lastFailedRotation = { type: null, timestamp: 0 }; // 成功したのでリセット
    } else {
        // 壁際での回転補正（クイックターン）
        // 右壁際
        if (currentPuyo.x === WIDTH - 1) {
            if (isValidMove(currentPuyo.x - 1, currentPuyo.y, newRotation)) {
                currentPuyo.x--;
                currentPuyo.rotation = newRotation;
                lastFailedRotation = { type: null, timestamp: 0 };
            }
        }
        // 左壁際
        else if (currentPuyo.x === 0) {
            if (isValidMove(currentPuyo.x + 1, currentPuyo.y, newRotation)) {
                currentPuyo.x++;
                currentPuyo.rotation = newRotation;
                lastFailedRotation = { type: null, timestamp: 0 };
            }
        }
    }

    // クイックターン判定
    if (originalRotation === currentPuyo.rotation) { // 回転できなかった場合
        const now = Date.now();
        if (lastFailedRotation.type === 'rotate' && (now - lastFailedRotation.timestamp < QUICK_TURN_WINDOW)) {
            // 連続して回転失敗した場合、クイックターンを試みる
            // 左右反転回転を試す
            newRotation = (originalRotation + 3) % 4; // 反時計回りに回転
            if (isValidMove(currentPuyo.x, currentPuyo.y, newRotation)) {
                currentPuyo.rotation = newRotation;
                lastFailedRotation = { type: null, timestamp: 0 };
            } else {
                // 左右反転も失敗したら、左右にずらして試す
                if (isValidMove(currentPuyo.x - 1, currentPuyo.y, newRotation)) {
                    currentPuyo.x--;
                    currentPuyo.rotation = newRotation;
                    lastFailedRotation = { type: null, timestamp: 0 };
                } else if (isValidMove(currentPuyo.x + 1, currentPuyo.y, newRotation)) {
                    currentPuyo.x++;
                    currentPuyo.rotation = newRotation;
                    lastFailedRotation = { type: null, timestamp: 0 };
                }
            }
        }
        lastFailedRotation = { type: 'rotate', timestamp: now };
    }

    renderBoard();
}

function getGhostFinalPositions() {
    if (!currentPuyo) return [];
    let ghostY = currentPuyo.y;
    while (isValidMove(currentPuyo.x, ghostY - 1, currentPuyo.rotation)) {
        ghostY--;
    }
    const ghostPuyo = { ...currentPuyo, y: ghostY };
    return getPuyoCoords(ghostPuyo);
}

function hardDrop() {
    if (gameState !== 'playing' || !currentPuyo) return;
    stopPuyoDropLoop();
    let dropped = false;
    while (movePuyo(0, -1)) {
        dropped = true;
    }
    if (dropped) {
        placePuyo();
    }
}

function softDrop() {
    if (gameState !== 'playing' || !currentPuyo) return;
    movePuyo(0, -1);
}

function placePuyo() {
    if (!currentPuyo) return;
    const coords = getPuyoCoords();
    for (const p of coords) {
        board[p.y][p.x] = p.color;
    }
    currentPuyo = null;
    saveHistory();
    startChainProcess();
}

window.startPuyoDropLoop = function() {
    if (dropTimer) clearInterval(dropTimer);
    dropTimer = setInterval(() => {
        if (gameState === 'playing' && autoDropEnabled) {
            if (!movePuyo(0, -1)) {
                placePuyo();
                if (gameState === 'playing') { // ゲームオーバーでなければ次を生成
                    generateNewPuyo();
                }
            }
        }
    }, dropInterval);
}

function stopPuyoDropLoop() {
    if (dropTimer) {
        clearInterval(dropTimer);
        dropTimer = null;
    }
}

function toggleAutoDrop() {
    autoDropEnabled = !autoDropEnabled;
    const button = document.getElementById('auto-drop-toggle-button');
    if (button) {
        button.textContent = '自動落下: ' + (autoDropEnabled ? 'ON' : 'OFF');
    }
    if (autoDropEnabled) {
        startPuyoDropLoop();
    } else {
        stopPuyoDropLoop();
    }
}

// ---------- 連鎖処理 ----------
async function startChainProcess() {
    gameState = 'chaining';
    chainCount = 0;
    score = 0; // 各連鎖開始時にスコアをリセット
    stopPuyoDropLoop(); // 落下を停止
    chainAbortFlag = false; // フラグをリセット

    while (true) {
        if (chainAbortFlag) break; // 中断フラグが立ったらループを抜ける

        renderBoard(); // 状態を反映
        await sleep(gravityWaitTime); // 重力落下待ち
        if (chainAbortFlag) break;

        let puyosFallen = applyGravity();
        if (puyosFallen) {
            renderBoard();
            await sleep(gravityWaitTime); // 落下アニメーション待ち
            if (chainAbortFlag) break;
        }

        const { removedPuyos, chainBonus, colorBonus, groupBonus } = findAndRemoveChains();

        if (removedPuyos.length > 0) {
            chainCount++;
            const currentChainScore = calculateScore(chainBonus, colorBonus, groupBonus, removedPuyos.length);
            score += currentChainScore;
            updateUI();
            renderBoard(); // 消滅を反映
            await sleep(chainWaitTime); // 消滅アニメーション待ち
            if (chainAbortFlag) break;
        } else {
            break; // 連鎖終了
        }
    }

    gameState = 'playing';
    if (gameState === 'playing') { // ゲームオーバーでなければ次を生成
        generateNewPuyo();
    }
    startPuyoDropLoop(); // 落下を再開
    updateUI();
}

function applyGravity() {
    let puyosFallen = false;
    for (let x = 0; x < WIDTH; x++) {
        let emptyCount = 0;
        for (let y = 0; y < HEIGHT; y++) {
            if (board[y][x] === COLORS.EMPTY) {
                emptyCount++;
            } else if (emptyCount > 0) {
                board[y - emptyCount][x] = board[y][x];
                board[y][x] = COLORS.EMPTY;
                puyosFallen = true;
            }
        }
    }
    return puyosFallen;
}

function findAndRemoveChains() {
    let removedPuyos = [];
    let visited = Array(HEIGHT).fill(0).map(() => Array(WIDTH).fill(false));
    let currentChainColors = new Set();

    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const color = board[y][x];
            if (color !== COLORS.EMPTY && color !== COLORS.GARBAGE && !visited[y][x]) {
                let group = [];
                dfs(x, y, color, group, visited);

                if (group.length >= 4) {
                    removedPuyos.push(...group);
                    currentChainColors.add(color);
                }
            }
        }
    }

    // おじゃまぷよの処理
    let garbageRemoved = 0;
    if (removedPuyos.length > 0) {
        for (const p of removedPuyos) {
            board[p.y][p.x] = COLORS.EMPTY;
        }
        // 消えたぷよの周囲のおじゃまぷよを消す
        const affectedGarbage = new Set();
        for (const p of removedPuyos) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = p.x + dx;
                    const ny = p.y + dy;
                    if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT && board[ny][nx] === COLORS.GARBAGE) {
                        affectedGarbage.add(`${nx},${ny}`);
                    }
                }
            }
        }
        for (const coordStr of affectedGarbage) {
            const [x, y] = coordStr.split(',').map(Number);
            board[y][x] = COLORS.EMPTY;
            garbageRemoved++;
        }
    }

    const chainBonus = BONUS_TABLE.CHAIN[chainCount] || 0;
    const colorBonus = BONUS_TABLE.COLOR[currentChainColors.size] || 0;
    const groupBonus = BONUS_TABLE.GROUP[removedPuyos.length] || 0;

    return { removedPuyos, chainBonus, colorBonus, groupBonus };
}

function dfs(x, y, color, group, visited) {
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT || visited[y][x] || board[y][x] !== color) {
        return;
    }
    visited[y][x] = true;
    group.push({ x, y, color });

    dfs(x + 1, y, color, group, visited);
    dfs(x - 1, y, color, group, visited);
    dfs(x, y + 1, color, group, visited);
    dfs(x, y - 1, color, group, visited);
}

function calculateScore(chainBonus, colorBonus, groupBonus, numRemoved) {
    const bonus = Math.max(1, chainBonus + colorBonus + groupBonus);
    return numRemoved * 10 * bonus;
}

// ---------- 履歴管理 (Undo/Redo) ----------
function saveHistory() {
    // 現在の状態を保存
    const historyEntry = {
        board: copyBoard(board),
        currentPuyo: currentPuyo ? { ...currentPuyo } : null,
        nextQueue: copyNextQueue(nextQueue),
        queueIndex: queueIndex,
        score: score,
        chainCount: chainCount,
        gameState: gameState,
        editingNextPuyos: copyNextQueue(editingNextPuyos),
        nextEdited: nextEdited
    };
    historyStack.push(historyEntry);
    // 履歴が上限を超えたら古いものを削除
    if (historyStack.length > MAX_HISTORY_SIZE) {
        historyStack.shift();
    }
    // 新しい履歴が追加されたらredoスタックはクリア
    redoStack = [];
    updateHistoryButtons();
}

function restoreHistory(entry) {
    board = copyBoard(entry.board);
    currentPuyo = entry.currentPuyo ? { ...entry.currentPuyo } : null;
    nextQueue = copyNextQueue(entry.nextQueue);
    queueIndex = entry.queueIndex;
    score = entry.score;
    chainCount = entry.chainCount;
    gameState = entry.gameState;
    editingNextPuyos = copyNextQueue(entry.editingNextPuyos);
    nextEdited = entry.nextEdited;
    renderBoard();
    updateUI();
}

function undoMove() {
    if (historyStack.length > 1) { // 少なくとも現在の状態と一つ前の状態が必要
        const currentState = historyStack.pop();
        redoStack.push(currentState);
        const previousState = historyStack[historyStack.length - 1];
        restoreHistory(previousState);
        stopPuyoDropLoop(); // 落下を停止
        stopChain(); // 連鎖を中断
    }
    updateHistoryButtons();
}

function redoMove() {
    if (redoStack.length > 0) {
        const nextState = redoStack.pop();
        historyStack.push(nextState);
        restoreHistory(nextState);
        stopPuyoDropLoop(); // 落下を停止
        stopChain(); // 連鎖を中断
    }
    updateHistoryButtons();
}

function updateHistoryButtons() {
    const undoButton = document.getElementById('undo-button');
    const redoButton = document.getElementById('redo-button');
    if (undoButton) undoButton.disabled = historyStack.length <= 1;
    if (redoButton) redoButton.disabled = redoStack.length === 0;
}

// ---------- モード切り替え ----------
function toggleMode() {
    const playContainer = document.getElementById('play-info-container');
    const editContainer = document.getElementById('edit-info-container');
    const mobileControls = document.getElementById('mobile-controls');

    if (gameState === 'playing' || gameState === 'chaining' || gameState === 'gameover') {
        // プレイモードからエディットモードへ
        gameState = 'editing';
        stopPuyoDropLoop();
        stopChain();
        playContainer.style.display = 'none';
        editContainer.style.display = 'flex';
        if (mobileControls) mobileControls.style.display = 'none';
        renderEditNextPuyos();
    } else if (gameState === 'editing') {
        // エディットモードからプレイモードへ
        gameState = 'playing';
        playContainer.style.display = 'flex';
        editContainer.style.display = 'none';
        checkMobileControlsVisibility(); // モバイルコントロールの表示を更新
        // エディットモードでNEXTを編集していた場合、それを反映
        if (nextEdited) {
            nextQueue = [];
            queueIndex = 0;
            editingNextPuyos.forEach(pair => nextQueue.push(pair));
            // 残りのNEXTはランダムで補充
            ensureNextQueueCapacity();
            nextEdited = false;
        } else {
            // 編集していなければ初期化
            generateInitialNextQueue();
        }
        window.initializeGame(); // ゲームを初期化して新しいぷよを生成
    }
    renderBoard();
    updateUI();
}

// ---------- エディットモード関連 ----------
function handleBoardClick(event) {
    if (gameState !== 'editing') return;

    const boardElement = document.getElementById('puyo-board');
    const rect = boardElement.getBoundingClientRect();
    const cellSize = rect.width / WIDTH;

    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    const x = Math.floor(clickX / cellSize);
    const y = HEIGHT - 1 - Math.floor(clickY / cellSize); // DOMのy座標は上から下、盤面は下から上

    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) {
        board[y][x] = currentEditColor;
        renderBoard();
    }
}

function setupPalette() {
    const palette = document.getElementById('color-palette');
    if (!palette) return;
    palette.addEventListener('click', (event) => {
        let target = event.target;
        while (target && !target.classList.contains('palette-color')) {
            target = target.parentNode;
        }
        if (target) {
            const color = parseInt(target.getAttribute('data-color'));
            currentEditColor = color;
            // 現在選択中の色をハイライト表示
            document.querySelectorAll('.palette-color').forEach(p => p.classList.remove('selected'));
            target.classList.add('selected');
        }
    });
    // 初期選択
    const initialColorElement = palette.querySelector('.puyo-1');
    if (initialColorElement) {
        initialColorElement.classList.add('selected');
        currentEditColor = COLORS.RED;
    }
}

function renderEditNextPuyos() {
    const editNext1Element = document.getElementById('edit-next-1');
    const editNext2Element = document.getElementById('edit-next-2');
    const editNextListContainer = document.getElementById('edit-next-list-container');
    if (!editNext1Element || !editNext2Element || !editNextListContainer) return;

    const createPuyo = (color) => {
        const el = document.createElement('div');
        el.className = 'puyo puyo-' + color;
        return el;
    };

    // 編集中のNEXT1とNEXT2を表示
    const pairs = [
        editingNextPuyos[0] || [COLORS.EMPTY, COLORS.EMPTY],
        editingNextPuyos[1] || [COLORS.EMPTY, COLORS.EMPTY]
    ];

    [editNext1Element, editNext2Element].forEach((slot, idx) => {
        slot.innerHTML = '';
        const pair = pairs[idx];
        if (pair) {
            slot.appendChild(createPuyo(pair[1])); // main (bottom)
            slot.appendChild(createPuyo(pair[0])); // sub (top)
        }
    });

    // 編集用NEXTリストを表示
    editNextListContainer.innerHTML = '';
    for (let i = 0; i < editingNextPuyos.length; i++) {
        const item = document.createElement('div');
        item.className = 'edit-next-item';
        item.innerHTML = `<span class="edit-next-label">NEXT ${i + 1}:</span>`;
        const puyosDiv = document.createElement('div');
        puyosDiv.className = 'edit-next-puyos';
        puyosDiv.appendChild(createPuyo(editingNextPuyos[i][1]));
        puyosDiv.appendChild(createPuyo(editingNextPuyos[i][0]));
        item.appendChild(puyosDiv);

        // 編集ボタン
        const editBtn = document.createElement('button');
        editBtn.textContent = '編集';
        editBtn.onclick = () => editNextPuyoPair(i);
        editBtn.style.marginLeft = 'auto';
        editBtn.style.padding = '2px 5px';
        editBtn.style.backgroundColor = '#5e81ac';
        editBtn.style.color = 'white';
        editBtn.style.border = 'none';
        editBtn.style.borderRadius = '3px';
        editBtn.style.cursor = 'pointer';
        item.appendChild(editBtn);

        editNextListContainer.appendChild(item);
    }

    // NEXT追加ボタン
    const addNextBtn = document.createElement('button');
    addNextBtn.textContent = 'NEXTを追加';
    addNextBtn.onclick = addEditNextPuyoPair;
    addNextBtn.style.width = '100%';
    addNextBtn.style.padding = '5px';
    addNextBtn.style.backgroundColor = '#2a9d8f';
    addNextBtn.style.color = 'white';
    addNextBtn.style.border = 'none';
    addNextBtn.style.borderRadius = '5px';
    addNextBtn.style.cursor = 'pointer';
    addNextBtn.style.marginTop = '10px';
    editNextListContainer.appendChild(addNextBtn);
}

function addEditNextPuyoPair() {
    editingNextPuyos.push(getRandomPair());
    renderEditNextPuyos();
    nextEdited = true;
}

function editNextPuyoPair(index) {
    const currentPair = editingNextPuyos[index];
    let newSubColor = prompt(`NEXT ${index + 1} の上のぷよの色 (1-4, 0=空):`, currentPair[0]);
    let newMainColor = prompt(`NEXT ${index + 1} の下のぷよの色 (1-4, 0=空):`, currentPair[1]);

    newSubColor = parseInt(newSubColor);
    newMainColor = parseInt(newMainColor);

    if (!isNaN(newSubColor) && newSubColor >= 0 && newSubColor <= 5 &&
        !isNaN(newMainColor) && newMainColor >= 0 && newMainColor <= 5) {
        editingNextPuyos[index] = [newSubColor, newMainColor];
        renderEditNextPuyos();
        nextEdited = true;
    } else {
        alert('不正な入力です。0から5の数字を入力してください。');
    }
}

function clearEditNext() {
    editingNextPuyos = [];
    for (let i = 0; i < NUM_VISIBLE_NEXT_PUYOS + 3; i++) { // 初期数 + α
        editingNextPuyos.push(getRandomPair());
    }
    renderEditNextPuyos();
    nextEdited = true;
}

function applyNextPuyos() {
    alert('編集中のNEXTぷよを適用しました。プレイモードに戻ると反映されます。');
    nextEdited = true;
}

// ---------- 設定画面 ----------
function toggleSettingMode() {
    const settingOverlay = document.getElementById('setting-overlay');
    if (settingOverlay.style.display === 'none') {
        settingOverlay.style.display = 'flex';
        gameState = 'setting';
        stopPuyoDropLoop();
        stopChain();
    } else {
        settingOverlay.style.display = 'none';
        gameState = 'playing';
        startPuyoDropLoop();
    }
}

function updateGravityWait(value) {
    gravityWaitTime = parseInt(value);
    document.getElementById('gravity-wait-value').textContent = `${gravityWaitTime}ms`;
}

function updateChainWait(value) {
    chainWaitTime = parseInt(value);
    document.getElementById('chain-wait-value').textContent = `${chainWaitTime}ms`;
}

// ---------- オンライン対戦画面 ----------
function showOnlineOverlay() {
    const onlineOverlay = document.getElementById('online-overlay');
    if (onlineOverlay) {
        onlineOverlay.style.display = 'flex';
        gameState = 'setting'; // オンライン画面中は設定モード扱い
        stopPuyoDropLoop();
        stopChain();
    }
}

function hideOnlineOverlay() {
    const onlineOverlay = document.getElementById('online-overlay');
    if (onlineOverlay) {
        onlineOverlay.style.display = 'none';
        gameState = 'playing';
        startPuyoDropLoop();
    }
}

// ---------- 初期化処理 ----------
let _initializedOnce = false;
window.initializeGame = function() {
    createBoardDOM();
    initBoard();
    generateInitialNextQueue();
    score = 0;
    chainCount = 0;
    gameState = 'playing';
    historyStack = [];
    redoStack = [];
    saveHistory(); // 初期状態を履歴に保存

    // 初回ロードまたは操作ぷよが存在しない場合は生成
    if (!_initializedOnce || !currentPuyo) {
        ensureNextQueueCapacity();
        generateNewPuyo();
        _initializedOnce = true;
    }
    startPuyoDropLoop();
    updateUI();
}

// モバイル操作ボタンの表示/非表示を切り替える関数
function checkMobileControlsVisibility() {
    const mobileControls = document.getElementById('mobile-controls');
    if (mobileControls) {
        if (window.innerWidth < 768) { // 例: 768px未満で表示
            mobileControls.style.display = 'flex';
        } else {
            mobileControls.style.display = 'none';
        }
    }
}

// イベントリスナー
document.addEventListener('DOMContentLoaded', () => {
    window.initializeGame();
    setupPalette();
    checkMobileControlsVisibility();

    // キーボード操作
    document.addEventListener('keydown', (event) => {
        if (gameState !== 'playing') return;

        try {
            switch (event.key) {
                case 'ArrowLeft':
                    movePuyo(-1, 0);
                    break;
                case 'ArrowRight':
                    movePuyo(1, 0);
                    break;
                case 'ArrowDown':
                    softDrop();
                    break;
                case 'ArrowUp':
                case 'x':
                case 'X':
                    rotatePuyo();
                    break;
                case 'z':
                case 'Z':
                    // 反時計回り回転 (未実装)
                    rotatePuyo(); // とりあえず時計回りで代用
                    break;
                case ' ': // スペースキーでハードドロップ
                    hardDrop();
                    break;
                case 'u':
                case 'U':
                    undoMove();
                    break;
                case 'y':
                case 'Y':
                    redoMove();
                    break;
                case 'r':
                case 'R':
                    window.initializeGame(); // Rキーでリセット
                    break;
                case 'e':
                case 'E':
                    toggleMode(); // Eキーでエディットモード切り替え
                    break;
                case 's':
                case 'S':
                    toggleSettingMode(); // Sキーで設定画面切り替え
                    break;
            }
        } catch (err) {
            console.error('キーイベントエラー:', err);
        }
    });

    // モバイル操作ボタンのイベントリスナー
    document.getElementById('btn-left').addEventListener('click', () => movePuyo(-1, 0));
    document.getElementById('btn-right').addEventListener('click', () => movePuyo(1, 0));
    document.getElementById('btn-soft-drop').addEventListener('click', () => softDrop());
    document.getElementById('btn-hard-drop').addEventListener('click', () => hardDrop());
    document.getElementById('btn-rotate-cw').addEventListener('click', () => rotatePuyo());
    document.getElementById('btn-rotate-ccw').addEventListener('click', () => rotatePuyo());

    // 盤面クリックでエディットモード
    document.getElementById('puyo-board').addEventListener('click', handleBoardClick);

    // 初期化時に一度モバイルコントロールの表示をチェック
    checkMobileControlsVisibility();
    window.addEventListener('resize', checkMobileControlsVisibility);
});
