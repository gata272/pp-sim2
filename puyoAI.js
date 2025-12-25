/**
 * PuyoPuyo AI Module
 * ぷよぷよの最適な設置場所を探索するAIプログラム
 */

const PuyoAI = (function() {
    const WIDTH = 6;
    const HEIGHT = 14;
    const COLORS = { EMPTY: 0, RED: 1, BLUE: 2, GREEN: 3, YELLOW: 4, GARBAGE: 5 };

    /**
     * 盤面のディープコピーを作成
     */
    function copyBoard(board) {
        return board.map(row => [...row]);
    }

    /**
     * 指定した位置にぷよを設置し、自由落下させる
     */
    function dropPuyo(board, x, color) {
        if (x < 0 || x >= WIDTH) return false;
        for (let y = 0; y < HEIGHT; y++) {
            if (board[y][x] === COLORS.EMPTY) {
                board[y][x] = color;
                return true;
            }
        }
        return false; // 溢れた場合
    }

    /**
     * 連鎖をシミュレーションし、最大連鎖数と消えたぷよ数を返す
     */
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

            // 落下処理
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
     * 盤面の評価スコアを計算する
     */
    function evaluateBoard(board) {
        let score = 0;
        let visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));

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
                    // 連結ボーナス: 2連結=10, 3連結=50
                    if (groupSize === 2) score += 10;
                    if (groupSize === 3) score += 50;
                }
                
                // 高さペナルティ
                if (color !== COLORS.EMPTY) {
                    score -= y * 2;
                    // 中央付近の高さは特に制限
                    if (x === 2 || x === 3) score -= y * 5;
                }
            }
        }
        return score;
    }

    /**
     * 公開メソッド: 最適な設置場所を返す
     */
    return {
        getBestMove: function(currentBoard, axisColor, childColor) {
            let bestScore = -Infinity;
            let bestMove = { x: 2, rotation: 0 };

            // 全ての回転と位置を試す (0:上, 1:右, 2:下, 3:左)
            for (let r = 0; r < 4; r++) {
                for (let x = 0; x < WIDTH; x++) {
                    let tempBoard = copyBoard(currentBoard);
                    let success = false;

                    // 回転に応じた設置
                    if (r === 0) { // 子が上
                        success = dropPuyo(tempBoard, x, axisColor) && dropPuyo(tempBoard, x, childColor);
                    } else if (r === 1) { // 子が右
                        if (x + 1 < WIDTH) {
                            success = dropPuyo(tempBoard, x, axisColor) && dropPuyo(tempBoard, x + 1, childColor);
                        }
                    } else if (r === 2) { // 子が下
                        success = dropPuyo(tempBoard, x, childColor) && dropPuyo(tempBoard, x, axisColor);
                    } else if (r === 3) { // 子が左
                        if (x - 1 >= 0) {
                            success = dropPuyo(tempBoard, x, axisColor) && dropPuyo(tempBoard, x - 1, childColor);
                        }
                    }

                    if (success) {
                        // 連鎖シミュレーション
                        let result = simulateChains(tempBoard);
                        let score = result.chains * 1000 + result.cleared * 10 + evaluateBoard(result.finalBoard);

                        if (score > bestScore) {
                            bestScore = score;
                            bestMove = { x: x, rotation: r };
                        }
                    }
                }
            }
            return bestMove;
        }
    };
})();

// ブラウザ環境とNode環境の両方に対応
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PuyoAI;
}
