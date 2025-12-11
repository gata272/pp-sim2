// --- ぷよぷよシミュレーションの定数と設定 ---

// 盤面サイズ
const WIDTH = 6;
const HEIGHT = 14; // 可視領域12 + 隠し領域2

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
let nextPuyoColors = []; 
let score = 0;
let chainCount = 0;
let gameState = 'playing'; // 'playing', 'chaining', 'gameover', 'editing'
let currentEditColor = COLORS.RED; // エディットモードで選択中の色 (デフォルトは赤)
let editingNextPuyos = []; // エディットモードで編集中のネクストぷよリスト


// --- 初期化関数 ---

/**
 * モバイル操作ボタンの表示/非表示をチェックし、設定する
 */
function checkMobileControlsVisibility() {
    const mobileControls = document.getElementById('mobile-controls');
    if (!mobileControls) return;

    // プレイモードかつ画面幅が650px以下の場合に表示
    if (gameState === 'playing' && window.innerWidth <= 650) {
        mobileControls.style.display = 'flex';
    } else {
        mobileControls.style.display = 'none';
    }
}


function initializeGame() {
    // 盤面を空で初期化
    for (let y = 0; y < HEIGHT; y++) {
        board[y] = [];
        for (let x = 0; x < WIDTH; x++) {
            board[y][x] = COLORS.EMPTY;
        }
    }

    score = 0;
    chainCount = 0;
    gameState = 'playing';

    // ネクストぷよリストを完全にランダムなぷよで初期化 (最低2組)
    nextPuyoColors = [getRandomPair(), getRandomPair()];
    // エディット用のネクストリストも初期化
    editingNextPuyos = JSON.parse(JSON.stringify(nextPuyoColors));

    // 初期状態はプレイモードなので、エディットモードへのテキストを設定
    const modeToggleButton = document.getElementById('mode-toggle-button');
    if (modeToggleButton) {
        // プレイモード時の表示: 「edit」 (エディットモードへの移行ボタン)
        modeToggleButton.textContent = 'edit';
    }
    
    // #info-panelのクラスをリセット
    const infoPanel = document.getElementById('info-panel');
    if (infoPanel) infoPanel.classList.remove('edit-mode-active');


    // 最初のぷよを生成
    generateNewPuyo(); 
    
    updateUI();
    
    if (!document.initializedKeyHandler) {
        document.addEventListener('keydown', handleInput);
        
        // モバイル操作ボタンのイベントリスナー設定 (グローバル関数を呼び出す)
        const btnLeft = document.getElementById('btn-left');
        const btnRight = document.getElementById('btn-right');
        const btnRotateCW = document.getElementById('btn-rotate-cw'); 
        const btnRotateCCW = document.getElementById('btn-rotate-ccw'); 
        const btnHardDrop = document.getElementById('btn-hard-drop');

        if (btnLeft) btnLeft.addEventListener('click', () => movePuyo(-1, 0));
        if (btnRight) btnRight.addEventListener('click', () => movePuyo(1, 0));
        
        // windowに公開された関数を呼び出す
        if (btnRotateCW) btnRotateCW.addEventListener('click', window.rotatePuyoCW); 
        if (btnRotateCCW) btnRotateCCW.addEventListener('click', window.rotatePuyoCCW); 
        
        if (btnHardDrop) btnHardDrop.addEventListener('click', window.hardDrop);
        
        setupEditModeListeners(); 
        
        document.initializedKeyHandler = true;
    }
    
    checkMobileControlsVisibility(); // モバイルコントロールの初期表示
    renderBoard();
}

/**
 * 盤面リセット関数 (グローバル公開)
 */
window.resetGame = function() { 
    initializeGame();
    alert('盤面をリセットしました。');
}

/**
 * モード切り替え関数 (グローバル公開)
 */
window.toggleMode = function() {
    const infoPanel = document.getElementById('info-panel');
    const modeToggleButton = document.getElementById('mode-toggle-button');
    const boardElement = document.getElementById('puyo-board');
    
    if (gameState === 'playing' || gameState === 'gameover') {
        // -> エディットモードへ切り替え
        gameState = 'editing';
        infoPanel.classList.add('edit-mode-active');
        
        // エディットモード時の表示: 「play」 (プレイモードへの移行ボタン)
        if (modeToggleButton) modeToggleButton.textContent = 'play';
        
        checkMobileControlsVisibility(); // モバイル操作ボタンを非表示
        
        // 盤面クリックイベントをエディット用に設定
        boardElement.addEventListener('click', handleBoardClickEditMode);
        
        selectPaletteColor(currentEditColor); 
        renderEditNextPuyos(); 
        renderBoard(); 
        
    } else if (gameState === 'editing') {
        // -> プレイモードへ切り替え
        gameState = 'playing';
        infoPanel.classList.remove('edit-mode-active');
        
        // プレイモード時の表示: 「edit」 (エディットモードへの移行ボタン)
        if (modeToggleButton) modeToggleButton.textContent = 'edit';
        
        checkMobileControlsVisibility(); // モバイル操作ボタンを再表示 (画面幅に応じて)

        // 盤面クリックイベントをエディットモードから解除
        boardElement.removeEventListener('click', handleBoardClickEditMode);
        
        // 既存のネクストを再生成
        currentPuyo = null; 
        generateNewPuyo(); // 新しいぷよを生成
        
        renderBoard();
    }
}


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
    // セルサイズを盤面全体の幅と列数から計算
    const cellSize = rect.width / WIDTH; 

    // クリック座標を盤面座標に変換
    let x = Math.floor((event.clientX - rect.left) / cellSize);
    // Y座標は、描画が上から下にされているのに対し、盤面配列は下から上になっているため反転計算
    let y = Math.floor((rect.height - (event.clientY - rect.top)) / cellSize);

    // 可視領域内に制限 (0 <= y < HEIGHT - 2)
    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT - 2) { 
        // ぷよの配置
        board[y][x] = currentEditColor;
        renderBoard(); 
    }
}

/**
 * エディットモードで設定したネクストをプレイモードに反映する (グローバル公開)
 */
window.applyNextPuyos = function() {
    if (gameState === 'editing') {
        // ネクストリストを現在の編集中のリストで上書き
        nextPuyoColors = JSON.parse(JSON.stringify(editingNextPuyos));
        alert('ネクストぷよの設定を保存しました。プレイモードで適用されます。');
    }
}


// --- ぷよの生成と操作 (プレイモード時のみ有効) ---

function getRandomColor() {
    // 1 (赤) から 4 (黄) までのランダムな色を返す
    return Math.floor(Math.random() * 4) + 1; 
}

function getRandomPair() {
    return [getRandomColor(), getRandomColor()];
}

function generateNewPuyo() {
    if (gameState !== 'playing') return;

    // ネクストリストが不足している場合、新しいぷよを生成しリストに追加
    if (nextPuyoColors.length < 2) {
        while (nextPuyoColors.length < 2) {
            nextPuyoColors.push(getRandomPair());
        }
    }
    
    // ネクストリストから1組取り出し
    const [c1, c2] = nextPuyoColors.shift();

    currentPuyo = {
        mainColor: c1,
        subColor: c2,
        mainX: 2, 
        mainY: HEIGHT - 3, // 可視領域の最上段から2番目
        rotation: 0 
    };
    
    const startingCoords = getPuyoCoords();
    if (checkCollision(startingCoords)) {
        gameState = 'gameover';
        alert('ゲームオーバーです！');
        updateUI();
        renderBoard();
        return; 
    }

    // 新しい1組をネクストに追加
    nextPuyoColors.push(getRandomPair());
}

/**
 * ぷよの状態から2つのぷよの座標 (x, y) を取得する
 */
function getCoordsFromState(puyoState) {
    const { mainX, mainY, rotation } = puyoState;
    let subX = mainX;
    let subY = mainY;

    // 0: 下, 1: 左, 2: 上, 3: 右
    if (rotation === 0) subY = mainY + 1; 
    if (rotation === 1) subX = mainX - 1; 
    if (rotation === 2) subY = mainY - 1; 
    if (rotation === 3) subX = mainX + 1; 

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

    // 色情報を追加
    coords[0].color = currentPuyo.mainColor;
    coords[1].color = currentPuyo.subColor;
    
    return coords;
}

/**
 * 組ぷよが固定された後、ちぎりが発生した際の個々のぷよの最終落下位置を予測する
 */
function getGhostFinalPositions() {
    if (!currentPuyo || gameState !== 'playing') return [];
    
    // 1. 仮の盤面を作成 (ディープコピー)
    let tempBoard = board.map(row => [...row]);

    // 2. 組ぷよの固定位置を決定
    let tempPuyo = { ...currentPuyo };
    while (true) {
        let testPuyo = { ...tempPuyo, mainY: tempPuyo.mainY - 1 };
        const testCoords = getCoordsFromState(testPuyo);
        
        if (checkCollision(testCoords)) {
            break; // 衝突する直前の位置が固定位置
        }
        tempPuyo.mainY -= 1; 
    }
    
    // 固定位置の座標を取得
    const fixedCoords = getCoordsFromState(tempPuyo);
    const puyo1Color = tempPuyo.mainColor;
    const puyo2Color = tempPuyo.subColor;
    const puyoColors = [puyo1Color, puyo2Color];
    
    
    // 3. 盤面に仮置き: 固定位置のぷよで盤面を**上書き**します。
    //    これにより、固定後の状態を正しくシミュレーションできます。
    fixedCoords.forEach(p => {
        if (p.y >= 0 && p.y < HEIGHT) {
            const color = (p.x === tempPuyo.mainX && p.y === tempPuyo.mainY) 
                          ? puyo1Color 
                          : puyo2Color;
            
            // 既存のぷよがあっても、固定される位置なので新しいぷよで上書きする
            tempBoard[p.y][p.x] = color;
        }
    });

    // 4. 仮の重力処理（ちぎりシミュレーション）
    simulateGravity(tempBoard); 

    // 5. 最終的なゴースト座標の抽出
    let ghostPositions = [];
    let puyoCount = 0;
    
    // 最終的に tempBoard にあり、元の board にはなかったぷよをゴーストとして抽出
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const tempColor = tempBoard[y][x];
            const originalColor = board[y][x];
            
            // (a) 元の盤面が空 ('0') で、
            // (b) シミュレーション後の盤面に色があり、
            // (c) その色が今回落下させた組ぷよの色（puyoColors）のいずれかである
            // (d) かつ、まだゴーストぷよを2つ見つけていない
            if (originalColor === COLORS.EMPTY && 
                tempColor !== COLORS.EMPTY &&
                puyoColors.includes(tempColor) && 
                puyoCount < 2) 
            {
                ghostPositions.push({ x: x, y: y, color: tempColor });
                puyoCount++;
            }
        }
    }
    
    // 隠し領域に固定されたぷよは表示しないため、y < HEIGHT - 2 のチェックを追加
    return ghostPositions.filter(p => p.y < HEIGHT - 2); 
}


function checkCollision(coords) {
    for (const puyo of coords) {
        // 盤面外 (左右、下) のチェック
        if (puyo.x < 0 || puyo.x >= WIDTH || puyo.y < 0) return true;

        // 盤面上の既存のぷよとの衝突チェック
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

window.rotatePuyoCW = function() {
    if (gameState !== 'playing') return false;
    const newRotation = (currentPuyo.rotation + 1) % 4;
    // 衝突判定。成功すれば即座に終了 (0, 0)
    if (movePuyo(0, 0, newRotation)) return true; 
    // 壁蹴り: 右移動を試行 (1, 0)
    if (movePuyo(1, 0, newRotation)) return true; 
    // 壁蹴り: 左移動を試行 (-1, 0)
    if (movePuyo(-1, 0, newRotation)) return true; 
    return false;
}

window.rotatePuyoCCW = function() {
    if (gameState !== 'playing') return false;
    const newRotation = (currentPuyo.rotation - 1 + 4) % 4; // 負の数を防ぐ
    // 衝突判定。成功すれば即座に終了 (0, 0)
    if (movePuyo(0, 0, newRotation)) return true; 
    // 壁蹴り: 右移動を試行 (1, 0)
    if (movePuyo(1, 0, newRotation)) return true; 
    // 壁蹴り: 左移動を試行 (-1, 0)
    if (movePuyo(-1, 0, newRotation)) return true; 
    return false;
}

window.hardDrop = function() {
    if (gameState !== 'playing' || !currentPuyo) return;

    // 衝突するまで下に移動 (描画はスキップ: false)
    while (movePuyo(0, -1, undefined, false)); 

    // 最終的な位置で一度だけ描画
    renderBoard(); 
    
    lockPuyo(); // 即座に固定
}

function lockPuyo() {
    if (gameState !== 'playing' || !currentPuyo) return;

    const coords = getPuyoCoords();
    let isGameOver = false;

    for (const puyo of coords) {
        // ぷよが隠し領域 (HEIGHT - 2 以上) に固定されたらゲームオーバー
        if (puyo.y >= HEIGHT - 2) { 
            isGameOver = true;
            break;
        }
        if (puyo.y >= 0) {
            board[puyo.y][puyo.x] = puyo.color;
        }
    }

    if (isGameOver) {
        gameState = 'gameover';
        alert('ゲームオーバーです！');
        updateUI();
        renderBoard();
        return;
    }
    
    currentPuyo = null;
    gameState = 'chaining';
    chainCount = 0;
    
    runChain();
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
    
    // フェーズ1: 重力処理 (ちぎりを含む)。
    gravity(); 
    renderBoard(); 
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // フェーズ2: 連鎖チェック
    const groups = findConnectedPuyos();

    if (groups.length === 0) {
        // 連鎖が検出されなかった場合、連鎖終了。
        gameState = 'playing';
        generateNewPuyo(); 
        checkMobileControlsVisibility(); 
        renderBoard();
        return;
    }

    // フェーズ3: ぷよの削除とスコア計算
    chainCount++;

    let chainScore = calculateScore(groups, chainCount);
    score += chainScore;

    // ぷよの削除 (データを更新)
    groups.forEach(({ group }) => {
        group.forEach(({ x, y }) => {
            board[y][x] = COLORS.EMPTY; 
        });
    });

    renderBoard(); 
    updateUI();

    await new Promise(resolve => setTimeout(resolve, 300));

    // フェーズ4: 再帰的に次の連鎖をチェック (重力処理から再スタート)
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
        // 連結ボーナス
        bonusTotal += BONUS_TABLE.GROUP[groupBonusIndex]; 
    });

    const chainBonusIndex = Math.min(currentChain, BONUS_TABLE.CHAIN.length - 1);
    // 連鎖ボーナス
    bonusTotal += BONUS_TABLE.CHAIN[chainBonusIndex]; 

    const colorBonusIndex = Math.min(colorCount.size, BONUS_TABLE.COLOR.length - 1);
    // 色数ボーナス
    bonusTotal += BONUS_TABLE.COLOR[colorBonusIndex]; 

    // ボーナス合計値は最低 1
    const finalBonus = Math.max(1, bonusTotal);

    // スコア計算: (10 × 消したぷよ数) × 最終ボーナス
    const totalScore = (10 * totalPuyos) * finalBonus;

    return totalScore;
}

/**
 * 渡された盤面データに対して、ぷよの落下処理のみを実行する。
 * (連鎖検出やスコア計算は行わない)
 * @param {Array<Array<number>>} targetBoard - 重力処理を適用する盤面データ
 */
function simulateGravity(targetBoard) {
    for (let x = 0; x < WIDTH; x++) {
        let newColumn = [];

        // 1. ぷよだけを抽出
        for (let y = 0; y < HEIGHT; y++) {
            if (targetBoard[y][x] !== COLORS.EMPTY) {
                newColumn.push(targetBoard[y][x]);
            }
        }

        // 2. 下から詰めたぷよを盤面に戻す（落下）
        for (let y = 0; y < HEIGHT; y++) {
            if (y < newColumn.length) {
                targetBoard[y][x] = newColumn[y];
            } else {
                targetBoard[y][x] = COLORS.EMPTY; // 上部を空にする
            }
        }
    }
}


function gravity() {
    simulateGravity(board);
}


// --- 描画とUI更新 ---

/**
 * 盤面を描画し、落下中のぷよ、ゴーストぷよ、ネクストぷよを処理する
 */
function renderBoard() {
    const boardElement = document.getElementById('puyo-board');
    boardElement.innerHTML = '';
    
    const isPlaying = gameState === 'playing';
    const currentPuyoCoords = isPlaying ? getPuyoCoords() : [];
    // ちぎり予測を行う新しいゴースト座標取得関数を使用
    const ghostPuyoCoords = isPlaying ? getGhostFinalPositions() : []; 

    // 描画は可視領域 (HEIGHT - 3 から 0) のみ
    for (let y = HEIGHT - 3; y >= 0; y--) { 
        for (let x = 0; x < WIDTH; x++) {
            const puyoElement = document.createElement('div');
            
            let cellColor = board[y][x]; 
            let puyoClasses = `puyo puyo-${cellColor}`;

            // 1. ゴーストぷよがこのセルにあるかチェック (プレイモードのみ)
            const puyoGhost = ghostPuyoCoords.find(p => p.x === x && p.y === y);
            if (puyoGhost) {
                // ゴーストぷよの色を適用し、ゴーストクラスを追加
                cellColor = puyoGhost.color; 
                puyoClasses = `puyo puyo-${cellColor} puyo-ghost`;
            }

            // 2. 落下中のぷよがこのセルにあるかチェックし、色とクラスを上書き (プレイモードのみ)
            const puyoInFlight = currentPuyoCoords.find(p => p.x === x && p.y === y);
            
            if (puyoInFlight) {
                // 操作中のぷよはゴーストや盤面上のぷよを上書き
                cellColor = puyoInFlight.color; 
                puyoClasses = `puyo puyo-${cellColor}`; 
            }
            
            // 3. 盤面上の既存のぷよ、または空セル
            if (!puyoGhost && !puyoInFlight) {
                if (cellColor === COLORS.EMPTY) {
                    puyoClasses = `puyo puyo-0`;
                } else {
                    puyoClasses = `puyo puyo-${cellColor}`;
                }
            }
            
            puyoElement.className = puyoClasses;
            boardElement.appendChild(puyoElement);
        }
    }

    if (gameState === 'playing') {
        renderPlayNextPuyo();
    } else if (gameState === 'editing') {
        renderEditNextPuyos(); 
    }
}

function renderPlayNextPuyo() {
    const next1Element = document.getElementById('next-puyo-1');
    const next2Element = document.getElementById('next-puyo-2');
    
    if (!next1Element || !next2Element) return;

    next1Element.innerHTML = '';
    next2Element.innerHTML = '';

    const createPuyo = (color) => {
        let puyo = document.createElement('div');
        puyo.className = `puyo puyo-${color}`;
        return puyo;
    };
    
    // Next 1: 次に落ちてくるぷよ (nextPuyoColors[0])
    if (nextPuyoColors.length >= 1) {
        const [c1_1, c1_2] = nextPuyoColors[0];
        // ぷよを横に並べるために2つ追加
        next1Element.appendChild(createPuyo(c1_1)); 
        next1Element.appendChild(createPuyo(c1_2)); 
    }

    // Next 2: その次に落ちてくるぷよ (nextPuyoColors[1])
    if (nextPuyoColors.length >= 2) {
        const [c2_1, c2_2] = nextPuyoColors[1];
        // ぷよを横に並べるために2つ追加
        next2Element.appendChild(createPuyo(c2_1)); 
        next2Element.appendChild(createPuyo(c2_2)); 
    }
}

/**
 * エディットモードのネクスト描画 (タップイベントの組み込み)
 */
function renderEditNextPuyos() {
    const slots = [document.getElementById('edit-next-1'), document.getElementById('edit-next-2')];
    
    const createPuyo = (color, listIndex, puyoIndex) => {
        let puyo = document.createElement('div');
        puyo.className = `puyo puyo-${color}`;
        
        // 個々のぷよにクリックイベントを設定
        puyo.addEventListener('click', (event) => {
            event.stopPropagation(); 
            if (gameState !== 'editing') return;
            
            if (editingNextPuyos.length > listIndex) {
                // 選択中の色を反映
                editingNextPuyos[listIndex][puyoIndex] = currentEditColor; 
                selectPaletteColor(currentEditColor);
                renderEditNextPuyos(); 
            }
        });
        
        return puyo;
    };
    
    slots.forEach((slot, listIndex) => { 
        if (!slot) return;
        slot.innerHTML = '';
        if (editingNextPuyos[listIndex]) {
            const [c1, c2] = editingNextPuyos[listIndex];
            slot.appendChild(createPuyo(c1, listIndex, 0)); 
            slot.appendChild(createPuyo(c2, listIndex, 1)); 
        }
    });
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
            rotatePuyoCW(); 
            break;
        case 'x':
        case 'X':
            rotatePuyoCCW(); 
            break;
        case 'ArrowDown':
            movePuyo(0, -1); 
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
    // 画面サイズ変更時にもモバイルコントロールの表示をチェック
    window.addEventListener('resize', checkMobileControlsVisibility);
});
