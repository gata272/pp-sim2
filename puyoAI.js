/**
 * PuyoAI.js (v13) - 3手先・潜在連鎖最大化モデル
 * 3手後の盤面において「次に1つ置いた時に発生する最大連鎖数」を最大化する
 */

const PuyoAI = (function() {
    const WIDTH = 6;
    const HEIGHT = 14;
    const COLORS = [1, 2, 3, 4]; // 赤, 青, 黄, 緑

    /**
     * 盤面の潜在的な最大連鎖数を評価
     */
    function evaluatePotential(board) {
        // 1. 3列目の窒息チェック（最優先）
        let h3 = 0;
        while (h3 < HEIGHT && board[h3][2] !== 0) h3++;
        if (h3 >= 11) return -10000000;

        let maxChain = 0;
        
        // 3手後の盤面で、各色を各列に1つ置いてみて、最大連鎖を調べる
        for (let x = 0; x < WIDTH; x++) {
            let h = 0;
            while (h < HEIGHT && board[h][x] !== 0) h++;
            if (h >= 12) continue;

            for (let color of COLORS) {
                let tempBoard = board.map(row => [...row]);
                tempBoard[h][x] = color;
                let result = simulatePureChain(tempBoard);
                if (result.chains > maxChain) {
                    maxChain = result.chains;
                }
            }
        }

        // 潜在連鎖数を指数関数的に評価
        let score = Math.pow(maxChain, 6) * 1000;

        // 連結ボーナス（連鎖の種を維持するため）
        score += countConnections(board);

        return score;
    }

    function countConnections(board) {
        let score = 0;
        let visited = Array.from({ length: 12 }, () => Array(WIDTH).fill(false));
        for (let y = 0; y < 12; y++) {
            for (let x = 0; x < WIDTH; x++) {
                if (board[y][x] !== 0 && !visited[y][x]) {
                    let color = board[y][x];
                    let groupSize = 0;
                    let stack = [{x, y}];
                    visited[y][x] = true;
                    while (stack.length > 0) {
                        let p = stack.pop();
                        groupSize++;
                        [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx, dy]) => {
                            let nx = p.x + dx, ny = p.y + dy;
                            if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < 12 && 
                                board[ny][nx] === color && !visited[ny][nx]) {
                                visited[ny][nx] = true;
                                stack.push({x: nx, y: ny});
                            }
                        });
                    }
                    if (groupSize === 3) score += 5000;
                    if (groupSize === 2) score += 500;
                }
            }
        }
        return score;
    }

    function simulatePureChain(board) {
        let totalChains = 0;
        while (true) {
            let toErase = [];
            let visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
            for (let y = 0; y < HEIGHT; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    if (board[y][x] !== 0 && !visited[y][x]) {
                        let color = board[y][x];
                        let group = [];
                        let stack = [{x, y}];
                        visited[y][x] = true;
                        while (stack.length > 0) {
                            let p = stack.pop();
                            group.push(p);
                            [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx, dy]) => {
                                let nx = p.x + dx, ny = p.y + dy;
                                if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT && 
                                    board[ny][nx] === color && !visited[ny][nx]) {
                                    visited[ny][nx] = true;
                                    stack.push({x: nx, y: ny});
                                }
                            });
                        }
                        if (group.length >= 4) toErase.push(...group);
                    }
                }
            }
            if (toErase.length === 0) break;
            totalChains++;
            toErase.forEach(p => board[p.y][p.x] = 0);
            for (let x = 0; x < WIDTH; x++) {
                let writeY = 0;
                for (let readY = 0; readY < HEIGHT; readY++) {
                    if (board[readY][x] !== 0) {
                        board[writeY][x] = board[readY][x];
                        if (writeY !== readY) board[readY][x] = 0;
                        writeY++;
                    }
                }
            }
        }
        return { chains: totalChains };
    }

    function getBestMove(board, nextPuyos) {
        let bestScore = -Infinity;
        let bestMove = { x: 2, rotation: 0 };

        // 1手目の全パターン
        for (let x1 = 0; x1 < WIDTH; x1++) {
            for (let r1 = 0; r1 < 4; r1++) {
                let board1 = applyMove(board, nextPuyos[0], nextPuyos[1], x1, r1);
                if (!board1) continue;

                let currentMaxScore = -Infinity;

                // 2手目の全パターン
                for (let x2 = 0; x2 < WIDTH; x2++) {
                    for (let r2 = 0; r2 < 4; r2++) {
                        let board2 = applyMove(board1, nextPuyos[2], nextPuyos[3], x2, r2);
                        if (!board2) continue;

                        // 3手目の全パターン
                        for (let x3 = 0; x3 < WIDTH; x3++) {
                            for (let r3 = 0; r3 < 4; r3++) {
                                let board3 = applyMove(board2, nextPuyos[4], nextPuyos[5], x3, r3);
                                if (!board3) continue;

                                // 3手後の「潜在的な最大連鎖数」を評価
                                let score = evaluatePotential(board3);
                                if (score > currentMaxScore) currentMaxScore = score;
                            }
                        }
                    }
                }

                if (currentMaxScore > bestScore) {
                    bestScore = currentMaxScore;
                    bestMove = { x: x1, rotation: r1 };
                }
            }
        }
        return bestMove;
    }

    function applyMove(board, p1, p2, x, r) {
        let tempBoard = board.map(row => [...row]);
        let pos1 = { x: x, y: -1 }, pos2 = { x: x, y: -1 };
        
        if (r === 0) { pos1.x = x; pos2.x = x; pos1.y = 1; pos2.y = 0; }
        else if (r === 1) { pos1.x = x; pos2.x = x + 1; pos1.y = 0; pos2.y = 0; }
        else if (r === 2) { pos1.x = x; pos2.x = x; pos1.y = 0; pos2.y = 1; }
        else if (r === 3) { pos1.x = x; pos2.x = x - 1; pos1.y = 0; pos2.y = 0; }
        
        if (pos1.x < 0 || pos1.x >= WIDTH || pos2.x < 0 || pos2.x >= WIDTH) return null;
        
        let h1 = 0; while (h1 < HEIGHT && tempBoard[h1][pos1.x] !== 0) h1++;
        let h2 = 0; while (h2 < HEIGHT && tempBoard[h2][pos2.x] !== 0) h2++;
        
        if (h1 >= 12 || h2 >= 12) return null;
        
        if (pos1.x === pos2.x) {
            tempBoard[h1][pos1.x] = (r === 0) ? p2 : p1;
            tempBoard[h1+1][pos1.x] = (r === 0) ? p1 : p2;
        } else {
            tempBoard[h1][pos1.x] = p1;
            tempBoard[h2][pos2.x] = p2;
        }
        return tempBoard;
    }

    return { getBestMove: getBestMove };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PuyoAI;
}
