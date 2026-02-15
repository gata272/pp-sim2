/**
 * PuyoAI v15 - Beam Search Edition
 * 
 * Amaの技術を参考にした改良版:
 * 1. ビームサーチ（複数候補を並列探索）
 * 2. GTR/新GTR/フロントなどのパターンマッチング
 * 3. 連鎖の拡張性評価
 * 4. トリガーの高さ評価
 * 5. 4-5手先まで読む（ビームサーチで高速化）
 * 
 * 参考: https://github.com/citrus610/ama
 */
const PuyoAI = (function() {
    const WIDTH = 6;
    const HEIGHT = 14;
    const COLORS = [1, 2, 3, 4];
    
    // ビームサーチのパラメータ
    const BEAM_WIDTH = 12; // 各深さで保持する候補数
    const SEARCH_DEPTH = 4; // 探索の深さ

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

    function getColumnHeight(board, x) {
        let height = 0;
        while (height < 12 && board[height][x] !== 0) height++;
        return height;
    }

    /**
     * GTRパターン検出（Amaより）
     * 最も強力な連鎖パターンの一つ
     */
    function detectGTRPattern(board) {
        let score = 0;
        
        // 標準GTR: 列1が高い、列0と列2が低い
        // 典型的な形:
        // ┌─┬─┬─┐
        // │  │○│  │
        // ├─┼─┼─┤
        // │  │○│○│
        // ├─┼─┼─┤
        // │○│○│○│
        // └─┴─┴─┘
        
        for (let baseX = 0; baseX <= 3; baseX++) {
            if (baseX + 2 >= WIDTH) continue;
            
            let h0 = getColumnHeight(board, baseX);
            let h1 = getColumnHeight(board, baseX + 1);
            let h2 = getColumnHeight(board, baseX + 2);
            
            // GTRの基本形: 列1が最も高い
            if (h1 > h0 && h1 > h2) {
                let heightDiff1 = h1 - h0;
                let heightDiff2 = h1 - h2;
                
                // 理想的な高さ差は2-4段
                if (heightDiff1 >= 2 && heightDiff1 <= 4 && heightDiff2 >= 1 && heightDiff2 <= 3) {
                    score += 500; // 完璧なGTR
                    
                    // 色のチェック（同じ色が縦に3個以上）
                    let colorBonus = 0;
                    for (let color of COLORS) {
                        let verticalCount = 0;
                        for (let y = 0; y < h1 && y < 12; y++) {
                            if (board[y][baseX + 1] === color) {
                                verticalCount++;
                            }
                        }
                        if (verticalCount >= 3) {
                            colorBonus += 200;
                        }
                    }
                    score += colorBonus;
                }
            }
        }
        
        return score;
    }

    /**
     * 新GTR（サブマリン）検出
     * より高度なパターン
     */
    function detectSubmarinePattern(board) {
        let score = 0;
        
        // 新GTRは凹型
        // ┌─┬─┬─┐
        // │○│  │○│
        // ├─┼─┼─┤
        // │○│○│○│
        // └─┴─┴─┘
        
        for (let baseX = 0; baseX <= 3; baseX++) {
            if (baseX + 2 >= WIDTH) continue;
            
            let h0 = getColumnHeight(board, baseX);
            let h1 = getColumnHeight(board, baseX + 1);
            let h2 = getColumnHeight(board, baseX + 2);
            
            // 凹型: 両端が高く、中央が低い
            if (h0 > h1 && h2 > h1 && Math.abs(h0 - h2) <= 2) {
                let depth = Math.min(h0 - h1, h2 - h1);
                if (depth >= 2 && depth <= 3) {
                    score += 400; // 新GTR発見
                }
            }
        }
        
        return score;
    }

    /**
     * フロントパターン検出
     * 手前に発火点がある形
     */
    function detectFrontPattern(board) {
        let score = 0;
        
        // 最前列（列0または列5）が低く、奥が高い
        let leftFront = getColumnHeight(board, 0);
        let leftBack = getColumnHeight(board, 2);
        
        if (leftBack - leftFront >= 3 && leftBack - leftFront <= 5) {
            score += 300;
        }
        
        let rightFront = getColumnHeight(board, 5);
        let rightBack = getColumnHeight(board, 3);
        
        if (rightBack - rightFront >= 3 && rightBack - rightFront <= 5) {
            score += 300;
        }
        
        return score;
    }

    /**
     * トリガーの高さ評価（Amaより）
     * 発火点が低いほど良い
     */
    function evaluateTriggerHeight(board) {
        let score = 0;
        let lowestTrigger = 12;
        
        for (let color of COLORS) {
            // 各色の最も低い3個の塊を探す
            for (let y = 0; y < 12; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    if (board[y][x] === color) {
                        // この位置から3個の塊があるかチェック
                        let count = countNearbyColor(board, x, y, color);
                        if (count === 3) {
                            if (y < lowestTrigger) {
                                lowestTrigger = y;
                            }
                        }
                    }
                }
            }
        }
        
        // トリガーが低いほど高得点
        score += (12 - lowestTrigger) * 150;
        
        return score;
    }

    function countNearbyColor(board, x, y, color) {
        let count = 0;
        let visited = Array.from({ length: 12 }, () => Array(WIDTH).fill(false));
        let stack = [{x, y}];
        visited[y][x] = true;
        
        while (stack.length > 0 && count < 10) {
            let p = stack.pop();
            count++;
            
            [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx, dy]) => {
                let nx = p.x + dx, ny = p.y + dy;
                if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < 12 && 
                    board[ny][nx] === color && !visited[ny][nx]) {
                    visited[ny][nx] = true;
                    stack.push({x: nx, y: ny});
                }
            });
        }
        return count;
    }

    /**
     * 連鎖の拡張性評価
     * 連鎖が伸びやすい形かどうか
     */
    function evaluateChainExtensibility(board) {
        let score = 0;
        
        // 各色が複数の場所に分散しているか
        for (let color of COLORS) {
            let groups = [];
            let visited = Array.from({ length: 12 }, () => Array(WIDTH).fill(false));
            
            for (let y = 0; y < 12; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    if (board[y][x] === color && !visited[y][x]) {
                        let size = getClusterSize(board, x, y, color, visited);
                        if (size >= 2) {
                            groups.push(size);
                        }
                    }
                }
            }
            
            // 2-3個のグループに分かれているのが理想
            if (groups.length >= 2 && groups.length <= 4) {
                score += groups.length * 100;
                
                // 各グループが3個前後なら最高
                groups.forEach(size => {
                    if (size === 3) score += 150;
                    else if (size === 2 || size === 4) score += 80;
                });
            }
        }
        
        return score;
    }

    function getClusterSize(board, startX, startY, color, visited) {
        let size = 0;
        let stack = [{x: startX, y: startY}];
        visited[startY][startX] = true;
        
        while (stack.length > 0) {
            let p = stack.pop();
            size++;
            
            [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx, dy]) => {
                let nx = p.x + dx, ny = p.y + dy;
                if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < 12 && 
                    board[ny][nx] === color && !visited[ny][nx]) {
                    visited[ny][nx] = true;
                    stack.push({x: nx, y: ny});
                }
            });
        }
        return size;
    }

    /**
     * リソースの無駄を避ける（Amaより）
     * 同色が孤立していないか
     */
    function evaluateResourceWaste(board) {
        let waste = 0;
        
        for (let color of COLORS) {
            for (let y = 0; y < 12; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    if (board[y][x] === color) {
                        // 周囲に同色がない孤立ぷよ
                        let hasNeighbor = false;
                        [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx, dy]) => {
                            let nx = x + dx, ny = y + dy;
                            if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < 12 && 
                                board[ny][nx] === color) {
                                hasNeighbor = true;
                            }
                        });
                        
                        if (!hasNeighbor) {
                            waste += 100; // 孤立ぷよはペナルティ
                        }
                    }
                }
            }
        }
        
        return -waste;
    }

    /**
     * ビームサーチによる最善手探索
     */
    function beamSearch(board, queue, depth) {
        if (depth === 0 || queue.length === 0) {
            return [];
        }
        
        let candidates = [];
        let currentPuyo = queue[0];
        let nextQueue = queue.slice(1);
        const allowed14 = is14thRowAllowed(board);
        
        // 全ての配置パターンを生成
        for (let x = 0; x < WIDTH; x++) {
            for (let rot = 0; rot < 4; rot++) {
                if (!isReachable(board, x)) continue;
                
                let tempBoard = board.map(row => [...row]);
                let willUse14 = false;
                let h = 0;
                while(h < 14 && tempBoard[h][x] !== 0) h++;
                if (h === 13) willUse14 = true;
                if (rot === 0 && h === 12) willUse14 = true;
                if (willUse14 && !allowed14) continue;
                
                if (!placePuyo(tempBoard, x, rot, currentPuyo[1], currentPuyo[0])) continue;
                
                let res = simulatePureChain(tempBoard);
                let score = evaluateBoard(res.finalBoard, res.chains);
                
                candidates.push({
                    board: res.finalBoard,
                    move: {x, rotation: rot},
                    score: score,
                    path: [{x, rotation: rot}]
                });
            }
        }
        
        // スコア順にソート
        candidates.sort((a, b) => b.score - a.score);
        
        // 上位BEAM_WIDTH個を保持
        let beam = candidates.slice(0, BEAM_WIDTH);
        
        if (depth === 1) {
            return beam;
        }
        
        // 次の深さへ
        let nextBeam = [];
        for (let node of beam) {
            let children = beamSearch(node.board, nextQueue, depth - 1);
            children.forEach(child => {
                nextBeam.push({
                    board: child.board,
                    move: node.move,
                    score: child.score,
                    path: [node.move, ...child.path]
                });
            });
        }
        
        nextBeam.sort((a, b) => b.score - a.score);
        return nextBeam.slice(0, BEAM_WIDTH);
    }

    /**
     * 盤面評価関数 - v15最適化版
     */
    function evaluateBoard(board, immediateChains) {
        let score = 0;
        
        let totalPuyos = 0;
        for (let y = 0; y < 12; y++) {
            for (let x = 0; x < WIDTH; x++) {
                if (board[y][x] !== 0) totalPuyos++;
            }
        }
        
        // 即連鎖の抑制
        if (totalPuyos < 45) {
            if (immediateChains > 0) {
                score -= immediateChains * 10000; // さらに強化
            }
        } else if (totalPuyos < 60) {
            if (immediateChains === 1 || immediateChains === 2) {
                score -= 4000;
            } else if (immediateChains >= 3 && immediateChains < 6) {
                score += immediateChains * 3000;
            } else if (immediateChains >= 6) {
                score += immediateChains * 8000;
            }
        } else {
            score += immediateChains * 12000;
        }
        
        // 連鎖ポテンシャル（最重要）
        let potential = evaluateChainPotential(board);
        score += potential * 10000; // v14の8000から10000に増加
        
        // パターンマッチング（Amaより）
        let gtrScore = detectGTRPattern(board);
        score += gtrScore;
        
        let submarineScore = detectSubmarinePattern(board);
        score += submarineScore;
        
        let frontScore = detectFrontPattern(board);
        score += frontScore;
        
        // トリガーの高さ
        let triggerScore = evaluateTriggerHeight(board);
        score += triggerScore;
        
        // 連鎖の拡張性
        let extensibility = evaluateChainExtensibility(board);
        score += extensibility;
        
        // リソースの無駄
        let wasteScore = evaluateResourceWaste(board);
        score += wasteScore;
        
        // 高さペナルティ
        let maxHeight = 0;
        for (let x = 0; x < WIDTH; x++) {
            let h = getColumnHeight(board, x);
            if (h > maxHeight) maxHeight = h;
        }
        if (maxHeight > 10) {
            score -= (maxHeight - 10) * 3000;
        }
        
        // ゲームオーバーチェック
        if (board[11][2] !== 0) {
            return -Infinity;
        }
        
        return score;
    }

    function evaluateChainPotential(board) {
        let maxChain = 0;
        const allowed14 = is14thRowAllowed(board);
        
        for (let x = 0; x < WIDTH; x++) {
            for (let color of COLORS) {
                let tempBoard = board.map(row => [...row]);
                let y = 0;
                while (y < 14 && tempBoard[y][x] !== 0) y++;
                if (y === 13 && !allowed14) continue;
                if (y >= 14) continue;
                tempBoard[y][x] = color;
                let res = simulatePureChain(tempBoard);
                if (res.chains > maxChain) maxChain = res.chains;
            }
        }
        return maxChain;
    }

    /**
     * 最善手を取得 - ビームサーチ版
     */
    function getBestMove(board, axisColor, childColor, nextAxisColor, nextChildColor) {
        // ぷよのキューを作成
        let queue = [
            [childColor, axisColor]
        ];
        
        if (nextAxisColor && nextChildColor) {
            queue.push([nextChildColor, nextAxisColor]);
        }
        
        // さらに2手分を仮想的に追加（ランダム）
        for (let i = 0; i < 2; i++) {
            queue.push([
                COLORS[Math.floor(Math.random() * COLORS.length)],
                COLORS[Math.floor(Math.random() * COLORS.length)]
            ]);
        }
        
        // ビームサーチ実行
        let results = beamSearch(board, queue, SEARCH_DEPTH);
        
        if (results.length === 0) {
            return { x: 2, rotation: 0 };
        }
        
        // 最高スコアの手を返す
        return results[0].move;
    }

    // ヘルパー関数
    function simulatePureChain(board) {
        let tempBoard = board.map(row => [...row]);
        let chainCount = 0;
        let exploded = processStep(tempBoard);
        if (exploded) {
            chainCount++;
            while (true) {
                exploded = processStep(tempBoard);
                if (!exploded) break;
                chainCount++;
            }
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

    function findMaxChainPuyo(board) {
        let bestChain = -1;
        let bestPuyo = null;
        for (let y = 0; y < 12; y++) {
            for (let x = 0; x < WIDTH; x++) {
                if (board[y][x] !== 0) {
                    let isExposed = false;
                    if (y + 1 < 12 && board[y + 1][x] === 0) isExposed = true;
                    if (y - 1 >= 0 && board[y - 1][x] === 0) isExposed = true;
                    if (x + 1 < WIDTH && board[y][x + 1] === 0) isExposed = true;
                    if (x - 1 >= 0 && board[y][x - 1] === 0) isExposed = true;
                    if (isExposed) {
                        let tempBoard = board.map(row => [...row]);
                        tempBoard[y][x] = 0;
                        applyGravity(tempBoard);
                        let res = simulatePureChain(tempBoard);
                        if (res.chains > bestChain) {
                            bestChain = res.chains;
                            bestPuyo = { x, y, chain: res.chains };
                        }
                    }
                }
            }
        }
        return bestPuyo;
    }

    return { getBestMove, findMaxChainPuyo };
})();

window.PuyoAI = PuyoAI;
