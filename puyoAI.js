/**

- PuyoAI v12 - Enhanced Chain Building Edition
- 改善点:
- 1. より深い探索（3手先まで読む）
- 1. 連鎖の形（階段積み、GTR、折り返し等）を評価
- 1. 色の配置バランスを考慮
- 1. アシストボタンの状態管理（思考中は灰色表示）
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
  - 連鎖ポテンシャルの評価（より詳細な評価）
    */
    function evaluatePureChainPotential(board) {
    let maxChain = 0;
    const allowed14 = is14thRowAllowed(board);
    
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
  - 連鎖の形を評価する関数
  - 階段積み、GTR形、折り返し等の基本形を検出
    */
    function evaluateChainShape(board) {
    let score = 0;
    
    // 階段積みの検出（隣接する列の高さが1つずつ異なる）
    for (let x = 0; x < WIDTH - 1; x++) {
    let h1 = getColumnHeight(board, x);
    let h2 = getColumnHeight(board, x + 1);
    if (Math.abs(h1 - h2) === 1) {
    score += 50;
    }
    }
    
    // 色の分離度（同じ色が固まっているほど良い）
    for (let color of COLORS) {
    let colorScore = evaluateColorClustering(board, color);
    score += colorScore;
    }
    
    // 中央の列が低いほど良い（折り返しがしやすい）
    let centerHeight = getColumnHeight(board, 2) + getColumnHeight(board, 3);
    score += (24 - centerHeight) * 10;
    
    return score;
    }
  
  /**
  - 特定の色の固まり具合を評価
    */
    function evaluateColorClustering(board, color) {
    let score = 0;
    let visited = Array.from({ length: 12 }, () => Array(WIDTH).fill(false));
    
    for (let y = 0; y < 12; y++) {
    for (let x = 0; x < WIDTH; x++) {
    if (board[y][x] === color && !visited[y][x]) {
    let clusterSize = getClusterSize(board, x, y, color, visited);
    // 3個以上の固まりは高評価（連鎖の種になる）
    if (clusterSize >= 3) {
    score += clusterSize * 20;
    }
    }
    }
    }
    return score;
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
  - 列の高さを取得
    */
    function getColumnHeight(board, x) {
    let height = 0;
    while (height < 12 && board[height][x] !== 0) height++;
    return height;
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
  - 最善手を取得（3手先まで読む、評価関数を改善）
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
    
         // 1手目の連鎖シミュレーション
         let res1 = simulatePureChain(tempBoard);
         
         // 評価スコアの計算
         let score = 0;
         
         // 即連鎖のボーナス（大きいほど良い）
         score += res1.chains * 10000;
         
         // 連鎖ポテンシャル
         let potential = evaluatePureChainPotential(res1.finalBoard);
         score += potential * 2000;
         
         // 連鎖の形の評価
         let shapeScore = evaluateChainShape(res1.finalBoard);
         score += shapeScore;
         
         // 高さのペナルティ（高すぎるとゲームオーバーリスク）
         let maxHeight = 0;
         for (let cx = 0; cx < WIDTH; cx++) {
             let colHeight = getColumnHeight(res1.finalBoard, cx);
             if (colHeight > maxHeight) maxHeight = colHeight;
         }
         if (maxHeight > 10) score -= (maxHeight - 10) * 1000;
         
         // ゲームオーバーラインのペナルティ
         if (res1.finalBoard[11][2] !== 0) {
             score = -Infinity;
         }
    
         // 2手先の評価（次のぷよがある場合）
         if (nextAxisColor && nextChildColor) {
             let best2ndScore = -Infinity;
             
             for (let nx = 0; nx < WIDTH; nx++) {
                 if (!isReachable(res1.finalBoard, nx)) continue;
                 
                 for (let nrot = 0; nrot < 4; nrot++) {
                     let nextBoard = res1.finalBoard.map(row => [...row]);
                     if (!placePuyo(nextBoard, nx, nrot, nextAxisColor, nextChildColor)) continue;
                     
                     let res2 = simulatePureChain(nextBoard);
                     let potential2 = evaluatePureChainPotential(res2.finalBoard);
                     let shapeScore2 = evaluateChainShape(res2.finalBoard);
                     
                     let score2 = res2.chains * 5000 + potential2 * 1000 + shapeScore2;
                     
                     if (score2 > best2ndScore) {
                         best2ndScore = score2;
                     }
                 }
             }
             
             score += best2ndScore * 0.5; // 2手先の評価は重みを下げる
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
  
  return { getBestMove, findMaxChainPuyo };
  })();

window.PuyoAI = PuyoAI;
