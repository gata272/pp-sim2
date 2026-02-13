/**
 * PuyoAI v14 - 10+ Chain Optimized Edition
 * 
 * v13からの改善点（シミュレーション結果を元に最適化）:
 * 1. 即連鎖抑制を更に強化（序盤の閾値を40個に引き上げ）
 * 2. 連鎖ポテンシャルの重みを8000に増加
 * 3. 縦の連鎖（同じ列に同色を積む）も評価
 * 4. 連鎖の「層」を意識（下から順に色を分ける）
 * 5. L字・T字形の検出を追加
 * 6. 発火タイミングの最適化
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

    /**
     * 列の高さを取得
     */
    function getColumnHeight(board, x) {
        let height = 0;
        while (height < 12 && board[height][x] !== 0) height++;
        return height;
    }

    /**
     * 色の固まりサイズを取得
     */
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
     * 連鎖の「種」の数を数える - 改良版
     * 3個の固まりを最重視、2個も評価
     */
    function countChainSeeds(board) {
        let seedScore = 0;
        let visited = Array.from({ length: 12 }, () => Array(WIDTH).fill(false));
        
        for (let color of COLORS) {
            for (let y = 0; y < 12; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    if (board[y][x] === color && !visited[y][x]) {
                        let clusterSize = getClusterSize(board, x, y, color, visited);
                        
                        if (clusterSize === 3) {
                            seedScore += 300; // 3個が最適
                        } else if (clusterSize === 2) {
                            seedScore += 150; // 2個も良い
                        } else if (clusterSize >= 4) {
                            // 4個以上は位置によって判断
                            // 下の方（Y<4）なら発火準備としてOK
                            let avgY = 0;
                            let count = 0;
                            for (let ty = 0; ty < 12; ty++) {
                                for (let tx = 0; tx < WIDTH; tx++) {
                                    if (board[ty][tx] === color) {
                                        avgY += ty;
                                        count++;
                                    }
                                }
                            }
                            avgY /= count;
                            
                            if (avgY < 4) {
                                seedScore += 50; // 下層なら許容
                            } else {
                                seedScore -= 200; // 上層で4個は避ける
                            }
                        }
                    }
                }
            }
        }
        return seedScore;
    }

    /**
     * 縦の連鎖を評価（同じ列に同色を3個積む）
     */
    function evaluateVerticalChains(board) {
        let score = 0;
        
        for (let x = 0; x < WIDTH; x++) {
            for (let color of COLORS) {
                let consecutiveCount = 0;
                for (let y = 0; y < 12; y++) {
                    if (board[y][x] === color) {
                        consecutiveCount++;
                    } else {
                        if (consecutiveCount === 3) {
                            score += 200; // 縦3連は良い
                        }
                        consecutiveCount = 0;
                    }
                }
                if (consecutiveCount === 3) {
                    score += 200;
                }
            }
        }
        
        return score;
    }

    /**
     * 階段積みの評価 - 改良版
     */
    function evaluateStairPattern(board) {
        let score = 0;
        
        // 左から右への階段
        let leftToRight = 0;
        for (let x = 0; x < WIDTH - 1; x++) {
            let h1 = getColumnHeight(board, x);
            let h2 = getColumnHeight(board, x + 1);
            let diff = h2 - h1;
            
            if (diff === 1) {
                leftToRight += 150; // 完璧な階段
            } else if (diff === 0) {
                leftToRight += 50; // 同じ高さも許容
            } else if (diff === 2) {
                leftToRight += 80; // 2段差も許容
            } else if (diff < 0) {
                leftToRight -= 100; // 逆階段はペナルティ
            }
        }
        
        // 右から左への階段
        let rightToLeft = 0;
        for (let x = WIDTH - 1; x > 0; x--) {
            let h1 = getColumnHeight(board, x);
            let h2 = getColumnHeight(board, x - 1);
            let diff = h2 - h1;
            
            if (diff === 1) {
                rightToLeft += 150;
            } else if (diff === 0) {
                rightToLeft += 50;
            } else if (diff === 2) {
                rightToLeft += 80;
            } else if (diff < 0) {
                rightToLeft -= 100;
            }
        }
        
        score = Math.max(leftToRight, rightToLeft);
        return score;
    }

    /**
     * L字・T字形の検出
     * 連鎖の接続に重要
     */
    function evaluateLTShapes(board) {
        let score = 0;
        
        for (let color of COLORS) {
            for (let y = 1; y < 11; y++) {
                for (let x = 1; x < WIDTH - 1; x++) {
                    if (board[y][x] === color) {
                        // L字形のパターン
                        // ┌─ または ─┐ または └─ または ─┘
                        let patterns = [
                            [board[y-1][x] === color && board[y][x+1] === color], // ┌
                            [board[y-1][x] === color && board[y][x-1] === color], // ┐
                            [board[y+1][x] === color && board[y][x+1] === color], // └
                            [board[y+1][x] === color && board[y][x-1] === color], // ┘
                        ];
                        
                        if (patterns.some(p => p[0])) {
                            score += 100;
                        }
                        
                        // T字形
                        // ┬ または ┴ または ├ または ┤
                        let tPatterns = [
                            [board[y-1][x] === color && board[y][x+1] === color && board[y][x-1] === color], // ┬
                            [board[y+1][x] === color && board[y][x+1] === color && board[y][x-1] === color], // ┴
                            [board[y][x+1] === color && board[y-1][x] === color && board[y+1][x] === color], // ├
                            [board[y][x-1] === color && board[y-1][x] === color && board[y+1][x] === color], // ┤
                        ];
                        
                        if (tPatterns.some(p => p[0])) {
                            score += 150;
                        }
                    }
                }
            }
        }
        
        return score;
    }

    /**
     * 色の層分け評価
     * 下から順に色を分けると連鎖しやすい
     */
    function evaluateColorLayers(board) {
        let score = 0;
        
        // 各層（高さ0-2, 3-5, 6-8, 9-11）で主要な色を分析
        let layers = [
            {start: 0, end: 3},
            {start: 3, end: 6},
            {start: 6, end: 9},
            {start: 9, end: 12}
        ];
        
        let layerColors = [];
        
        for (let layer of layers) {
            let colorCount = {};
            for (let color of COLORS) colorCount[color] = 0;
            
            for (let y = layer.start; y < layer.end; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    let c = board[y][x];
                    if (c !== 0) {
                        colorCount[c]++;
                    }
                }
            }
            
            // この層で最も多い色
            let maxColor = 0;
            let maxCount = 0;
            for (let color of COLORS) {
                if (colorCount[color] > maxCount) {
                    maxCount = colorCount[color];
                    maxColor = color;
                }
            }
            
            layerColors.push(maxColor);
            
            // その色が50%以上を占めていれば良い層分け
            let totalInLayer = Object.values(colorCount).reduce((a, b) => a + b, 0);
            if (totalInLayer > 0 && maxCount / totalInLayer > 0.5) {
                score += 200;
            }
        }
        
        // 隣接する層で異なる色が主要なら高評価
        for (let i = 0; i < layerColors.length - 1; i++) {
            if (layerColors[i] !== layerColors[i+1] && layerColors[i] !== 0 && layerColors[i+1] !== 0) {
                score += 150;
            }
        }
        
        return score;
    }

    /**
     * GTRパターンの検出 - 改良版
     */
    function evaluateGTRPattern(board) {
        let score = 0;
        
        // 左側のGTR（列0-2）
        let h0 = getColumnHeight(board, 0);
        let h1 = getColumnHeight(board, 1);
        let h2 = getColumnHeight(board, 2);
        
        if (h1 > h0 && h1 > h2 && h1 - h0 >= 2 && h1 - h2 >= 1) {
            score += 250;
        }
        
        // 右側のGTR（列3-5）
        let h3 = getColumnHeight(board, 3);
        let h4 = getColumnHeight(board, 4);
        let h5 = getColumnHeight(board, 5);
        
        if (h4 > h3 && h4 > h5 && h4 - h3 >= 1 && h4 - h5 >= 2) {
            score += 250;
        }
        
        return score;
    }

    /**
     * 発火点の評価 - 改良版
     */
    function evaluateTriggerPoint(board) {
        let score = 0;
        
        // 最下層（Y=0-3）での各色の配置を確認
        for (let color of COLORS) {
            let bottomCount = 0;
            for (let y = 0; y < 4; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    if (board[y][x] === color) bottomCount++;
                }
            }
            
            // 3個あれば発火点候補
            if (bottomCount === 3) {
                score += 300;
            } else if (bottomCount === 2) {
                score += 100; // 2個も良い
            }
        }
        
        return score;
    }

    /**
     * 連鎖ポテンシャルの評価
     */
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
                if (res.chains > maxChain) {
                    maxChain = res.chains;
                }
            }
        }
        return maxChain;
    }

    /**
     * 盤面の総合評価 - v14最適化版
     */
    function evaluateBoard(board, immediateChains) {
        let score = 0;
        
        // ぷよの総数を計算
        let totalPuyos = 0;
        for (let y = 0; y < 12; y++) {
            for (let x = 0; x < WIDTH; x++) {
                if (board[y][x] !== 0) totalPuyos++;
            }
        }
        
        // 1. 即連鎖の抑制 - 閾値を40個に引き上げ
        if (totalPuyos < 40) {
            // 序盤（40個未満）: 即連鎖を強く避ける
            if (immediateChains > 0) {
                score -= immediateChains * 8000; // v13の5000から8000に増加
            }
        } else if (totalPuyos < 55) {
            // 中盤（40-55個）: 小連鎖はペナルティ
            if (immediateChains === 1) {
                score -= 3000;
            } else if (immediateChains >= 2 && immediateChains < 5) {
                score += immediateChains * 2000;
            } else if (immediateChains >= 5) {
                score += immediateChains * 6000; // 5連鎖以上なら高評価
            }
        } else {
            // 終盤（55個以上）: 連鎖を打つ
            score += immediateChains * 10000;
        }
        
        // 2. 連鎖ポテンシャル（最重要） - 重みを8000に増加
        let potential = evaluateChainPotential(board);
        score += potential * 8000; // v13の5000から8000に増加
        
        // 3. 連鎖の種
        let seeds = countChainSeeds(board);
        score += seeds;
        
        // 4. 階段積み
        let stairScore = evaluateStairPattern(board);
        score += stairScore;
        
        // 5. GTRパターン
        let gtrScore = evaluateGTRPattern(board);
        score += gtrScore;
        
        // 6. 発火点
        let trigger = evaluateTriggerPoint(board);
        score += trigger;
        
        // 7. 縦の連鎖
        let vertical = evaluateVerticalChains(board);
        score += vertical;
        
        // 8. L字・T字形
        let ltShapes = evaluateLTShapes(board);
        score += ltShapes;
        
        // 9. 色の層分け
        let layers = evaluateColorLayers(board);
        score += layers;
        
        // 10. 高さのペナルティ
        let maxHeight = 0;
        for (let x = 0; x < WIDTH; x++) {
            let h = getColumnHeight(board, x);
            if (h > maxHeight) maxHeight = h;
        }
        if (maxHeight > 10) {
            score -= (maxHeight - 10) * 2500;
        }
        
        // 11. 中央を低く保つ
        let centerHeight = getColumnHeight(board, 2) + getColumnHeight(board, 3);
        score += (24 - centerHeight) * 80;
        
        // 12. ゲームオーバーラインチェック
        if (board[11][2] !== 0) {
            return -Infinity;
        }
        
        return score;
    }

    /**
     * 最善手を取得
     */
    function getBestMove(board, axisColor, childColor, nextAxisColor, nextChildColor) {
        let bestScore = -Infinity;
        let bestMove = { x: 2, rotation: 0 };
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

                if (!placePuyo(tempBoard, x, rot, axisColor, childColor)) continue;

                let res1 = simulatePureChain(tempBoard);
                let score = evaluateBoard(res1.finalBoard, res1.chains);
                
                // 2手先も評価
                if (nextAxisColor && nextChildColor) {
                    let best2ndScore = -Infinity;
                    
                    for (let nx = 0; nx < WIDTH; nx++) {
                        if (!isReachable(res1.finalBoard, nx)) continue;
                        
                        for (let nrot = 0; nrot < 2; nrot++) {
                            let nextBoard = res1.finalBoard.map(row => [...row]);
                            if (!placePuyo(nextBoard, nx, nrot, nextAxisColor, nextChildColor)) continue;
                            
                            let res2 = simulatePureChain(nextBoard);
                            let score2 = evaluateBoard(res2.finalBoard, res2.chains);
                            
                            if (score2 > best2ndScore) {
                                best2ndScore = score2;
                            }
                        }
                    }
                    
                    score += best2ndScore * 0.4; // v13の0.3から0.4に増加
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestMove = { x, rotation: rot };
                }
            }
        }
        
        return bestMove;
    }

    // 以下、ヘルパー関数（v13と同じ）
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
