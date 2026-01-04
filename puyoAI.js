/**
 * PuyoAI v8 - Ultimate Chain Edition
 * 最大連鎖数の構築を絶対的な最優先事項とし、
 * 全色シミュレーションによって将来のポテンシャルを評価する。
 */
const PuyoAI = (function() {
    const WIDTH = 6;
    const HEIGHT = 14;
    const COLORS = [1, 2, 3, 4]; // 赤, 青, 緑, 黄

    /**
     * 盤面のポテンシャル（最大連鎖期待値）を評価する
     */
    function evaluatePotential(board) {
        let maxChainFound = 0;
        
        // 盤面の各列に対して、全色のぷよを1つずつ置いてみて、
        // その結果発生する最大連鎖数をシミュレートする
        for (let x = 0; x < WIDTH; x++) {
            for (let color of COLORS) {
                let tempBoard = board.map(row => [...row]);
                // 1つ置いてみる
                let y = 0;
                while (y < 12 && tempBoard[y][x] !== 0) y++;
                if (y >= 12) continue;
                
                tempBoard[y][x] = color;
                let res = simulateChain(tempBoard);
                if (res.chains > maxChainFound) {
                    maxChainFound = res.chains;
                }
            }
        }
        return maxChainFound;
    }

    function simulateChain(board) {
        let tempBoard = board.map(row => [...row]);
        let totalChains = 0;
        while (true) {
            let chains = processStep(tempBoard);
            if (chains === 0) break;
            totalChains += chains;
        }
        return { chains: totalChains };
    }

    function processStep(board) {
        let visited = Array.from({ length: 12 }, () => Array(WIDTH).fill(false));
        let toExplode = [];
        
        for (let y = 0; y < 12; y++) {
            for (let x = 0; x < WIDTH; x++) {
                if (board[y][x] !== 0 && !visited[y][x]) {
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
                    if (group.length >= 4) toExplode.push(...group);
                }
            }
        }
        
        if (toExplode.length === 0) return 0;
        toExplode.forEach(p => board[p.y][p.x] = 0);
        applyGravity(board);
        return 1;
    }

    function applyGravity(board) {
        for (let x = 0; x < WIDTH; x++) {
            let writeY = 0;
            for (let readY = 0; readY < 12; readY++) {
                if (board[readY][x] !== 0) {
                    board[writeY][x] = board[readY][x];
                    if (writeY !== readY) board[readY][x] = 0;
                    writeY++;
                }
            }
        }
    }

    function isReachable(board, targetX) {
        const startX = 2;
        const direction = targetX > startX ? 1 : -1;
        for (let x = startX; x !== targetX; x += direction) {
            if (board[12][x] !== 0) return false;
        }
        return true;
    }

    function getBestMove(board, axisColor, childColor, nextAxisColor, nextChildColor) {
        let bestScore = -Infinity;
        let bestMove = { x: 2, rotation: 0 };

        for (let x = 0; x < WIDTH; x++) {
            for (let rot = 0; rot < 4; rot++) {
                if (!isReachable(board, x)) continue;

                let tempBoard = board.map(row => [...row]);
                if (!placePuyo(tempBoard, x, rot, axisColor, childColor)) continue;

                // 1手目の連鎖
                let res1 = simulateChain(tempBoard);
                // 評価 = (発生した連鎖数 * 100) + (将来の最大連鎖ポテンシャル * 1000)
                // 今すぐ消すよりも、将来大きな連鎖になる形を圧倒的に優先する
                let potential = evaluatePotential(res1.finalBoard || tempBoard);
                let score = (res1.chains * 100) + (potential * 1000);

                // 2手先読み
                if (nextAxisColor && nextChildColor) {
                    let nextBestPotential = 0;
                    for (let nx = 0; nx < WIDTH; nx++) {
                        if (!isReachable(res1.finalBoard || tempBoard, nx)) continue;
                        let nextBoard = (res1.finalBoard || tempBoard).map(row => [...row]);
                        if (placePuyo(nextBoard, nx, 0, nextAxisColor, nextChildColor)) {
                            let p = evaluatePotential(nextBoard);
                            if (p > nextBestPotential) nextBestPotential = p;
                        }
                    }
                    score += nextBestPotential * 500;
                }

                // 窒息回避（最低限）
                if (tempBoard[11][2] !== 0) score -= 1000000;

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
        coords.push({x: x, y: 13, color: axisColor});
        if (rot === 0) coords.push({x: x, y: 14, color: childColor});
        else if (rot === 1) coords.push({x: x + 1, y: 13, color: childColor});
        else if (rot === 2) coords.push({x: x, y: 12, color: childColor});
        else if (rot === 3) coords.push({x: x - 1, y: 13, color: childColor});

        for (let p of coords) if (p.x < 0 || p.x >= WIDTH) return false;

        coords.sort((a, b) => a.y - b.y);
        for (let p of coords) {
            let curY = p.y;
            while (curY > 0 && board[curY-1][p.x] === 0) curY--;
            if (curY < 14) board[curY][p.x] = p.color;
        }
        for (let i = 0; i < WIDTH; i++) board[13][i] = 0;
        return true;
    }

    return { getBestMove };
})();

window.PuyoAI = PuyoAI;
