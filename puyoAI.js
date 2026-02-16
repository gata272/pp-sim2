/**
 * PuyoAI v16 - Ultimate Edition
 * 
 * Amaの技術を可能な限り実装した最終版:
 * 1. ビームサーチ（4手先）
 * 2. 転置表（Transposition Table）- 評価済み盤面をキャッシュ
 * 3. クワイエッセンスサーチ - 連鎖終了まで探索
 * 4. GTR/新GTR/フロントパターン
 * 5. 動的ビーム幅調整
 * 6. より精密な評価関数
 * 
 * 参考: https://github.com/citrus610/ama
 */
const PuyoAI = (function() {
    const WIDTH = 6;
    const HEIGHT = 14;
    const COLORS = [1, 2, 3, 4];
    
    // ビームサーチのパラメータ
    let BEAM_WIDTH = 12;
    const SEARCH_DEPTH = 4;
    const MAX_CACHE_SIZE = 10000; // 転置表の最大サイズ
    
    // 転置表（Transposition Table）
    const transpositionTable = new Map();
    let tableAge = 0; // エージング用

    /**
     * 盤面のハッシュ値を計算（Zobrist Hashing風）
     */
    function hashBoard(board) {
        let hash = '';
        for (let y = 0; y < 12; y++) {
            for (let x = 0; x < WIDTH; x++) {
                hash += board[y][x];
            }
        }
        return hash;
    }

    /**
     * 転置表から取得
     */
    function getFromTable(board) {
        const hash = hashBoard(board);
        const entry = transpositionTable.get(hash);
        
        if (entry && entry.age === tableAge) {
            return entry.score;
        }
        return null;
    }

    /**
     * 転置表に保存
     */
    function saveToTable(board, score) {
        const hash = hashBoard(board);
        
        // サイズ制限チェック
        if (transpositionTable.size >= MAX_CACHE_SIZE) {
            // 古いエントリを削除（Aging replacement）
            const keysToDelete = [];
            for (let [key, entry] of transpositionTable) {
                if (entry.age < tableAge) {
                    keysToDelete.push(key);
                    if (keysToDelete.length >= MAX_CACHE_SIZE / 4) break;
                }
            }
            keysToDelete.forEach(key => transpositionTable.delete(key));
        }
        
        transpositionTable.set(hash, {
            score: score,
            age: tableAge
        });
    }

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
     * GTRパターン検出（完全版）
     */
    function detectGTRPattern(board) {
        let score = 0;
        
        for (let baseX = 0; baseX <= 3; baseX++) {
            if (baseX + 2 >= WIDTH) continue;
            
            let h0 = getColumnHeight(board, baseX);
            let h1 = getColumnHeight(board, baseX + 1);
            let h2 = getColumnHeight(board, baseX + 2);
            
            if (h1 > h0 && h1 > h2) {
                let heightDiff1 = h1 - h0;
                let heightDiff2 = h1 - h2;
                
                if (heightDiff1 >= 2 && heightDiff1 <= 4 && heightDiff2 >= 1 && heightDiff2 <= 3) {
                    score += 600;
                    
                    // 色の連続性チェック
                    for (let color of COLORS) {
                        let verticalCount = 0;
                        for (let y = 0; y < h1 && y < 12; y++) {
                            if (board[y][baseX + 1] === color) {
                                verticalCount++;
                            }
                        }
                        if (verticalCount >= 3) score += 250;
                    }
                }
            }
        }
        
        return score;
    }

    /**
     * 新GTR（サブマリン）検出
     */
    function detectSubmarinePattern(board) {
        let score = 0;
        
        for (let baseX = 0; baseX <= 3; baseX++) {
            if (baseX + 2 >= WIDTH) continue;
            
            let h0 = getColumnHeight(board, baseX);
            let h1 = getColumnHeight(board, baseX + 1);
            let h2 = getColumnHeight(board, baseX + 2);
            
            if (h0 > h1 && h2 > h1 && Math.abs(h0 - h2) <= 2) {
                let depth = Math.min(h0 - h1, h2 - h1);
                if (depth >= 2 && depth <= 3) {
                    score += 500;
                }
            }
        }
        
        return score;
    }

    /**
     * フロントパターン検出
     */
    function detectFrontPattern(board) {
        let score = 0;
        
        let leftFront = getColumnHeight(board, 0);
        let leftBack = getColumnHeight(board, 2);
        if (leftBack - leftFront >= 3 && leftBack - leftFront <= 5) {
            score += 350;
        }
        
        let rightFront = getColumnHeight(board, 5);
        let rightBack = getColumnHeight(board, 3);
        if (rightBack - rightFront >= 3 && rightBack - rightFront <= 5) {
            score += 350;
        }
        
        return score;
    }

    /**
     * トリガーの高さ評価
     */
    function evaluateTriggerHeight(board) {
        let score = 0;
        let lowestTrigger = 12;
        
        for (let color of COLORS) {
            for (let y = 0; y < 12; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    if (board[y][x] === color) {
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
        
        score += (12 - lowestTrigger) * 200;
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
     */
    function evaluateChainExtensibility(board) {
        let score = 0;
        
        for (let color of COLORS) {
            let groups = [];
            let visited = Array.from({ length: 12 }, () => Array(WIDTH).fill(false));
            
            for (let y = 0; y < 12; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    if (board[y][x] === color && !visited[y][x]) {
                        let size = getClusterSize(board, x, y, color, visited);
                        if (size >= 2) groups.push(size);
                    }
                }
            }
            
            if (groups.length >= 2 && groups.length <= 4) {
                score += groups.length * 120;
                groups.forEach(size => {
                    if (size === 3) score += 180;
                    else if (size === 2 || size === 4) score += 100;
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
     * リソースの無駄評価
     */
    function evaluateResourceWaste(board) {
        let waste = 0;
        
        for (let color of COLORS) {
            for (let y = 0; y < 12; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    if (board[y][x] === color) {
                        let hasNeighbor = false;
                        [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx, dy]) => {
                            let nx = x + dx, ny = y + dy;
                            if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < 12 && 
                                board[ny][nx] === color) {
                                hasNeighbor = true;
                            }
                        });
                        if (!hasNeighbor) waste += 120;
                    }
                }
            }
        }
        
        return -waste;
    }

    /**
     * 色のバランス評価
     */
    function evaluateColorBalance(board) {
        let score = 0;
        let colorCounts = {};
        COLORS.forEach(c => colorCounts[c] = 0);
        
        for (let y = 0; y < 12; y++) {
            for (let x = 0; x < WIDTH; x++) {
                let c = board[y][x];
                if (c !== 0) colorCounts[c]++;
            }
        }
        
        let counts = Object.values(colorCounts);
        let avgCount = counts.reduce((a, b) => a + b, 0) / 4;
        
        // 各色が均等に配置されていると良い
        counts.forEach(count => {
            let deviation = Math.abs(count - avgCount);
            score -= deviation * 10;
        });
        
        return score;
    }

    /**
     * 階段の連続性評価
     */
    function evaluateStairContinuity(board) {
        let score = 0;
        let maxContinuity = 0;
        let currentContinuity = 0;
        
        for (let x = 0; x < WIDTH - 1; x++) {
            let h1 = getColumnHeight(board, x);
            let h2 = getColumnHeight(board, x + 1);
            let diff = h2 - h1;
            
            if (diff === 1) {
                currentContinuity++;
                if (currentContinuity > maxContinuity) {
                    maxContinuity = currentContinuity;
                }
            } else {
                currentContinuity = 0;
            }
        }
        
        score += maxContinuity * maxContinuity * 100; // 連続性の二乗
        return score;
    }

    /**
     * クワイエッセンスサーチ
     * 連鎖中の盤面は連鎖が終わるまで探索
     */
    function quiescenceSearch(board) {
        let currentBoard = board.map(row => [...row]);
        let totalChains = 0;
        
        while (true) {
            let res = simulatePureChain(currentBoard);
            if (res.chains === 0) break;
            totalChains += res.chains;
            currentBoard = res.finalBoard;
        }
        
        return { chains: totalChains, finalBoard: currentBoard };
    }

    /**
     * ビームサーチ（改良版）
     */
    function beamSearch(board, queue, depth, totalPuyos) {
        if (depth === 0 || queue.length === 0) {
            return [];
        }
        
        // 動的ビーム幅調整
        let dynamicBeamWidth = BEAM_WIDTH;
        if (totalPuyos < 20) {
            dynamicBeamWidth = 16; // 序盤は広く
        } else if (totalPuyos > 50) {
            dynamicBeamWidth = 8; // 終盤は狭く（高速化）
        }
        
        let candidates = [];
        let currentPuyo = queue[0];
        let nextQueue = queue.slice(1);
        const allowed14 = is14thRowAllowed(board);
        
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
                
                // クワイエッセンスサーチ適用
                let res = quiescenceSearch(tempBoard);
                
                // 転置表チェック
                let cachedScore = getFromTable(res.finalBoard);
                let score;
                
                if (cachedScore !== null) {
                    score = cachedScore;
                } else {
                    score = evaluateBoard(res.finalBoard, res.chains, totalPuyos);
                    saveToTable(res.finalBoard, score);
                }
                
                candidates.push({
                    board: res.finalBoard,
                    move: {x, rotation: rot},
                    score: score,
                    path: [{x, rotation: rot}]
                });
            }
        }
        
        candidates.sort((a, b) => b.score - a.score);
        let beam = candidates.slice(0, dynamicBeamWidth);
        
        if (depth === 1) {
            return beam;
        }
        
        let nextBeam = [];
        for (let node of beam) {
            let newTotalPuyos = 0;
            for (let y = 0; y < 12; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    if (node.board[y][x] !== 0) newTotalPuyos++;
                }
            }
            
            let children = beamSearch(node.board, nextQueue, depth - 1, newTotalPuyos);
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
        return nextBeam.slice(0, dynamicBeamWidth);
    }

    /**
     * 盤面評価関数 - v16最終版
     */
    function evaluateBoard(board, immediateChains, totalPuyos) {
        let score = 0;
        
        // 即連鎖の抑制（段階的）
        if (totalPuyos < 48) {
            if (immediateChains > 0) {
                score -= immediateChains * 12000; // さらに強化
            }
        } else if (totalPuyos < 65) {
            if (immediateChains >= 1 && immediateChains <= 3) {
                score -= 5000;
            } else if (immediateChains >= 4 && immediateChains < 7) {
                score += immediateChains * 4000;
            } else if (immediateChains >= 7) {
                score += immediateChains * 10000;
            }
        } else {
            score += immediateChains * 15000;
        }
        
        // 連鎖ポテンシャル（最重要）
        let potential = evaluateChainPotential(board);
        score += potential * 12000; // v15の10000から12000に増加
        
        // パターンマッチング
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
        
        // 色のバランス
        let balanceScore = evaluateColorBalance(board);
        score += balanceScore;
        
        // 階段の連続性
        let stairScore = evaluateStairContinuity(board);
        score += stairScore;
        
        // 高さペナルティ
        let maxHeight = 0;
        for (let x = 0; x < WIDTH; x++) {
            let h = getColumnHeight(board, x);
            if (h > maxHeight) maxHeight = h;
        }
        if (maxHeight > 10) {
            score -= (maxHeight - 10) * 3500;
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
                
                // クワイエッセンスサーチで正確な連鎖数を取得
                let res = quiescenceSearch(tempBoard);
                if (res.chains > maxChain) maxChain = res.chains;
            }
        }
        return maxChain;
    }

    /**
     * 最善手を取得 - v16最終版
     */
    function getBestMove(board, axisColor, childColor, nextAxisColor, nextChildColor) {
        // 転置表のエージングを進める
        tableAge++;
        
        let totalPuyos = 0;
        for (let y = 0; y < 12; y++) {
            for (let x = 0; x < WIDTH; x++) {
                if (board[y][x] !== 0) totalPuyos++;
            }
        }
        
        let queue = [[childColor, axisColor]];
        
        if (nextAxisColor && nextChildColor) {
            queue.push([nextChildColor, nextAxisColor]);
        }
        
        // 仮想ぷよを追加
        for (let i = 0; i < 2; i++) {
            queue.push([
                COLORS[Math.floor(Math.random() * COLORS.length)],
                COLORS[Math.floor(Math.random() * COLORS.length)]
            ]);
        }
        
        let results = beamSearch(board, queue, SEARCH_DEPTH, totalPuyos);
        
        if (results.length === 0) {
            return { x: 2, rotation: 0 };
        }
        
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
                        let res = quiescenceSearch(tempBoard);
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
