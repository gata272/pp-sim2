/**
 * PuyoAI.js (v11) - 連鎖尾延長・大連鎖特化モデル
 * 連鎖尾（雪崩、潜り込み、斉藤スペシャル）を核とし、15連鎖以上の超大連鎖を狙うAI
 */

const PuyoAI = (function() {
    const WIDTH = 6;
    const HEIGHT = 14;
    const COLORS = [1, 2, 3, 4, 5]; // 赤, 青, 黄, 緑, 紫

    /**
     * 14行目が使用可能かチェック（12, 13行目にぷよがある場合のみ）
     */
    function is14thRowAllowed(board) {
        let has12 = false;
        let has13 = false;
        for (let x = 0; x < WIDTH; x++) {
            if (board[11][x] !== 0) has12 = true;
            if (board[12][x] !== 0) has13 = true;
        }
        return has12 && has13;
    }

    /**
     * 盤面の質を詳細に評価する (v11)
     * 連鎖尾の延長と動的連結（潜り込み）を最優先する
     */
    function evaluateBoardQuality(board) {
        let score = 0;
        const heights = [];
        
        // 1. デッドライン・ガード (3列目の窒息防止)
        for (let x = 0; x < WIDTH; x++) {
            let h = 0;
            while (h < HEIGHT && board[h][x] !== 0) h++;
            heights.push(h);
            
            if (x === 2) { // 3列目
                if (h >= 10) score -= 5000000;
                if (h >= 11) score -= 20000000;
            } else {
                if (h > 11) score -= 100000;
            }
        }
        
        // 2. 連鎖シミュレーションによる動的評価
        let simulation = simulatePureChain(board.map(row => [...row]));
        let maxChain = simulation.chains;
        
        // 連鎖数に応じた指数関数的な加点 (15連鎖以上を狙う)
        if (maxChain > 0) {
            score += Math.pow(maxChain, 6) * 1000;
        }

        // 3. 連鎖尾の形状と「潜り込み」の評価
        // 雪崩 (Avalanche) の形状チェック
        for (let x = 0; x < WIDTH - 1; x++) {
            for (let y = 0; y < heights[x] - 1; y++) {
                let color = board[y][x];
                if (color === 0) continue;
                
                // L字型の雪崩構造
                if (board[y][x+1] === color && board[y+1][x+1] === color) {
                    score += 20000;
                }
                
                // 潜り込み (Insertion) の可能性
                // 消去後に上のぷよが落ちて隣と繋がるか
                if (y >= 1 && board[y-1][x] !== 0 && board[y-1][x] !== color) {
                    // 落下シミュレーション的な簡易評価
                    score += 15000;
                }
            }
        }

        // 4. 連結の質（連鎖の種）
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
                    if (groupSize === 3) score += 10000;
                    if (groupSize === 2) score += 1000;
                }
            }
        }

        return score;
    }

    /**
     * 純粋な連鎖シミュレーション（評価用）
     */
    function simulatePureChain(board) {
        let totalChains = 0;
        let totalPuyos = 0;
        
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
                        if (group.length >= 4) {
                            toErase.push(...group);
                        }
                    }
                }
            }
            
            if (toErase.length === 0) break;
            
            totalChains++;
            totalPuyos += toErase.length;
            toErase.forEach(p => board[p.y][p.x] = 0);
            
            // 落下処理
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
        
        return { chains: totalChains, puyos: totalPuyos };
    }

    /**
     * 最善の一手を探索する
     */
    function getBestMove(board, nextPuyos) {
        let bestScore = -Infinity;
        let bestMove = { x: 2, rotation: 0 };
        
        const puyo1 = nextPuyos[0];
        const puyo2 = nextPuyos[1];
        
        // 全22パターン（位置6×回転4、ただし重複除く）をシミュレーション
        for (let x = 0; x < WIDTH; x++) {
            for (let r = 0; r < 4; r++) {
                let tempBoard = board.map(row => [...row]);
                let pos1 = { x: x, y: -1 };
                let pos2 = { x: x, y: -1 };
                
                // 回転による位置決定
                if (r === 0) { pos1.x = x; pos2.x = x; pos1.y = 1; pos2.y = 0; } // 縦（上がpuyo1）
                else if (r === 1) { pos1.x = x; pos2.x = x + 1; pos1.y = 0; pos2.y = 0; } // 横（右がpuyo2）
                else if (r === 2) { pos1.x = x; pos2.x = x; pos1.y = 0; pos2.y = 1; } // 縦（下がpuyo1）
                else if (r === 3) { pos1.x = x; pos2.x = x - 1; pos1.y = 0; pos2.y = 0; } // 横（左がpuyo2）
                
                if (pos1.x < 0 || pos1.x >= WIDTH || pos2.x < 0 || pos2.x >= WIDTH) continue;
                
                // 落下処理
                let h1 = 0; while (h1 < HEIGHT && tempBoard[h1][pos1.x] !== 0) h1++;
                let h2 = 0; while (h2 < HEIGHT && tempBoard[h2][pos2.x] !== 0) h2++;
                
                if (h1 >= 12 || h2 >= 12) continue; // 窒息チェック
                
                // 実際に配置
                if (pos1.x === pos2.x) {
                    tempBoard[h1][pos1.x] = (r === 0) ? puyo2 : puyo1;
                    tempBoard[h1+1][pos1.x] = (r === 0) ? puyo1 : puyo2;
                } else {
                    tempBoard[h1][pos1.x] = puyo1;
                    tempBoard[h2][pos2.x] = puyo2;
                }
                
                // 盤面評価
                let score = evaluateBoardQuality(tempBoard);
                if (score > bestScore) {
                    bestScore = score;
                    bestMove = { x: x, rotation: r };
                }
            }
        }
        
        return bestMove;
    }

    return {
        getBestMove: getBestMove
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PuyoAI;
}
