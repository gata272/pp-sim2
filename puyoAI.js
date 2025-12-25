/**
 * PuyoPuyo AI Module v2 (High Chain Optimized)
 * 2手先読みと高度な評価関数を搭載した強化版AI
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
        let totalCleared = 0;
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
            totalCleared += toClear.length;
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
        return { chains: totalChains, cleared: totalCleared, finalBoard: tempBoard };
    }

    /**
     * 「連鎖の種」を評価：あと1つ置いたら何連鎖するか
     */
    function evaluatePotential(board) {
        let maxPotential = 0;
        for (let x = 0; x < WIDTH; x++) {
            for (let color = 1; color <= 4; color++) {
                let tempBoard = copyBoard(board);
                if (dropPuyo(tempBoard, x, color)) {
                    let result = simulateChains(tempBoard);
                    if (result.chains > maxPotential) maxPotential = result.chains;
                }
            }
        }
        return maxPotential;
    }

    function evaluateBoard(board) {
        let score = 0;
        let heights = Array(WIDTH).fill(0);
        let visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));

        for (let x = 0; x < WIDTH; x++) {
            for (let y = HEIGHT - 1; y >= 0; y--) {
                if (board[y][x] !== COLORS.EMPTY) {
                    heights[x] = y + 1;
                    break;
                }
            }
        }

        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                let color = board[y][x];
                if (color !== COLORS.EMPTY && color !== COLORS.GARBAGE && !visited[y][x]) {
                    let groupSize = 0;
                    let stack = [[x, y]];
                    visited[y][x] = true;
                    while (stack.length > 0) {
                        let [cx, cy] = stack.pop();
                        groupSize++;
                        [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dx, dy]) => {
                            let nx = cx + dx, ny = cy + dy;
                            if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT &&
                                !visited[ny][nx] && board[ny][nx] === color) {
                                visited[ny][nx] = true;
                                stack.push([nx, ny]);
                            }
                        });
                    }
                    // 連結ボーナスを強化
                    if (groupSize === 2) score += 20;
                    if (groupSize === 3) score += 150;
                }
            }
        }

        // 段差の滑らかさ
        for (let x = 0; x < WIDTH - 1; x++) {
            let diff = Math.abs(heights[x] - heights[x+1]);
            if (diff <= 1) score += 30;
            else score -= diff * 20;
        }

        // 窒息回避
        if (heights[2] > 10) score -= (heights[2] - 10) * 500;
        if (heights[3] > 10) score -= (heights[3] - 10) * 500;

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
                    let result = simulateChains(tempBoard);
                    moves.push({ x, r, board: result.finalBoard, chains: result.chains, cleared: result.cleared });
                }
            }
        }
        return moves;
    }

    return {
        getBestMove: function(currentBoard, c1, c2, nextC1, nextC2) {
            let bestScore = -Infinity;
            let bestMove = { x: 2, rotation: 0 };

            // 1手目の全パターン
            let firstMoves = getPossibleMoves(currentBoard, c1, c2);

            for (let m1 of firstMoves) {
                let currentM1Score = m1.chains * 2000 + m1.cleared * 10;
                
                // 2手目の全パターンをシミュレーション (2手先読み)
                let secondMoves = getPossibleMoves(m1.board, nextC1, nextC2);
                let bestSecondScore = -Infinity;

                for (let m2 of secondMoves) {
                    let m2Score = m2.chains * 2000 + m2.cleared * 10;
                    let finalScore = evaluateBoard(m2.board) + evaluatePotential(m2.board) * 500;
                    let totalM2Score = m2Score + finalScore;
                    if (totalM2Score > bestSecondScore) bestSecondScore = totalM2Score;
                }

                // 2手目がない場合（窒息など）のペナルティ
                if (secondMoves.length === 0) bestSecondScore = -10000;

                let totalScore = currentM1Score + bestSecondScore;
                if (totalScore > bestScore) {
                    bestScore = totalScore;
                    bestMove = { x: m1.x, rotation: m1.r };
                }
            }
            return bestMove;
        }
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PuyoAI;
}
