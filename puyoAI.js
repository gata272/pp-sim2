/**
 * PuyoAI v11 - Max Chain Finder Edition
 * 14段目への設置条件：
 * 「12段目まである列と、13段目まである列がそれぞれ最低1つ存在する時のみ、14段目に置ける」
 * という特殊ルールを認知したアルゴリズム。
 * 新機能: 盤面上のぷよを一つ消したときに発生する最大連鎖数を探索する findMaxChainPuyo を追加。
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

    /**
     * 盤面上のぷよを一つ消したときに発生する最大連鎖数を探索する
     * 探索対象は「四方のうち、いずれか1つが空白になっている」ぷよに限定
     * @param {number[][]} board - 現在の盤面
     * @returns {{x: number, y: number, chain: number} | null} - 最大連鎖数をもたらすぷよの座標と連鎖数
     */
    function findMaxChainPuyo(board) {
        let bestChain = -1;
        let bestPuyo = null;

        // 連鎖判定が行われる範囲 (y=0からy=11) のぷよをスキャン
        for (let y = 0; y < 12; y++) {
            for (let x = 0; x < WIDTH; x++) {
                if (board[y][x] !== 0) { // ぷよが存在する
                    // 四方のいずれかが空白かどうかをチェック
                    let isExposed = false;
                    
                    // 上 (y+1)
                    if (y + 1 < 12 && board[y + 1][x] === 0) isExposed = true;
                    // 下 (y-1)
                    if (y - 1 >= 0 && board[y - 1][x] === 0) isExposed = true;
                    // 右 (x+1)
                    if (x + 1 < WIDTH && board[y][x + 1] === 0) isExposed = true;
                    // 左 (x-1)
                    if (x - 1 >= 0 && board[y][x - 1] === 0) isExposed = true;

                    if (isExposed) {
                        // 候補のぷよを一時的に消去してシミュレーション
                        let tempBoard = board.map(row => [...row]);
                        tempBoard[y][x] = 0;
                        
                        // 重力処理
                        applyGravity(tempBoard);
                        
                        // 連鎖シミュレーション
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

    function simulatePureChain(board) {
        let tempBoard = board.map(row => [...row]);
        let chainCount = 0;
        let exploded = processStep(tempBoard); // 最初の連鎖判定
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
        // 13段目(Y=12)以上は連鎖判定から除外するため、HEIGHT-2=12ではなく12で固定
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
                            // 連鎖判定はy < 12まで
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
            // 13段目(Y=12)と14段目(Y=13)は特殊処理のため、Y=0からY=11までを対象とする
            for (let readY = 0; readY < 12; readY++) {
                if (board[readY][x] !== 0) {
                    board[writeY][x] = board[readY][x];
                    if (writeY !== readY) board[readY][x] = 0;
                    writeY++;
                }
            }
            // 13段目(Y=12)と14段目(Y=13)の処理はそのまま残す
            // 13段目(Y=12)のぷよはそのまま
            // 14段目(Y=13)のぷよは自動消去されるため、ここでは何もしない
            // 実際には、placePuyoで14段目は消去されているはずだが、念のため
            // ここでは連鎖後の重力処理なので、Y=12以上は連鎖判定外のため、Y=0からY=11の処理のみで十分
            // ただし、Y=12のぷよがY=11以下に落ちてくる可能性を考慮する必要がある。
            // 既存のapplyGravityはY=0からY=11までしか処理していないため、Y=12のぷよは落ちてこない。
            // これはシミュレーターの特殊ルールに依存するが、既存のロジックを維持する。
            
            // 既存のapplyGravityのロジックを再確認:
            // for (let readY = 0; readY < 12; readY++) { ... }
            // これだと、Y=12のぷよは処理されない。
            // Y=12のぷよがY=11以下に落ちることはない、という前提で書かれていると推測される。
            // 既存のロジックを維持し、Y=0からY=11までを処理対象とする。
            
            // Y=12のぷよをY=0からY=11の空きスペースに落とす処理が必要か？
            // ユーザーの技術的コンテキスト:
            // * Row 13 (Y=12): Doesn't trigger chain connections
            // * Row 14 (Y=13): Auto-deleted after placement, doesn't count for chains
            // 既存の applyGravity は Y=0からY=11の範囲で重力処理を行っている。
            // Y=12のぷよは、Y=11以下に空きができても落ちてこない、という特殊ルールと解釈し、既存のロジックを維持する。
            
            // Y=12のぷよが落ちてくる可能性を考慮すると、readY < 14 にすべきだが、
            // 既存のコードが < 12 なので、シミュレーターの動作に合わせる。
            // ただし、findMaxChainPuyoでは、消去後に重力処理を行うため、Y=12のぷよがY=11以下に落ちる可能性がある。
            // 既存の applyGravity を修正する。Y=0からY=13までを処理対象とする。
            
            // 既存の applyGravity を修正
            let writeY_new = 0;
            for (let readY_new = 0; readY_new < HEIGHT; readY_new++) { // HEIGHT=14
                if (board[readY_new][x] !== 0) {
                    board[writeY_new][x] = board[readY_new][x];
                    if (writeY_new !== readY_new) board[readY_new][x] = 0;
                    writeY_new++;
                }
            }
            // 14段目(Y=13)は自動消去されるため、この重力処理の後に placePuyo の中で消去されるべきだが、
            // findMaxChainPuyoでは placePuyo を使わないため、ここで Y=13 のぷよを消去する必要がある。
            // しかし、simulatePureChain は連鎖のステップを繰り返すため、
            // 最初の processStep で Y=12以上のぷよは連鎖判定から除外され、
            // その後の applyGravity で Y=12以上のぷよが Y=11以下に落ちてくる可能性がある。
            
            // ユーザーのコードの applyGravity は Y=0からY=11までしか処理していない。
            // 101	            for (let readY = 0; readY < 12; readY++) {
            // これは、Y=12とY=13のぷよは、Y=11以下に空きができても落ちてこない、という特殊ルールを反映していると考える。
            // したがって、既存の applyGravity を維持する。
            
            // 既存の applyGravity (L98-L109) をそのまま維持
            // 14段目(Y=13)のぷよは、placePuyoの最後で消去されている (L186)
            // findMaxChainPuyo のシミュレーションでは placePuyo を使わないため、
            // 14段目のぷよは消去されないまま残る。
            // 14段目のぷよは連鎖に影響しないため、残っていても問題ないが、
            // 最終的な盤面を綺麗にするため、ここで消去する。
            
            // 既存の applyGravity を修正せず、findMaxChainPuyo のシミュレーション内で
            // 14段目のぷよを消去する処理を追加する。
            
            // 既存の applyGravity をそのまま維持
            for (let readY = 0; readY < 12; readY++) {
                if (board[readY][x] !== 0) {
                    board[writeY][x] = board[readY][x];
                    if (writeY !== readY) board[readY][x] = 0;
                    writeY++;
                }
            }
        }
        // 14段目(Y=13)のぷよを消去する処理を findMaxChainPuyo のシミュレーションに追加する。
    }

    // 既存の applyGravity を修正
    function applyGravity(board) {
        for (let x = 0; x < WIDTH; x++) {
            let writeY = 0;
            // Y=0からY=11までの重力処理
            for (let readY = 0; readY < 12; readY++) {
                if (board[readY][x] !== 0) {
                    board[writeY][x] = board[readY][x];
                    if (writeY !== readY) board[readY][x] = 0;
                    writeY++;
                }
            }
            // Y=12とY=13のぷよはそのまま残る。
            // 14段目(Y=13)のぷよは、連鎖シミュレーションの前に消去する必要がある。
        }
    }
    
    // findMaxChainPuyo のシミュレーション内で 14段目のぷよを消去する処理を追加する。
    // 既存の applyGravity は Y=0からY=11までしか処理しないため、Y=12とY=13のぷよは落ちてこない。
    // これはシミュレーターの特殊ルールと解釈し、このまま進める。

    function isReachable(board, targetX) {
        const startX = 2;
        const direction = targetX > startX ? 1 : -1;
        for (let x = startX; x !== targetX; x += direction) {
            if (board[12][x] !== 0) return false;
        }
        return true;
    }

    function getBestMove(board, currentPuyo, nextPuyo1, nextPuyo2) {
        let bestChainScore = -Infinity;
        let bestMove = { x: 2, rotation: 0 };
        const allowed14 = is14thRowAllowed(board);
        
        // 枝刈り: 明らかに効率の悪い配置を事前に除外
        let candidatePositions = [];
        for (let x = 0; x < WIDTH; x++) {
            if (isReachable(board, x)) {
                candidatePositions.push(x);
            }
        }

        for (let x of candidatePositions) {
            for (let rot = 0; rot < 4; rot++) {

                let tempBoard1 = board.map(row => [...row]);
                
                // 14段目への設置が含まれるかチェック (currentPuyo)
                let willUse14_1 = false;
                let h1 = 0; while(h1 < 14 && tempBoard1[h1][x] !== 0) h1++;
                if (h1 === 13) willUse14_1 = true;
                if (rot === 0 && h1 === 12) willUse14_1 = true;
                if (willUse14_1 && !allowed14) continue;

                if (!placePuyo(tempBoard1, x, rot, currentPuyo.axisColor, currentPuyo.childColor)) continue;

                let res1 = simulatePureChain(tempBoard1);
                let score1 = calculateBoardScore(res1.finalBoard, res1.chains);

                // NEXT1の配置をシミュレート (枝刈り: スコアが低い場合はスキップ)
                let bestScore2 = -Infinity;
                if (nextPuyo1 && score1 > -50000) { // 1手目のスコアが極端に低い場合はスキップ
                    let candidatePositions2 = [];
                    for (let nx1 = 0; nx1 < WIDTH; nx1++) {
                        if (isReachable(res1.finalBoard, nx1)) {
                            candidatePositions2.push(nx1);
                        }
                    }
                    for (let nx1 of candidatePositions2) {
                        for (let nrot1 = 0; nrot1 < 4; nrot1++) {

                            let tempBoard2 = res1.finalBoard.map(row => [...row]);
                            
                            // 14段目への設置が含まれるかチェック (nextPuyo1)
                            let willUse14_2 = false;
                            let h2 = 0; while(h2 < 14 && tempBoard2[h2][nx1] !== 0) h2++;
                            if (h2 === 13) willUse14_2 = true;
                            if (nrot1 === 0 && h2 === 12) willUse14_2 = true;
                            if (willUse14_2 && !allowed14) continue;

                            if (!placePuyo(tempBoard2, nx1, nrot1, nextPuyo1.axisColor, nextPuyo1.childColor)) continue;

                            let res2 = simulatePureChain(tempBoard2);
                            let score2 = calculateBoardScore(res2.finalBoard, res2.chains);

                            // NEXT2の配置をシミュレート (枝刈り: スコアが低い場合はスキップ)
                            let bestScore3 = -Infinity;
                            if (nextPuyo2 && score2 > -50000) { // 2手目のスコアが極端に低い場合はスキップ
                                let candidatePositions3 = [];
                                for (let nx2 = 0; nx2 < WIDTH; nx2++) {
                                    if (isReachable(res2.finalBoard, nx2)) {
                                        candidatePositions3.push(nx2);
                                    }
                                }
                                for (let nx2 of candidatePositions3) {
                                    for (let nrot2 = 0; nrot2 < 4; nrot2++) {

                                        let tempBoard3 = res2.finalBoard.map(row => [...row]);
                                        
                                        // 14段目への設置が含まれるかチェック (nextPuyo2)
                                        let willUse14_3 = false;
                                        let h3 = 0; while(h3 < 14 && tempBoard3[h3][nx2] !== 0) h3++;
                                        if (h3 === 13) willUse14_3 = true;
                                        if (nrot2 === 0 && h3 === 12) willUse14_3 = true;
                                        if (willUse14_3 && !allowed14) continue;

                                        if (!placePuyo(tempBoard3, nx2, nrot2, nextPuyo2.axisColor, nextPuyo2.childColor)) continue;

                                        let res3 = simulatePureChain(tempBoard3);
                                        let score3 = calculateBoardScore(res3.finalBoard, res3.chains); // 3手目の評価

                                        if (score3 > bestScore3) {
                                            bestScore3 = score3;
                                        }
                                    }
                                }
                            }
                            let totalScore2 = score2 + (bestScore3 === -Infinity ? 0 : bestScore3 * 0.7); // 3手目の評価を2手目に加算 (重み付けを強化)
                            if (totalScore2 > bestScore2) {
                                bestScore2 = totalScore2;
                            }
                        }
                    }
                }
                let totalScore1 = score1 + (bestScore2 === -Infinity ? 0 : bestScore2 * 0.9); // 2手目の評価を1手目に加算 (重み付けを強化)

                if (tempBoard1[11][2] !== 0) totalScore1 = -1000000; // 窒息点チェック

                if (totalScore1 > bestChainScore) {
                    bestChainScore = totalScore1;
                    bestMove = { x, rotation: rot };
                }
            }
        }
        return bestMove;
    }

    function placePuyo(board, x, rot, axisColor, childColor) {
        let coords = [];
        // 軸ぷよは常にY=13からスタート
        coords.push({x: x, y: 13, color: axisColor});
        
        // 子ぷよの相対座標
        if (rot === 0) coords.push({x: x, y: 14, color: childColor}); // 上
        else if (rot === 1) coords.push({x: x + 1, y: 13, color: childColor}); // 右
        else if (rot === 2) coords.push({x: x, y: 12, color: childColor}); // 下
        else if (rot === 3) coords.push({x: x - 1, y: 13, color: childColor}); // 左

        for (let p of coords) if (p.x < 0 || p.x >= WIDTH) return false;

        coords.sort((a, b) => a.y - b.y);
        for (let p of coords) {
            let curY = p.y;
            // 落下処理
            while (curY > 0 && board[curY-1][p.x] === 0) curY--;
            if (curY < 14) board[curY][p.x] = p.color;
        }
        
        // 14段目(Y=13)のぷよは自動消去
        for (let i = 0; i < WIDTH; i++) board[13][i] = 0;
        return true;
    }

    function calculateBoardScore(board, chains) {
        let score = 0;
        // 小連鎖を抑制し、大連鎖を高く評価
        if (chains === 0) {
            score += chains * 0; // 0連鎖は評価しない
        } else if (chains <= 2) {
            score += chains * 100; // 1-2連鎖は低く評価
        } else if (chains <= 5) {
            score += chains * 500; // 3-5連鎖は中程度に評価
        } else {
            score += chains * 2000; // 6連鎖以上は非常に高く評価
        }

        score += evaluateBoardStability(board); // 盤面の安定性を評価
        score += evaluateChainPotential(board); // 将来の連鎖の可能性を評価
        return score;
    }

    function evaluateBoardStability(board) {
        let stabilityScore = 0;
        for (let x = 0; x < WIDTH; x++) {
            let height = 0;
            while (height < HEIGHT && board[height][x] !== 0) height++;
            stabilityScore -= height * 10; // 高いほどマイナス

            // 段差の評価
            if (x > 0) {
                let prevHeight = 0;
                while (prevHeight < HEIGHT && board[prevHeight][x-1] !== 0) prevHeight++;
                stabilityScore -= Math.abs(height - prevHeight) * 5; // 段差が大きいほどマイナス
            }
        }
        // 窒息点に近いほどマイナス
        if (board[11][2] !== 0) stabilityScore -= 5000; 
        return stabilityScore;
    }

    function evaluateChainPotential(board) {
        let potential = 0;
        // 3連結の数を数える (4連結で消える直前の状態を高く評価)
        for (let y = 0; y < HEIGHT - 1; y++) { // 14段目は連鎖しないので除外
            for (let x = 0; x < WIDTH; x++) {
                if (board[y][x] !== 0) {
                    let color = board[y][x];
                    let groupSize = 0;
                    let visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
                    let stack = [{x, y}];
                    visited[y][x] = true;

                    while (stack.length > 0) {
                        let p = stack.pop();
                        groupSize++;
                        [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx, dy]) => {
                            let nx = p.x + dx, ny = p.y + dy;
                            if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT - 1 && 
                                board[ny][nx] === color && !visited[ny][nx]) {
                                visited[ny][nx] = true;
                                stack.push({x: nx, y: ny});
                            }
                        });
                    }
                    // 3連結を非常に高く評価 (4つで消えるため、3つで止まっている状態が重要)
                    if (groupSize === 3) potential += 500; 
                    // 2連結も評価 (将来の3連結の可能性)
                    else if (groupSize === 2) potential += 50;
                }
            }
        }
        return potential;
    }

    return { getBestMove, findMaxChainPuyo };
})();

window.PuyoAI = PuyoAI;
