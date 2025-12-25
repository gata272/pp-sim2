/**
 * PuyoPuyo AI Module v3 (Max Chain Optimized)
 * スコアを無視し、最大連鎖数の構築のみを追求する特化型AI
 */

const PuyoAI = (function() {
    const WIDTH = 6;
    const HEIGHT = 14;
    const COLORS = { EMPTY: 0, RED: 1, BLUE: 2, GREEN: 3, YELLOW: 4, GARBAGE: 5 };

    function copyBoard(board) {
        return board.map(row => [...row]);
    }

    function dropPuyo(board, x, color) {
        if (x < 0 || x >= WIDTH) return false;
        for (let y = 0; y < HEIGHT; y++) {
            if (board[y][x] === COLORS.EMPTY) {
                board[y][x] = color;
                return true;
            }
        }
        return false;
    }

    function simulateChains(board) {
        let totalChains = 0;
        let tempBoard = copyBoard(board);

        while (true) {
            let cleared = false;
            let visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
            let toClear = [];

            for (let y = 0; y < HEIGHT; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    if (tempBoard[y][x] !== COLORS.EMPTY && tempBoard[y][x] !== COLORS.GARBAGE && !visited[y][x]) {
                        let group = [];
                        let color = tempBoard[y][x];
                        let stack = [[x, y]];
                        visited[y][x] = true;
                        while (stack.length > 0) {
                            let [cx, cy] = stack.pop();
                            group.push([cx, cy]);
                            [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dx, dy]) => {
                                let nx = cx + dx, ny = cy + dy;
                                if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT &&
                                    !visited[ny][nx] && tempBoard[ny][nx] === color) {
                                    visited[ny][nx] = true;
                                    stack.push([nx, ny]);
                                }
                            });
                        }
                        if (group.length >= 4) {
                            toClear.push(...group);
                            cleared = true;
                        }
                    }
                }
            }
            if (!cleared) break;
            totalChains++;
            toClear.forEach(([x, y]) => { tempBoard[y][x] = COLORS.EMPTY; });
            for (let x = 0; x < WIDTH; x++) {
                let writeY = 0;
                for (let readY = 0; readY < HEIGHT; readY++) {
                    if (tempBoard[readY][x] !== COLORS.EMPTY) {
                        tempBoard[writeY][x] = tempBoard[readY][x];
                        if (writeY !== readY) tempBoard[readY][x] = COLORS.EMPTY;
                        writeY++;
                    }
                }
            }
        }
        return { chains: totalChains, finalBoard: tempBoard };
    }

    /**
     * 盤面の「連鎖ポテンシャル」を極限まで評価する
     * どこにどの色を置いても、最も連鎖が伸びる可能性を探す
     */
    function evaluateMaxChainPotential(board) {
        let maxChains = 0;
        // 全ての列に、全ての色のぷよを1つ置いてみて、発生する連鎖の最大値を求める
        for (let x = 0; x < WIDTH; x++) {
            for (let color = 1; color <= 4; color++) {
                let tempBoard = copyBoard(board);
                if (dropPuyo(tempBoard, x, color)) {
                    let result = simulateChains(tempBoard);
                    if (result.chains > maxChains) {
                        maxChains = result.chains;
                    }
                }
            }
        }
        return maxChains;
    }

    function evaluateBoardStructure(board) {
        let score = 0;
        let heights = Array(WIDTH).fill(0);
        let colorCounts = {};

        for (let x = 0; x < WIDTH; x++) {
            for (let y = HEIGHT - 1; y >= 0; y--) {
                if (board[y][x] !== COLORS.EMPTY) {
                    heights[x] = y + 1;
                    let c = board[y][x];
                    colorCounts[c] = (colorCounts[c] || 0) + 1;
                    break;
                }
            }
        }

        // 3連結（連鎖の準備）を非常に高く評価
        let visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                let color = board[y][x];
                if (color !== COLORS.EMPTY && !visited[y][x]) {
                    let groupSize = 0;
                    let stack = [[x, y]];
                    visited[y][x] = true;
                    while (stack.length > 0) {
                        let [cx, cy] = stack.pop();
                        groupSize++;
                        [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dx, dy]) => {
                            let nx = cx + dx, ny = cy + dy;
                            if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT && !visited[ny][nx] && board[ny][nx] === color) {
                                visited[ny][nx] = true;
                                stack.push([nx, ny]);
                            }
                        });
                    }
                    if (groupSize === 3) score += 500; // 3連結は連鎖の宝
                    if (groupSize === 2) score += 100;
                }
            }
        }

        // 階段積みを意識した段差評価
        for (let x = 0; x < WIDTH - 1; x++) {
            let diff = heights[x] - heights[x+1];
            if (Math.abs(diff) === 1) score += 50; // 1段差は理想的
        }

        // 窒息ペナルティ
        if (heights[2] > 11) score -= 5000;
        
        return score;
    }

    function getPossibleMoves(board, c1, c2) {
        let moves = [];
        for (let r = 0; r < 4; r++) {
            for (let x = 0; x < WIDTH; x++) {
                let tempBoard = copyBoard(board);
                let success = false;
                if (r === 0) success = dropPuyo(tempBoard, x, c1) && dropPuyo(tempBoard, x, c2);
                else if (r === 1 && x + 1 < WIDTH) success = dropPuyo(tempBoard, x, c1) && dropPuyo(tempBoard, x + 1, c2);
                else if (r === 2) success = dropPuyo(tempBoard, x, c2) && dropPuyo(tempBoard, x, c1);
                else if (r === 3 && x - 1 >= 0) success = dropPuyo(tempBoard, x, c1) && dropPuyo(tempBoard, x - 1, c2);
                
                if (success) {
                    // 設置直後に連鎖が起きる場合はシミュレート
                    let result = simulateChains(tempBoard);
                    moves.push({ x, r, board: result.finalBoard, immediateChains: result.chains });
                }
            }
        }
        return moves;
    }

    return {
        getBestMove: function(currentBoard, c1, c2, nextC1, nextC2) {
            let bestScore = -Infinity;
            let bestMove = { x: 2, rotation: 0 };

            let firstMoves = getPossibleMoves(currentBoard, c1, c2);

            for (let m1 of firstMoves) {
                // 2手読み
                let secondMoves = getPossibleMoves(m1.board, nextC1, nextC2);
                let bestSecondPotential = -Infinity;

                for (let m2 of secondMoves) {
                    // この盤面で将来的に達成可能な最大連鎖数
                    let potential = evaluateMaxChainPotential(m2.board);
                    // 構造の良さ
                    let structure = evaluateBoardStructure(m2.board);
                    
                    // 今すぐ消える連鎖よりも、将来のポテンシャルを100倍重視
                    let total = (m1.immediateChains + m2.immediateChains) * 10 + potential * 1000 + structure;
                    
                    if (total > bestSecondPotential) bestSecondPotential = total;
                }

                if (secondMoves.length === 0) bestSecondPotential = -99999;

                if (bestSecondPotential > bestScore) {
                    bestScore = bestSecondPotential;
                    bestMove = { x: m1.x, rotation: m1.r };
                }
            }
            return bestMove;
        }
    };
})();
