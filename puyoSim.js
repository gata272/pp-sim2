// --- ぷよぷよシミュレーションの定数と設定 ---

const WIDTH = 6;
const HEIGHT = 14; // 12段 + 隠し2段
const COLORS = {
    EMPTY: 0,
    RED: 1,
    GREEN: 2,
    BLUE: 3,
    YELLOW: 4,
    PURPLE: 5,
    GARBAGE: 6
};
const COLOR_NAMES = ['empty', 'red', 'green', 'blue', 'yellow', 'purple', 'garbage'];
const MIN_CHAIN_COUNT = 4;

let board = [];
let currentPuyo = null;
let nextPuyos = [];
let gameState = 'playing'; // 'playing', 'editing', 'chaining', 'gameover'
let score = 0;
let dropTimer = null;
let autoDropEnabled = true;
let editModePuyo = COLORS.RED;
let history = [];
let historyIndex = -1;
let aiHintEnabled = false;

// 最大連鎖の結果を保持するグローバル変数
let maxChainResult = {
    maxChain: 0,
    starterPuyo: null // {x: 0, y: 0}
};

// --- ユーティリティ関数 ---

function getRandomPuyoColor() {
    return Math.floor(Math.random() * 5) + 1; // 1 (RED) から 5 (PURPLE)
}

function createEmptyBoard() {
    const newBoard = [];
    for (let y = 0; y < HEIGHT; y++) {
        newBoard[y] = new Array(WIDTH).fill(COLORS.EMPTY);
    }
    return newBoard;
}

function generateNewPuyo() {
    if (nextPuyos.length === 0) {
        nextPuyos.push(getRandomPuyoColor(), getRandomPuyoColor(), getRandomPuyoColor(), getRandomPuyoColor());
    }

    const mainColor = nextPuyos.shift();
    const subColor = nextPuyos.shift();

    currentPuyo = {
        mainX: 2,
        mainY: HEIGHT - 2, // 13段目 (隠し領域)
        mainColor: mainColor,
        subX: 2,
        subY: HEIGHT - 1, // 14段目 (隠し領域)
        subColor: subColor,
        rotation: 0 // 0: subが上, 1: subが右, 2: subが下, 3: subが左
    };

    if (board[currentPuyo.mainY][currentPuyo.mainX] !== COLORS.EMPTY || board[currentPuyo.subY][currentPuyo.subX] !== COLORS.EMPTY) {
        gameState = 'gameover';
        alert('ゲームオーバー！');
        return;
    }
}

function getPuyoCoords() {
    const coords = [{ x: currentPuyo.mainX, y: currentPuyo.mainY, color: currentPuyo.mainColor }];
    
    switch (currentPuyo.rotation) {
        case 0: // subが上
            coords.push({ x: currentPuyo.mainX, y: currentPuyo.mainY + 1, color: currentPuyo.subColor });
            break;
        case 1: // subが右
            coords.push({ x: currentPuyo.mainX + 1, y: currentPuyo.mainY, color: currentPuyo.subColor });
            break;
        case 2: // subが下
            coords.push({ x: currentPuyo.mainX, y: currentPuyo.mainY - 1, color: currentPuyo.subColor });
            break;
        case 3: // subが左
            coords.push({ x: currentPuyo.mainX - 1, y: currentPuyo.mainY, color: currentPuyo.subColor });
            break;
    }
    return coords;
}

function checkCollision(x, y) {
    if (x < 0 || x >= WIDTH) return true;
    if (y < 0) return true; // 盤面の下端
    if (y >= HEIGHT) return false; // 盤面の上端は衝突判定しない (ぷよはY=13まで存在する)
    
    return board[y][x] !== COLORS.EMPTY;
}

function movePuyo(dx, dy) {
    if (gameState !== 'playing') return;

    const newMainX = currentPuyo.mainX + dx;
    const newMainY = currentPuyo.mainY + dy;
    
    const newCoords = [];
    
    // メインぷよの新しい座標
    newCoords.push({ x: newMainX, y: newMainY });

    // サブぷよの新しい座標
    switch (currentPuyo.rotation) {
        case 0: // subが上
            newCoords.push({ x: newMainX, y: newMainY + 1 });
            break;
        case 1: // subが右
            newCoords.push({ x: newMainX + 1, y: newMainY });
            break;
        case 2: // subが下
            newCoords.push({ x: newMainX, y: newMainY - 1 });
            break;
        case 3: // subが左
            newCoords.push({ x: newMainX - 1, y: newMainY });
            break;
    }

    // 衝突判定
    for (const coord of newCoords) {
        if (checkCollision(coord.x, coord.y)) {
            if (dy < 0) { // 下移動で衝突した場合
                lockPuyo();
            }
            return false;
        }
    }

    // 移動
    currentPuyo.mainX = newMainX;
    currentPuyo.mainY = newMainY;
    
    // サブぷよの座標は回転とメインぷよの座標から計算されるため、直接更新は不要
    
    renderBoard();
    return true;
}

function rotatePuyoCW() {
    if (gameState !== 'playing') return;

    const newRotation = (currentPuyo.rotation + 1) % 4;
    const originalRotation = currentPuyo.rotation;
    currentPuyo.rotation = newRotation;

    const newCoords = getPuyoCoords();
    
    // 衝突判定
    for (const coord of newCoords) {
        if (checkCollision(coord.x, coord.y)) {
            // 衝突した場合、回転を元に戻す
            currentPuyo.rotation = originalRotation;
            return false;
        }
    }

    renderBoard();
    return true;
}

function rotatePuyoCCW() {
    if (gameState !== 'playing') return;

    const newRotation = (currentPuyo.rotation + 3) % 4;
    const originalRotation = currentPuyo.rotation;
    currentPuyo.rotation = newRotation;

    const newCoords = getPuyoCoords();
    
    // 衝突判定
    for (const coord of newCoords) {
        if (checkCollision(coord.x, coord.y)) {
            // 衝突した場合、回転を元に戻す
            currentPuyo.rotation = originalRotation;
            return false;
        }
    }

    renderBoard();
    return true;
}

function hardDrop() {
    if (gameState !== 'playing') return;

    clearInterval(dropTimer);
    dropTimer = null;

    while (movePuyo(0, -1)) {
        // 落下し続ける
    }
}

function lockPuyo() {
    if (gameState !== 'playing') return;

    clearInterval(dropTimer);
    dropTimer = null;

    const coords = getPuyoCoords();
    
    // 盤面にぷよを固定
    for (const coord of coords) {
        if (coord.y >= 0 && coord.y < HEIGHT && coord.x >= 0 && coord.x < WIDTH) {
            board[coord.y][coord.x] = coord.color;
        }
    }

    currentPuyo = null;
    
    // 履歴を保存
    saveState();

    // 連鎖処理を開始
    runChain();
}

// --- 連鎖処理 ---

function findConnectedPuyos(currentBoard) {
    const visited = createEmptyBoard();
    const groups = [];

    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const color = currentBoard[y][x];
            if (color !== COLORS.EMPTY && color !== COLORS.GARBAGE && visited[y][x] === COLORS.EMPTY) {
                const group = [];
                const queue = [{ x, y }];
                visited[y][x] = 1;

                while (queue.length > 0) {
                    const current = queue.shift();
                    group.push(current);

                    const neighbors = [
                        { x: current.x + 1, y: current.y },
                        { x: current.x - 1, y: current.y },
                        { x: current.x, y: current.y + 1 },
                        { x: current.x, y: current.y - 1 }
                    ];

                    for (const neighbor of neighbors) {
                        if (neighbor.x >= 0 && neighbor.x < WIDTH && neighbor.y >= 0 && neighbor.y < HEIGHT) {
                            if (currentBoard[neighbor.y][neighbor.x] === color && visited[neighbor.y][neighbor.x] === COLORS.EMPTY) {
                                visited[neighbor.y][neighbor.x] = 1;
                                queue.push(neighbor);
                            }
                        }
                    }
                }

                if (group.length >= MIN_CHAIN_COUNT) {
                    groups.push(group);
                }
            }
        }
    }
    return groups;
}

function clearGarbagePuyos(currentBoard, clearedPuyos) {
    const garbageToClear = [];
    
    for (const clearedPuyo of clearedPuyos) {
        const neighbors = [
            { x: clearedPuyo.x + 1, y: clearedPuyo.y },
            { x: clearedPuyo.x - 1, y: clearedPuyo.y },
            { x: clearedPuyo.x, y: clearedPuyo.y + 1 },
            { x: clearedPuyo.x, y: clearedPuyo.y - 1 }
        ];

        for (const neighbor of neighbors) {
            if (neighbor.x >= 0 && neighbor.x < WIDTH && neighbor.y >= 0 && neighbor.y < HEIGHT) {
                if (currentBoard[neighbor.y][neighbor.x] === COLORS.GARBAGE) {
                    garbageToClear.push(neighbor);
                }
            }
        }
    }

    // 重複を排除してゴミぷよをクリア
    const uniqueGarbage = [];
    const uniqueSet = new Set();
    for (const garbage of garbageToClear) {
        const key = `<LaTex>${garbage.x},$</LaTex>{garbage.y}`;
        if (!uniqueSet.has(key)) {
            uniqueSet.add(key);
            uniqueGarbage.push(garbage);
            currentBoard[garbage.y][garbage.x] = COLORS.EMPTY;
        }
    }
    
    return uniqueGarbage;
}

function simulateGravity(currentBoard) {
    let moved = false;
    for (let x = 0; x < WIDTH; x++) {
        let writeY = 0;
        for (let readY = 0; readY < HEIGHT; readY++) {
            if (currentBoard[readY][x] !== COLORS.EMPTY) {
                if (readY !== writeY) {
                    currentBoard[writeY][x] = currentBoard[readY][x];
                    currentBoard[readY][x] = COLORS.EMPTY;
                    moved = true;
                }
                writeY++;
            }
        }
    }
    return moved;
}

function runChain() {
    gameState = 'chaining';
    let chainCount = 0;
    let totalClearedPuyos = 0;
    
    const chainLoop = () => {
        // 1. 重力処理
        simulateGravity(board);
        renderBoard();
        
        // 2. 連鎖判定
        const groups = findConnectedPuyos(board);
        
        if (groups.length === 0) {
            // 連鎖終了
            gameState = 'playing';
            
            // ゲームオーバー判定 (3列目の12段目が埋まっていたら)
            const gameOverLineY = HEIGHT - 2; // 12段目
            const checkX = 2; // 3列目
            
            if (board[gameOverLineY][checkX] !== COLORS.EMPTY) {
                gameState = 'gameover';
                alert(`ゲームオーバー！\n最終スコア: ${score}\n最大連鎖数: ${chainCount}連鎖`);
                return;
            }
            
            generateNewPuyo();
            startPuyoDropLoop();
            checkMobileControlsVisibility();
            renderBoard();
            return;
        }

        chainCount++;
        let clearedPuyos = [];
        
        // 3. ぷよの消去
        for (const group of groups) {
            for (const puyo of group) {
                board[puyo.y][puyo.x] = COLORS.EMPTY;
                clearedPuyos.push(puyo);
            }
        }
        
        // 4. ゴミぷよの消去
        const clearedGarbage = clearGarbagePuyos(board, clearedPuyos);
        clearedPuyos = clearedPuyos.concat(clearedGarbage);
        
        totalClearedPuyos += clearedPuyos.length;
        
        // スコア計算 (簡易版)
        score += chainCount * totalClearedPuyos * 10;
        document.getElementById('score-display').textContent = score;
        
        renderBoard();
        
        // 次の連鎖へ
        setTimeout(chainLoop, 500); // 0.5秒待って次の連鎖へ
    };

    // 最初の重力処理と連鎖判定
    chainLoop();
}

// --- 最大連鎖計算ロジック ---

function calculateMaxChainFromBoard(initialBoard) {
    const maxChainBoard = JSON.parse(JSON.stringify(initialBoard)); // 盤面をディープコピー
    let chainCount = 0;
    
    const chainLoop = () => {
        // 1. 重力処理
        simulateGravity(maxChainBoard);
        
        // 2. 連鎖判定
        const groups = findConnectedPuyos(maxChainBoard);
        
        if (groups.length === 0) {
            return chainCount; // 連鎖終了
        }

        chainCount++;
        let clearedPuyos = [];
        
        // 3. ぷよの消去
        for (const group of groups) {
            for (const puyo of group) {
                maxChainBoard[puyo.y][puyo.x] = COLORS.EMPTY;
                clearedPuyos.push(puyo);
            }
        }
        
        // 4. ゴミぷよの消去
        const clearedGarbage = clearGarbagePuyos(maxChainBoard, clearedPuyos);
        
        // 次の連鎖へ (再帰的に呼び出す代わりにループで処理)
        return chainLoop();
    };

    return chainLoop();
}

function findPotentialChainStarters(currentBoard) {
    const starters = [];
    
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const color = currentBoard[y][x];
            
            // ぷよが存在し、かつ隣に空間がある
            if (color !== COLORS.EMPTY && color !== COLORS.GARBAGE) {
                const neighbors = [
                    { x: x + 1, y: y },
                    { x: x - 1, y: y },
                    { x: x, y: y + 1 },
                    { x: x, y: y - 1 }
                ];
                
                for (const neighbor of neighbors) {
                    if (neighbor.x >= 0 && neighbor.x < WIDTH && neighbor.y >= 0 && neighbor.y < HEIGHT) {
                        if (currentBoard[neighbor.y][neighbor.x] === COLORS.EMPTY) {
                            starters.push({ x, y });
                            break;
                        }
                    }
                }
            }
        }
    }
    
    // 重複を排除
    const uniqueStarters = [];
    const uniqueSet = new Set();
    for (const starter of starters) {
        const key = `<LaTex>${starter.x},$</LaTex>{starter.y}`;
        if (!uniqueSet.has(key)) {
            uniqueSet.add(key);
            uniqueStarters.push(starter);
        }
    }
    
    return uniqueStarters;
}

function findMaxChain() {
    if (gameState === 'chaining') return;

    // 落下中のぷよを固定した状態の盤面をシミュレーション
    let simBoard = JSON.parse(JSON.stringify(board));
    if (currentPuyo) {
        const coords = getPuyoCoords();
        for (const coord of coords) {
            if (coord.y >= 0 && coord.y < HEIGHT && coord.x >= 0 && coord.x < WIDTH) {
                simBoard[coord.y][coord.x] = coord.color;
            }
        }
    }
    
    const potentialStarters = findPotentialChainStarters(simBoard);
    let maxChain = 0;
    let bestStarter = null;
    
    for (const starter of potentialStarters) {
        const testBoard = JSON.parse(JSON.stringify(simBoard));
        
        // 起点ぷよを消去して連鎖を開始
        const color = testBoard[starter.y][starter.x];
        
        // 4つ以上繋がっているか確認
        const group = [];
        const queue = [{ x: starter.x, y: starter.y }];
        const visited = createEmptyBoard();
        visited[starter.y][starter.x] = 1;
        
        while (queue.length > 0) {
            const current = queue.shift();
            group.push(current);

            const neighbors = [
                { x: current.x + 1, y: current.y },
                { x: current.x - 1, y: current.y },
                { x: current.x, y: current.y + 1 },
                { x: current.x, y: current.y - 1 }
            ];

            for (const neighbor of neighbors) {
                if (neighbor.x >= 0 && neighbor.x < WIDTH && neighbor.y >= 0 && neighbor.y < HEIGHT) {
                    if (testBoard[neighbor.y][neighbor.x] === color && visited[neighbor.y][neighbor.x] === COLORS.EMPTY) {
                        visited[neighbor.y][neighbor.x] = 1;
                        queue.push(neighbor);
                    }
                }
            }
        }
        
        if (group.length >= MIN_CHAIN_COUNT) {
            // 4つ以上繋がっていたら、そのグループを消去して連鎖をシミュレーション
            for (const puyo of group) {
                testBoard[puyo.y][puyo.x] = COLORS.EMPTY;
            }
            
            const chain = calculateMaxChainFromBoard(testBoard);
            
            if (chain > maxChain) {
                maxChain = chain;
                bestStarter = starter;
            }
        }
    }
    
    // 結果をグローバル変数に保存
    maxChainResult.maxChain = maxChain;
    maxChainResult.starterPuyo = bestStarter;
    
    // UIを更新
    document.getElementById('max-chain-display').textContent = maxChain;
    renderBoard();
}

// --- 描画処理 ---

function createBoardDOM() {
    const boardElement = document.getElementById('puyo-board');
    boardElement.innerHTML = '';
    
    // Y=0 (最上段) から Y=13 (最下段) の順にDOMを生成
    for (let y = HEIGHT - 1; y >= 0; y--) {
        for (let x = 0; x < WIDTH; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            // Y座標を反転させてIDを設定 (DOMのY=0がゲームのY=13に対応)
            const domY = HEIGHT - 1 - y;
            cell.id = `cell-<LaTex>${x}-$</LaTex>{domY}`;
            
            if (gameState === 'editing') {
                cell.onclick = () => {
                    if (y >= 0 && y < HEIGHT && x >= 0 && x < WIDTH) {
                        board[y][x] = editModePuyo;
                        renderBoard();
                    }
                };
            }
            
            boardElement.appendChild(cell);
        }
    }
}

function renderBoard() {
    const isPlaying = gameState === 'playing';
    const currentPuyoCoords = isPlaying ? getPuyoCoords() : [];
    const ghostPuyoCoords = isPlaying && currentPuyo ? getGhostFinalPositions() : []; 
    
    // 最大連鎖の起点ぷよ
    const starterPuyo = maxChainResult.starterPuyo;

    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            // Y座標を反転させてDOM要素を取得
            const domY = HEIGHT - 1 - y; // Y=0 (底) -> domY=13 (上)
            const cellElement = document.getElementById(`cell-<LaTex>${x}-$</LaTex>{domY}`);
            if (!cellElement) continue;

            // 既存のぷよ要素をクリア
            cellElement.innerHTML = '';
            
            // 盤面のぷよを描画
            const color = board[y][x];
            if (color !== COLORS.EMPTY) {
                const puyo = document.createElement('div');
                puyo.className = `puyo color-${COLOR_NAMES[color]}`;
                
                // 最大連鎖の起点ぷよをハイライト
                if (starterPuyo && starterPuyo.x === x && starterPuyo.y === y) {
                    puyo.classList.add('puyo-max-chain-starter');
                }
                
                cellElement.appendChild(puyo);
            }
            
            // 落下中のぷよを描画
            const currentPuyoMain = currentPuyoCoords.find(c => c.x === x && c.y === y);
            if (currentPuyoMain) {
                const puyo = document.createElement('div');
                puyo.className = `puyo falling color-${COLOR_NAMES[currentPuyoMain.color]}`;
                cellElement.appendChild(puyo);
            }
            
            // ゴーストぷよを描画
            const ghostPuyo = ghostPuyoCoords.find(c => c.x === x && c.y === y);
            if (ghostPuyo) {
                const puyo = document.createElement('div');
                puyo.className = `puyo ghost color-${COLOR_NAMES[ghostPuyo.color]}`;
                cellElement.appendChild(puyo);
            }
        }
    }
    
    // NEXTぷよの描画
    for (let i = 1; i <= 2; i++) {
        const nextElement = document.getElementById(`next-puyo-<LaTex>${i}`);
        nextElement.innerHTML = '';
        
        const mainColor = nextPuyos[i * 2 - 2];
        const subColor = nextPuyos[i * 2 - 1];
        
        if (mainColor) {
            const mainPuyo = document.createElement('div');
            mainPuyo.className = `puyo color-$</LaTex>{COLOR_NAMES[mainColor]}`;
            nextElement.appendChild(mainPuyo);
        }
        if (subColor) {
            const subPuyo = document.createElement('div');
            subPuyo.className = `puyo color-${COLOR_NAMES[subColor]}`;
            nextElement.appendChild(subPuyo);
        }
    }
    
    // UIの更新
    updateUI();
}

function getGhostFinalPositions() {
    if (!currentPuyo) return [];
    
    let ghostY = currentPuyo.mainY;
    
    // メインぷよが衝突するまで落下
    while (!checkCollision(currentPuyo.mainX, ghostY - 1) && !checkCollision(currentPuyo.subX, ghostY - 1)) {
        ghostY--;
    }
    
    const ghostCoords = [];
    
    // メインぷよのゴースト座標
    ghostCoords.push({ x: currentPuyo.mainX, y: ghostY, color: currentPuyo.mainColor });

    // サブぷよのゴースト座標
    switch (currentPuyo.rotation) {
        case 0: // subが上
            ghostCoords.push({ x: currentPuyo.mainX, y: ghostY + 1, color: currentPuyo.subColor });
            break;
        case 1: // subが右
            ghostCoords.push({ x: currentPuyo.mainX + 1, y: ghostY, color: currentPuyo.subColor });
            break;
        case 2: // subが下
            ghostCoords.push({ x: currentPuyo.mainX, y: ghostY - 1, color: currentPuyo.subColor });
            break;
        case 3: // subが左
            ghostCoords.push({ x: currentPuyo.mainX - 1, y: ghostY, color: currentPuyo.subColor });
            break;
    }
    
    return ghostCoords;
}

// --- ゲーム制御 ---

function initializeGame() {
    board = createEmptyBoard();
    nextPuyos = [getRandomPuyoColor(), getRandomPuyoColor(), getRandomPuyoColor(), getRandomPuyoColor()];
    score = 0;
    history = [];
    historyIndex = -1;
    
    createBoardDOM();
    generateNewPuyo();
    saveState();
    startPuyoDropLoop();
    checkMobileControlsVisibility();
    renderBoard();
}

function startPuyoDropLoop() {
    if (dropTimer) clearInterval(dropTimer);
    if (gameState !== 'playing' || !autoDropEnabled) return;
    
    dropTimer = setInterval(() => {
        movePuyo(0, -1);
    }, 1000); // 1秒ごとに落下
}

function toggleAutoDrop() {
    autoDropEnabled = !autoDropEnabled;
    document.getElementById('auto-drop-button').textContent = `自動落下: ${autoDropEnabled ? 'ON' : 'OFF'}`;
    if (autoDropEnabled) {
        startPuyoDropLoop();
    } else {
        if (dropTimer) clearInterval(dropTimer);
        dropTimer = null;
    }
}

function resetBoard() {
    if (dropTimer) clearInterval(dropTimer);
    dropTimer = null;
    initializeGame();
}

function toggleEditMode() {
    if (gameState === 'playing') {
        gameState = 'editing';
        if (dropTimer) clearInterval(dropTimer);
        dropTimer = null;
        currentPuyo = null;
        document.getElementById('play-info-container').style.display = 'none';
        document.getElementById('edit-info-container').style.display = 'flex';
        document.getElementById('puyo-board').classList.add('editing');
    } else if (gameState === 'editing') {
        gameState = 'playing';
        document.getElementById('play-info-container').style.display = 'flex';
        document.getElementById('edit-info-container').style.display = 'none';
        document.getElementById('puyo-board').classList.remove('editing');
        
        // 編集モードから戻る際に、新しいぷよを生成し、ゲームを再開
        generateNewPuyo();
        saveState();
        startPuyoDropLoop();
    }
    renderBoard();
}

function selectPuyo(colorName) {
    const colorIndex = COLOR_NAMES.indexOf(colorName);
    editModePuyo = colorIndex !== -1 ? colorIndex : COLORS.RED;
    
    // パレットの選択状態を更新
    document.querySelectorAll('#puyo-palette .puyo').forEach(p => p.classList.remove('selected-puyo'));
    document.querySelector(`.puyo.color-<LaTex>${colorName}`).classList.add('selected-puyo');
}

function clearAllPuyos() {
    board = createEmptyBoard();
    renderBoard();
}

function toggleAIHint() {
    aiHintEnabled = !aiHintEnabled;
    document.getElementById('ai-hint-button').textContent = `AIヒント: $</LaTex>{aiHintEnabled ? 'ON' : 'OFF'}`;
    renderBoard();
}

// --- 履歴管理 ---

function saveState() {
    // 現在のインデックス以降の履歴を削除
    history.splice(historyIndex + 1);
    
    const state = {
        board: JSON.parse(JSON.stringify(board)),
        currentPuyo: JSON.parse(JSON.stringify(currentPuyo)),
        nextPuyos: JSON.parse(JSON.stringify(nextPuyos)),
        score: score
    };
    history.push(state);
    historyIndex = history.length - 1;
    updateHistoryButtons();
}

function loadState(index) {
    if (index < 0 || index >= history.length) return;
    
    const state = history[index];
    board = JSON.parse(JSON.stringify(state.board));
    currentPuyo = JSON.parse(JSON.stringify(state.currentPuyo));
    nextPuyos = JSON.parse(JSON.stringify(state.nextPuyos));
    score = state.score;
    historyIndex = index;
    
    if (gameState === 'chaining') {
        gameState = 'playing';
    }
    
    if (dropTimer) clearInterval(dropTimer);
    if (gameState === 'playing' && autoDropEnabled) {
        startPuyoDropLoop();
    }
    
    renderBoard();
    updateHistoryButtons();
}

function undoMove() {
    if (historyIndex > 0) {
        loadState(historyIndex - 1);
    }
}

function redoMove() {
    if (historyIndex < history.length - 1) {
        loadState(historyIndex + 1);
    }
}

function updateHistoryButtons() {
    document.getElementById('undo-button').disabled = historyIndex <= 0;
    document.getElementById('redo-button').disabled = historyIndex >= history.length - 1;
}

// --- UI更新 ---

function updateUI() {
    document.getElementById('score-display').textContent = score;
    document.getElementById('max-chain-display').textContent = maxChainResult.maxChain;
    
    updateHistoryButtons(); 
}

// --- 入力処理 ---

function handleInput(event) {
    if (gameState !== 'playing') return;

    const key = event.key.toLowerCase();

    if (key === 'arrowleft' || key === 'a') {
        movePuyo(-1, 0);
    } else if (key === 'arrowright' || key === 'd') {
        movePuyo(1, 0);
    } else if (key === 'arrowdown' || key === 's') {
        if (autoDropEnabled && dropTimer) {
            clearInterval(dropTimer);
            movePuyo(0, -1);
            startPuyoDropLoop();
        } else {
            movePuyo(0, -1);
        }
    } else if (key === 'arrowup' || key === 'w' || key === 'x') {
        rotatePuyoCW();
    } else if (key === 'z' || key === 'control') {
        rotatePuyoCCW();
    } else if (key === ' ') {
        event.preventDefault(); 
        hardDrop();
    }
}

// --- 初期化実行 ---

document.addEventListener('DOMContentLoaded', initializeGame);

// グローバルスコープに公開
window.rotatePuyoCW = rotatePuyoCW;
window.rotatePuyoCCW = rotatePuyoCCW;
window.findMaxChain = findMaxChain;
