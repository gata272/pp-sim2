/**
 * PuyoAI v7 - Mobility-Aware Edition
 * 中央列(2-5列)の13段目が埋まることによる移動制限を考慮し、
 * 将来の移動不能状態を回避するアルゴリズム。
 */
const PuyoAI = (function() {
    const WIDTH = 6;
    const HEIGHT = 14; // 14列目まで考慮
    const COLORS = { EMPTY: 0, RED: 1, BLUE: 2, GREEN: 3, YELLOW: 4, GARBAGE: 5 };

    // 評価定数
    const SCORE_WEIGHT = 1;
    const CHAIN_WEIGHT = 1000;
    const CONNECTION_WEIGHT = 10;
    const HEIGHT_PENALTY = 20;
    const DEAD_END_PENALTY = 1000000; // 移動不能状態への極大ペナルティ

    /**
     * 指定された位置・回転が、現在の盤面で物理的に到達可能か判定する
     */
    function isReachable(board, targetX, targetRotation) {
        // 簡易的な経路探索: 
        // 1. 中央(X=2)の最上段(Y=12 or 13)から開始
        // 2. ターゲットのX座標まで横移動が可能かチェック
        // 3. 2-5列目の13段目が埋まっている場合、それを越えて1, 6列目には行けない
        
        const startX = 2;
        const direction = targetX > startX ? 1 : -1;
        
        for (let x = startX; x !== targetX; x += direction) {
            // 13段目(index 12)が埋まっているかチェック
            // シミュレーターの仕様上、ここが壁になる
            if (board[12][x] !== COLORS.EMPTY) {
                return false;
            }
        }
        return true;
    }

    /**
     * 盤面の評価関数
     */
    function evaluateBoard(board) {
        let score = 0;
        
        // 1. 連鎖ポテンシャルと連結数
        for (let x = 0; x < WIDTH; x++) {
            for (let y = 0; y < 12; y++) { // 13段目以上は評価対象外
                const color = board[y][x];
                if (color === COLORS.EMPTY) continue;
                
                // 連結チェック（簡易）
                let connections = 0;
                if (x > 0 && board[y][x-1] === color) connections++;
                if (x < WIDTH - 1 && board[y][x+1] === color) connections++;
                if (y > 0 && board[y-1][x] === color) connections++;
                
                score += connections * CONNECTION_WEIGHT;
                score -= y * HEIGHT_PENALTY; // 高い位置にあるほどペナルティ
            }
        }

        // 2. 中央高積みペナルティ（移動制限の予兆）
        // 2-5列目の12段目(index 11)や13段目(index 12)が埋まりそうな場合
        for (let x = 1; x <= 4; x++) {
            if (board[11][x] !== COLORS.EMPTY) score -= 500;
            if (board[12][x] !== COLORS.EMPTY) score -= 2000;
        }

        // 3. 窒息点(3列目12段目)のチェック
        if (board[11][2] !== COLORS.EMPTY) return -DEAD_END_PENALTY;

        return score;
    }

    /**
     * 連鎖シミュレーション
     */
    function simulateChain(board) {
        let tempBoard = board.map(row => [...row]);
        let totalChains = 0;
        let totalPuyos = 0;
        
        while (true) {
            let { chains, puyos } = processStep(tempBoard);
            if (chains === 0) break;
            totalChains += chains;
            totalPuyos += puyos;
        }
        
        return { chains: totalChains, puyos: totalPuyos, finalBoard: tempBoard };
    }

    function processStep(board) {
        let connected = findConnections(board);
        if (connected.length === 0) return { chains: 0, puyos: 0 };
        
        let puyos = 0;
        connected.forEach(group => {
            puyos += group.length;
            group.forEach(p => board[p.y][p.x] = COLORS.EMPTY);
        });
        
        applyGravity(board);
        return { chains: 1, puyos };
    }

    function findConnections(board) {
        let visited = Array.from({ length: 12 }, () => Array(WIDTH).fill(false));
        let groups = [];
        
        for (let y = 0; y < 12; y++) {
            for (let x = 0; x < WIDTH; x++) {
                if (board[y][x] !== COLORS.EMPTY && !visited[y][x]) {
                    let group = [];
                    let color = board[y][x];
                    let stack = [{x, y}];
                    visited[y][x] = true;
                    
                    while (stack.length > 0) {
                        let p = stack.pop();
                        group.push(p);
                        [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx, dy]) => {
                            let nx = p.x + dx, ny = p.y + dy;
                            if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < 12 && 
                                board[ny][nx] === color && !visited[ny][nx]) {
                                visited[ny][nx] = true;
                                stack.push({x: nx, y: ny});
                            }
                        });
                    }
                    if (group.length >= 4) groups.push(group);
                }
            }
        }
        return groups;
    }

    function applyGravity(board) {
        for (let x = 0; x < WIDTH; x++) {
            let writeY = 0;
            for (let readY = 0; readY < 12; readY++) {
                if (board[readY][x] !== COLORS.EMPTY) {
                    board[writeY][x] = board[readY][x];
                    if (writeY !== readY) board[readY][x] = COLORS.EMPTY;
                    writeY++;
                }
            }
        }
    }

    /**
     * 最適な手を探索する
     */
    function getBestMove(board, axisColor, childColor, nextAxisColor, nextChildColor) {
        let bestScore = -Infinity;
        let bestMove = { x: 2, rotation: 0 };

        // 全ての移動・回転パターンを試行
        for (let x = 0; x < WIDTH; x++) {
            for (let rot = 0; rot < 4; rot++) {
                // 1. 到達可能性チェック
                if (!isReachable(board, x, rot)) continue;

                let tempBoard = board.map(row => [...row]);
                if (!placePuyo(tempBoard, x, rot, axisColor, childColor)) continue;

                // 1手目の連鎖シミュレーション
                let res1 = simulateChain(tempBoard);
                let score = res1.chains * CHAIN_WEIGHT + evaluateBoard(res1.finalBoard);

                // 2手先読み（ネクストがある場合）
                if (nextAxisColor && nextChildColor) {
                    let nextBestScore = -Infinity;
                    for (let nx = 0; nx < WIDTH; nx++) {
                        for (let nrot = 0; nrot < 4; nrot++) {
                            if (!isReachable(res1.finalBoard, nx, nrot)) continue;
                            
                            let nextBoard = res1.finalBoard.map(row => [...row]);
                            if (!placePuyo(nextBoard, nx, nrot, nextAxisColor, nextChildColor)) continue;
                            
                            let res2 = simulateChain(nextBoard);
                            let nScore = res2.chains * CHAIN_WEIGHT + evaluateBoard(res2.finalBoard);
                            if (nScore > nextBestScore) nextBestScore = nScore;
                        }
                    }
                    score += nextBestScore * 0.5; // 2手目は半分重み付け
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestMove = { x, rotation: rot };
                }
            }
        }
        return bestMove;
    }

    function placePuyo(board, x, rot, axisColor, childColor) {
        let coords = [];
        // 0:上, 1:右, 2:下, 3:左
        coords.push({x: x, y: 13, color: axisColor});
        if (rot === 0) coords.push({x: x, y: 14, color: childColor});
        else if (rot === 1) coords.push({x: x + 1, y: 13, color: childColor});
        else if (rot === 2) coords.push({x: x, y: 12, color: childColor});
        else if (rot === 3) coords.push({x: x - 1, y: 13, color: childColor});

        // 範囲外チェック
        for (let p of coords) {
            if (p.x < 0 || p.x >= WIDTH) return false;
        }

        // 落下処理
        coords.sort((a, b) => a.y - b.y);
        for (let p of coords) {
            let curY = p.y;
            while (curY > 0 && board[curY-1][p.x] === COLORS.EMPTY) {
                curY--;
            }
            if (curY < 14) {
                board[curY][p.x] = p.color;
            }
        }
        
        // 14列目クリア
        for (let i = 0; i < WIDTH; i++) board[13][i] = COLORS.EMPTY;
        
        return true;
    }

    return { getBestMove };
})();

if (typeof module !== 'undefined') module.exports = PuyoAI;
window.PuyoAI = PuyoAI;
