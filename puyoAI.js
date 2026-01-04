/**
 * PuyoAI v10 - Special Rule Edition
 * 14段目への設置条件：
 * 「12段目まである列と、13段目まである列がそれぞれ最低1つ存在する時のみ、14段目に置ける」
 * という特殊ルールを認知したアルゴリズム。
 */
const PuyoAI = (function() {
    const WIDTH = 6;
    const HEIGHT = 14;
    const COLORS = [1, 2, 3, 4];

    /**
     * 14段目(Y=13)への設置が許可されているかチェックする
     */
    function is14thRowAllowed(board) {
        let has12 = false;
        let has13 = false;
        
        for (let x = 0; x < WIDTH; x++) {
            let height = 0;
            while (height < 14 && board[height][x] !== 0) height++;
            
            if (height === 12) has12 = true;
            if (height === 13) has13 = true;
        }
        
        return has12 && has13;
    }

    function evaluatePureChainPotential(board) {
        let maxChain = 0;
        const allowed14 = is14thRowAllowed(board);

        for (let x = 0; x < WIDTH; x++) {
            for (let color of COLORS) {
                let tempBoard = board.map(row => [...row]);
                let y = 0;
                while (y < 14 && tempBoard[y][x] !== 0) y++;
                
                // 14段目(index 13)に置こうとする場合、特殊条件をチェック
                if (y === 13 && !allowed14) continue;
                if (y >= 14) continue;
                
                tempBoard[y][x] = color;
                let res = simulatePureChain(tempBoard);
                if (res.chains > maxChain) {
                    maxChain = res.chains;
                }
            }
        }
        return maxChain;
    }

    function simulatePureChain(board) {
        let tempBoard = board.map(row => [...row]);
        let chainCount = 0;
        while (true) {
            let exploded = processStep(tempBoard);
            if (!exploded) break;
            chainCount++;
        }
        return { chains: chainCount, finalBoard: tempBoard };
    }

    function processStep(board) {
        let visited = Array.from({ length: 12 }, () => Array(WIDTH).fill(false));
        let exploded = false;
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
                    if (group.length >= 4) {
                        group.forEach(p => board[p.y][p.x] = 0);
                        exploded = true;
                    }
                }
            }
        }
        if (exploded) applyGravity(board);
        return exploded;
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
        let bestChainScore = -1;
        let bestMove = { x: 2, rotation: 0 };
        const allowed14 = is14thRowAllowed(board);

        for (let x = 0; x < WIDTH; x++) {
            for (let rot = 0; rot < 4; rot++) {
                if (!isReachable(board, x)) continue;

                let tempBoard = board.map(row => [...row]);
                
                // 14段目への設置が含まれるかチェック
                let willUse14 = false;
                if (rot === 0) willUse14 = true; // 子ぷよが上
                // 他の回転でも、高さによっては14段目を使う可能性がある
                let h = 0; while(h < 14 && tempBoard[h][x] !== 0) h++;
                if (h >= 13) willUse14 = true;

                if (willUse14 && !allowed14) continue;

                if (!placePuyo(tempBoard, x, rot, axisColor, childColor)) continue;

                let res1 = simulatePureChain(tempBoard);
                let potential = evaluatePureChainPotential(res1.finalBoard);
                let totalChainScore = (res1.chains * 100) + (potential * 1000);

                if (nextAxisColor && nextChildColor) {
                    let nextMaxPotential = 0;
                    for (let nx = 0; nx < WIDTH; nx++) {
                        if (!isReachable(res1.finalBoard, nx)) continue;
                        let nextBoard = res1.finalBoard.map(row => [...row]);
                        if (placePuyo(nextBoard, nx, 0, nextAxisColor, nextChildColor)) {
                            let p = evaluatePureChainPotential(nextBoard);
                            if (p > nextMaxPotential) nextMaxPotential = p;
                        }
                    }
                    totalChainScore += nextMaxPotential * 500;
                }

                if (tempBoard[11][2] !== 0) totalChainScore = -1000000;

                if (totalChainScore > bestChainScore) {
                    bestChainScore = totalChainScore;
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
