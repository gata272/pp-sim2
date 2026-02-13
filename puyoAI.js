/**

- PuyoAI v13 - 10-Chain Master Edition
- 
- 改善戦略:
- 1. 即連鎖を**抑制**し、連鎖構築を優先
- 1. 階段積み・GTR・折り返しの形を正確に評価
- 1. 各色の配置位置を分析（左右に分ける等）
- 1. 連鎖の「種」（3個の固まり）を意図的に作る
- 1. 発火点（トリガー）の位置を意識
   */
   const PuyoAI = (function() {
   const WIDTH = 6;
   const HEIGHT = 14;
   const COLORS = [1, 2, 3, 4];
  
  /**
  - 14段目(Y=13)への設置が許可されているかチェックする
    */
    function is14thRowAllowed(board) {
    let has12 = false;
    let has13 = false;
    
    for (let x = 0; x < WIDTH; x++) {
    let height = 0;
    while (height < 14 && board[height][x] !== 0) height++;
    
    ```
     if (height === 12) has12 = true;
     if (height === 13) has13 = true;
    ```
    
    }
    
    return has12 && has13;
    }
  
  /**
  - 列の高さを取得
    */
    function getColumnHeight(board, x) {
    let height = 0;
    while (height < 12 && board[height][x] !== 0) height++;
    return height;
    }
  
  /**
  - 連鎖の「種」の数を数える（3個の同色の固まり）
    */
    function countChainSeeds(board) {
    let seedCount = 0;
    let visited = Array.from({ length: 12 }, () => Array(WIDTH).fill(false));
    
    for (let color of COLORS) {
    for (let y = 0; y < 12; y++) {
    for (let x = 0; x < WIDTH; x++) {
    if (board[y][x] === color && !visited[y][x]) {
    let clusterSize = getClusterSize(board, x, y, color, visited);
    // 3個の固まりが連鎖の種として最適
    if (clusterSize === 3) {
    seedCount += 2; // 3個は高評価
    } else if (clusterSize >= 4) {
    // 4個以上は即消えるので連鎖構築には不利
    seedCount -= 1;
    } else if (clusterSize === 2) {
    seedCount += 1; // 2個も悪くない
    }
    }
    }
    }
    }
    return seedCount;
    }
  
  /**
  - 色の固まりサイズを取得
    */
    function getClusterSize(board, startX, startY, color, visited) {
    let size = 0;
    let stack = [{x: startX, y: startY}];
    visited[startY][startX] = true;
    
    while (stack.length > 0) {
    let p = stack.pop();
    size++;
    
    ```
     [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx, dy]) => {
         let nx = p.x + dx, ny = p.y + dy;
         if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < 12 && 
             board[ny][nx] === color && !visited[ny][nx]) {
             visited[ny][nx] = true;
             stack.push({x: nx, y: ny});
         }
     });
    ```
    
    }
    return size;
    }
  
  /**
  - 階段積みの評価（連鎖の基本形）
  - 左から右、または右から左への綺麗な階段を高評価
    */
    function evaluateStairPattern(board) {
    let score = 0;
    
    // 左から右への階段
    let leftToRight = 0;
    for (let x = 0; x < WIDTH - 1; x++) {
    let h1 = getColumnHeight(board, x);
    let h2 = getColumnHeight(board, x + 1);
    if (h2 === h1 + 1) {
    leftToRight += 100; // 完璧な階段
    } else if (h2 === h1) {
    leftToRight += 30; // 同じ高さも許容
    } else if (h2 === h1 - 1) {
    leftToRight -= 50; // 逆階段はペナルティ
    }
    }
    
    // 右から左への階段
    let rightToLeft = 0;
    for (let x = WIDTH - 1; x > 0; x–) {
    let h1 = getColumnHeight(board, x);
    let h2 = getColumnHeight(board, x - 1);
    if (h2 === h1 + 1) {
    rightToLeft += 100;
    } else if (h2 === h1) {
    rightToLeft += 30;
    } else if (h2 === h1 - 1) {
    rightToLeft -= 50;
    }
    }
    
    score = Math.max(leftToRight, rightToLeft);
    return score;
    }
  
  /**
  - GTR形の検出（2列目が一番高く、1列目・3列目が低い）
    */
    function evaluateGTRPattern(board) {
    let score = 0;
    
    // 列1が基準、列2が高い、列3が中間
    let h0 = getColumnHeight(board, 0);
    let h1 = getColumnHeight(board, 1);
    let h2 = getColumnHeight(board, 2);
    
    // 典型的なGTR: 列2が一番高い
    if (h1 > h0 && h1 > h2) {
    score += 150;
    // 高さ差が2~3段が理想
    if (Math.abs(h1 - h0) >= 2 && Math.abs(h1 - h0) <= 3) {
    score += 100;
    }
    }
    
    return score;
    }
  
  /**
  - 色の配置バランス評価
  - 各色が特定のエリアに集中しているか
    */
    function evaluateColorSegregation(board) {
    let score = 0;
    
    for (let color of COLORS) {
    let leftCount = 0;
    let rightCount = 0;
    
    ```
     for (let y = 0; y < 12; y++) {
         for (let x = 0; x < 3; x++) {
             if (board[y][x] === color) leftCount++;
         }
         for (let x = 3; x < 6; x++) {
             if (board[y][x] === color) rightCount++;
         }
     }
     
     // 色が左右どちらかに偏っているほど良い
     let segregation = Math.abs(leftCount - rightCount);
     score += segregation * 10;
    ```
    
    }
    
    return score;
    }
  
  /**
  - 発火点の評価（一番下の層に4個揃いそうな色があるか）
    */
    function evaluateTriggerPoint(board) {
    let score = 0;
    
    // 最下層（Y=0-2）での各色の配置を確認
    for (let color of COLORS) {
    let bottomCount = 0;
    for (let y = 0; y < 3; y++) {
    for (let x = 0; x < WIDTH; x++) {
    if (board[y][x] === color) bottomCount++;
    }
    }
    
    ```
     // 3個あれば発火点候補
     if (bottomCount === 3) {
         score += 200;
     }
    ```
    
    }
    
    return score;
    }
  
  /**
  - 連鎖ポテンシャルの詳細評価
    */
    function evaluateChainPotential(board) {
    let maxChain = 0;
    const allowed14 = is14thRowAllowed(board);
    
    // 各色を1個だけ置いてみて、最大連鎖数を計算
    for (let x = 0; x < WIDTH; x++) {
    for (let color of COLORS) {
    let tempBoard = board.map(row => […row]);
    let y = 0;
    while (y < 14 && tempBoard[y][x] !== 0) y++;
    
    ```
         if (y === 13 && !allowed14) continue;
         if (y >= 14) continue;
         
         tempBoard[y][x] = color;
         let res = simulatePureChain(tempBoard);
         if (res.chains > maxChain) {
             maxChain = res.chains;
         }
     }
    ```
    
    }
    return maxChain;
    }
  
  /**
  - 盤面の総合評価
    */
    function evaluateBoard(board, immediateChains) {
    let score = 0;
    
    // 1. 即連鎖は**抑制**（序盤は特に）
    // 盤面の埋まり具合で判断
    let totalPuyos = 0;
    for (let y = 0; y < 12; y++) {
    for (let x = 0; x < WIDTH; x++) {
    if (board[y][x] !== 0) totalPuyos++;
    }
    }
    
    if (totalPuyos < 30) {
    // 序盤（30個未満）: 即連鎖を避ける
    if (immediateChains > 0) {
    score -= immediateChains * 5000; // 大幅ペナルティ
    }
    } else if (totalPuyos < 50) {
    // 中盤（30-50個）: 小さい連鎖は許容
    if (immediateChains === 1) {
    score -= 2000;
    } else if (immediateChains >= 2) {
    score += immediateChains * 3000; // 2連鎖以上なら良い
    }
    } else {
    // 終盤（50個以上）: 連鎖を打つ
    score += immediateChains * 8000;
    }
    
    // 2. 連鎖ポテンシャル（最重要）
    let potential = evaluateChainPotential(board);
    score += potential * 5000; // 高い重み
    
    // 3. 連鎖の種の数
    let seeds = countChainSeeds(board);
    score += seeds * 300;
    
    // 4. 階段積みパターン
    let stairScore = evaluateStairPattern(board);
    score += stairScore;
    
    // 5. GTRパターン
    let gtrScore = evaluateGTRPattern(board);
    score += gtrScore;
    
    // 6. 色の分離
    let segregation = evaluateColorSegregation(board);
    score += segregation;
    
    // 7. 発火点
    let trigger = evaluateTriggerPoint(board);
    score += trigger;
    
    // 8. 高さのペナルティ
    let maxHeight = 0;
    for (let x = 0; x < WIDTH; x++) {
    let h = getColumnHeight(board, x);
    if (h > maxHeight) maxHeight = h;
    }
    if (maxHeight > 10) {
    score -= (maxHeight - 10) * 2000; // 高すぎは危険
    }
    
    // 9. 中央の列は低めに保つ
    let centerHeight = getColumnHeight(board, 2) + getColumnHeight(board, 3);
    score += (24 - centerHeight) * 50;
    
    // 10. ゲームオーバーラインチェック
    if (board[11][2] !== 0) {
    return -Infinity;
    }
    
    return score;
    }
  
  /**
  - 最善手を取得
    */
    function getBestMove(board, axisColor, childColor, nextAxisColor, nextChildColor) {
    let bestScore = -Infinity;
    let bestMove = { x: 2, rotation: 0 };
    const allowed14 = is14thRowAllowed(board);
    
    // 1手目の全パターンを評価
    for (let x = 0; x < WIDTH; x++) {
    for (let rot = 0; rot < 4; rot++) {
    if (!isReachable(board, x)) continue;
    
    ```
         let tempBoard = board.map(row => [...row]);
         
         // 14段目への設置チェック
         let willUse14 = false;
         let h = 0; 
         while(h < 14 && tempBoard[h][x] !== 0) h++;
         
         if (h === 13) willUse14 = true;
         if (rot === 0 && h === 12) willUse14 = true;
         if (willUse14 && !allowed14) continue;
    
         if (!placePuyo(tempBoard, x, rot, axisColor, childColor)) continue;
    
         // 連鎖シミュレーション
         let res1 = simulatePureChain(tempBoard);
         
         // 盤面を評価
         let score = evaluateBoard(res1.finalBoard, res1.chains);
         
         // 2手先も簡易評価
         if (nextAxisColor && nextChildColor) {
             let best2ndScore = -Infinity;
             
             for (let nx = 0; nx < WIDTH; nx++) {
                 if (!isReachable(res1.finalBoard, nx)) continue;
                 
                 for (let nrot = 0; nrot < 2; nrot++) { // 回転は2パターンだけ（高速化）
                     let nextBoard = res1.finalBoard.map(row => [...row]);
                     if (!placePuyo(nextBoard, nx, nrot, nextAxisColor, nextChildColor)) continue;
                     
                     let res2 = simulatePureChain(nextBoard);
                     let score2 = evaluateBoard(res2.finalBoard, res2.chains);
                     
                     if (score2 > best2ndScore) {
                         best2ndScore = score2;
                     }
                 }
             }
             
             score += best2ndScore * 0.3; // 2手先の重みは低め
         }
    
         if (score > bestScore) {
             bestScore = score;
             bestMove = { x, rotation: rot };
         }
     }
    ```
    
    }
    
    return bestMove;
    }
  
  /**
  - 連鎖シミュレーション
    */
    function simulatePureChain(board) {
    let tempBoard = board.map(row => […row]);
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
  
  /**
  - 連鎖の1ステップを処理
    */
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
    
    ```
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
    ```
    
    }
    if (exploded) applyGravity(board);
    return exploded;
    }
  
  /**
  - 重力処理
    */
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
  
  /**
  - 到達可能性チェック
    */
    function isReachable(board, targetX) {
    const startX = 2;
    const direction = targetX > startX ? 1 : -1;
    for (let x = startX; x !== targetX; x += direction) {
    if (board[12][x] !== 0) return false;
    }
    return true;
    }
  
  /**
  - ぷよを配置
    */
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
    while (curY > 0 && board[curY-1][p.x] === 0) curY–;
    if (curY < 14) board[curY][p.x] = p.color;
    }
    
    for (let i = 0; i < WIDTH; i++) board[13][i] = 0;
    return true;
    }
  
  /**
  - 盤面上のぷよを一つ消したときに発生する最大連鎖数を探索する
    */
    function findMaxChainPuyo(board) {
    let bestChain = -1;
    let bestPuyo = null;
    
    for (let y = 0; y < 12; y++) {
    for (let x = 0; x < WIDTH; x++) {
    if (board[y][x] !== 0) {
    let isExposed = false;
    
    ```
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
    ```
    
    }
    return bestPuyo;
    }
  
  return { getBestMove, findMaxChainPuyo };
  })();

window.PuyoAI = PuyoAI;
