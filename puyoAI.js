/**
 * PuyoPuyo AI Module v4 (Special Rule Aware)
 * 14列目自動削除、13列目非連鎖判定を認知した最大連鎖特化型AI
 */

const PuyoAI = (function() {
    const WIDTH = 6;
    const HEIGHT = 14;
    const COLORS = { EMPTY: 0, RED: 1, BLUE: 2, GREEN: 3, YELLOW: 4, GARBAGE: 5 };

    function copyBoard(board) {
        return board.map(row => [...row]);
    }

    /**
     * ぷよを設置する。14列目に到達した場合は削除される仕様を反映。
     */
    function dropPuyo(board, x, color) {
        if (x < 0 || x >= WIDTH) return false;
        for (let y = 0; y < HEIGHT; y++) {
            if (board[y][x] === COLORS.EMPTY) {
                // 14列目(Y=13)に置かれた場合は、実質的に削除される（EMPTYのままにするか、一時的に置いて消す）
                if (y === 13) {
                    return true; // 設置は成功したが、盤面には残らない
                }
                board[y][x] = color;
                return true;
            }
        }
        return false;
    }

    /**
     * 連鎖シミュレーション。13列目(Y=12)は連鎖判定に含まれない仕様を反映。
     */
    function simulateChains(board) {
        let totalChains = 0;
        let tempBoard = copyBoard(board);

        while (true) {
            let cleared = false;
            let visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
            let toClear = [];

            // 13列目(Y=12)と14列目(Y=13)は連鎖判定から除外するため、Y < 12 までを探索
            for (let y = 0; y < 12; y++) {
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
                                // 13列目(ny=12)以上には繋がらないように制限
                                if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < 12 &&
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
            
            // 落下処理（13列目以降も落下はする）
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

    function evaluateMaxChainPotential(board) {
        let maxChains = 0;
        for (let x = 0; x < WIDTH; x++) {
            for (let color = 1; color <= 4; color++) {
                let tempBoard = copyBoard(board);
                if (dropPuyo(tempBoard, x, color)) {
                    let result = simulateChains(tempBoard);
                    if (result.chains > maxChains) maxChains = result.chains;
                }
            }
        }
        return maxChains;
    }

    function evaluateBoardStructure(board) {
        let score = 0;
        let heights = Array(WIDTH).fill(0);

        for (let x = 0; x < WIDTH; x++) {
            for (let y = HEIGHT - 1; y >= 0; y--) {
                if (board[y][x] !== COLORS.EMPTY) {
                    heights[x] = y + 1;
                    break;
                }
            }
        }

        // 13列目(Y=12)にぷよがある場合のペナルティ（連鎖にならないため）
        for (let x = 0; x < WIDTH; x++) {
            if (board[12][x] !== COLORS.EMPTY) score -= 1000;
        }

        // 3連結評価（12列目以下のみ）
        let visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
        for (let y = 0; y < 12; y++) {
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
                            if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < 12 && !visited[ny][nx] && board[ny][nx] === color) {
                                visited[ny][nx] = true;
                                stack.push([nx, ny]);
                            }
                        });
                    }
                    if (groupSize === 3) score += 500;
                    if (groupSize === 2) score += 100;
                }
            }
        }

        // 窒息回避（3列目、4列目の12列目以上を極端に嫌う）
        if (heights[2] >= 12) score -= 10000;
        if (heights[3] >= 12) score -= 10000;
        
        return score;
    }

    function getPossibleMoves(board, c1, c2) {
        let moves = [];
        for (let r = 0; r < 4; r++) {
            for (let x = 0; x < WIDTH; x++) {
                let tempBoard = copyBoard(board);
                let success = false;
                // 設置シミュレーション
                if (r === 0) success = dropPuyo(tempBoard, x, c1) && dropPuyo(tempBoard, x, c2);
                else if (r === 1 && x + 1 < WIDTH) success = dropPuyo(tempBoard, x, c1) && dropPuyo(tempBoard, x + 1, c2);
                else if (r === 2) success = dropPuyo(tempBoard, x, c2) && dropPuyo(tempBoard, x, c1);
                else if (r === 3 && x - 1 >= 0) success = dropPuyo(tempBoard, x, c1) && dropPuyo(tempBoard, x - 1, c2);
                
                if (success) {
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
                let secondMoves = getPossibleMoves(m1.board, nextC1, nextC2);
                let bestSecondPotential = -Infinity;

                for (let m2 of secondMoves) {
                    let potential = evaluateMaxChainPotential(m2.board);
                    let structure = evaluateBoardStructure(m2.board);
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
