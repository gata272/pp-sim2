/**

- PuyoAI v12 - Enhanced & Compatible Edition
- 
- 主な改善点:
- 1. より詳細な評価関数（連結数、色の分布、高さバランス、連鎖形状）
- 1. 探索深度を2手に調整（処理速度とのバランス）
- 1. 既存システムとの完全互換性
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
  - 高度な盤面評価関数
    */
    function evaluateBoard(board) {
    let score = 0;
    
    // 1. 連結数の評価（同色が隣接している数）
    score += evaluateConnections(board) * 80;
    
    // 2. 色の集中度評価（色がまとまっているか）
    score += evaluateColorClustering(board) * 40;
    
    // 3. 高さの評価（低い方が良い、バランスも重要）
    score += evaluateHeight(board) * 30;
    
    // 4. 連鎖形状の評価（階段、縦3など）
    score += evaluateChainShapes(board) * 120;
    
    // 5. トリガー候補の評価（あと1個で消える位置）
    score += evaluateTriggerPoints(board) * 100;
    
    // 6. 真ん中の高さペナルティ（3列目が高いと危険）
    let midHeight = 0;
    while (midHeight < 14 && board[midHeight][2] !== 0) midHeight++;
    if (midHeight > 10) score -= (midHeight - 10) * 800;
    
    return score;
    }
  
  /**
  - 連結数を評価（同色が隣接している数）
    */
    function evaluateConnections(board) {
    let connectionScore = 0;
    let visited = Array.from({ length: 12 }, () => Array(WIDTH).fill(false));
    
    for (let y = 0; y < 12; y++) {
    for (let x = 0; x < WIDTH; x++) {
    if (board[y][x] !== 0 && !visited[y][x]) {
    let color = board[y][x];
    let group = [];
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
             
             // 2連結: +15, 3連結: +80, 4連結以上: +150
             if (group.length === 2) connectionScore += 15;
             else if (group.length === 3) connectionScore += 80;
             else if (group.length >= 4) connectionScore += 150;
         }
     }
    ```
    
    }
    return connectionScore;
    }
  
  /**
  - 色の集中度を評価（各色が縦に積まれているか）
    */
    function evaluateColorClustering(board) {
    let clusterScore = 0;
    
    // 各列の色の連続性を評価
    for (let x = 0; x < WIDTH; x++) {
    let prevColor = 0;
    let streak = 0;
    
    ```
     for (let y = 0; y < 12; y++) {
         let c = board[y][x];
         if (c !== 0) {
             if (c === prevColor) {
                 streak++;
                 // 縦に連続しているほど良い
                 clusterScore += streak * 5;
             } else {
                 streak = 1;
                 prevColor = c;
             }
         }
     }
    ```
    
    }
    
    return clusterScore;
    }
  
  /**
  - 高さを評価
    */
    function evaluateHeight(board) {
    let totalHeight = 0;
    let maxHeight = 0;
    let heights = [];
    
    for (let x = 0; x < WIDTH; x++) {
    let h = 0;
    while (h < 12 && board[h][x] !== 0) h++;
    heights.push(h);
    totalHeight += h;
    if (h > maxHeight) maxHeight = h;
    }
    
    // 平均の高さが低いほど良い
    let avgHeight = totalHeight / WIDTH;
    let heightScore = -(avgHeight * avgHeight * 2);
    
    // 高さのばらつきが少ないほど良い
    let variance = 0;
    for (let h of heights) {
    variance += (h - avgHeight) * (h - avgHeight);
    }
    heightScore -= variance * 2;
    
    // 最大の高さが11を超えるとペナルティ
    if (maxHeight >= 11) heightScore -= 2000;
    
    return heightScore;
    }
  
  /**
  - 連鎖形状を評価（階段、縦3など）
    */
    function evaluateChainShapes(board) {
    let shapeScore = 0;
    
    // 階段形状の検出
    for (let y = 0; y < 11; y++) {
    for (let x = 0; x < WIDTH - 1; x++) {
    if (board[y][x] !== 0 && board[y+1][x+1] !== 0) {
    if (board[y][x] === board[y+1][x+1]) {
    shapeScore += 30;
    }
    }
    }
    }
    
    // 縦3の検出（強力な連鎖の基本）
    for (let y = 0; y < 10; y++) {
    for (let x = 0; x < WIDTH; x++) {
    if (board[y][x] !== 0 &&
    board[y][x] === board[y+1][x] &&
    board[y+1][x] === board[y+2][x]) {
    shapeScore += 50;
    }
    }
    }
    
    // L字形状の検出
    for (let y = 1; y < 11; y++) {
    for (let x = 0; x < WIDTH - 1; x++) {
    let c = board[y][x];
    if (c !== 0) {
    // L字（右下）
    if (board[y+1][x] === c && board[y+1][x+1] === c) {
    shapeScore += 35;
    }
    // L字（右上）
    if (board[y-1][x] === c && board[y][x+1] === c) {
    shapeScore += 35;
    }
    }
    }
    }
    
    return shapeScore;
    }
  
  /**
  - トリガー候補を評価（あと1個で消える位置）
    */
    function evaluateTriggerPoints(board) {
    let triggerScore = 0;
    
    for (let y = 0; y < 11; y++) {
    for (let x = 0; x < WIDTH; x++) {
    if (board[y][x] === 0) {
    // この空白に各色を置いた場合を評価
    for (let color of COLORS) {
    let count = 0;
    
    ```
                 // 周囲の同色をカウント
                 [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx, dy]) => {
                     let nx = x + dx, ny = y + dy;
                     if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < 12 && 
                         board[ny][nx] === color) {
                         count++;
                     }
                 });
                 
                 // あと1個で消える（3連結）は非常に高評価
                 if (count === 3) triggerScore += 200;
                 // あと2個で消える（2連結）も評価
                 else if (count === 2) triggerScore += 50;
             }
         }
     }
    ```
    
    }
    
    return triggerScore;
    }
  
  /**
  - 実際の連鎖をシミュレーション
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
  
  /**
  - 最適な手を取得（メインAPI）
    */
    function getBestMove(board, axisColor, childColor, nextAxisColor, nextChildColor) {
    let bestScore = -Infinity;
    let bestMove = { x: 2, rotation: 0 };
    const allowed14 = is14thRowAllowed(board);
    
    // すべての可能な手を評価
    for (let x = 0; x < WIDTH; x++) {
    if (!isReachable(board, x)) continue;
    
    ```
     for (let rot = 0; rot < 4; rot++) {
         // 14段目への設置チェック
         let h = 0;
         while(h < 14 && board[h][x] !== 0) h++;
         
         let willUse14 = false;
         if (h === 13) willUse14 = true;
         if (rot === 0 && h === 12) willUse14 = true;
         if (rot === 1 && x < WIDTH - 1) {
             let rh = 0;
             while(rh < 14 && board[rh][x+1] !== 0) rh++;
             if (rh === 13) willUse14 = true;
         }
         if (rot === 3 && x > 0) {
             let lh = 0;
             while(lh < 14 && board[lh][x-1] !== 0) lh++;
             if (lh === 13) willUse14 = true;
         }
         
         if (willUse14 && !allowed14) continue;
    
         // 盤面をコピーして手を試す
         let tempBoard = board.map(row => [...row]);
         
         if (!placePuyo(tempBoard, x, rot, axisColor, childColor)) {
             continue;
         }
    
         // 即座の連鎖を計算
         let chainRes = simulatePureChain(tempBoard);
         let immediateScore = chainRes.chains * 2000; // 連鎖は非常に高評価
         
         // 盤面の質を評価
         let boardQuality = evaluateBoard(chainRes.finalBoard);
         
         // 次の手の評価（1手先読み）
         let futureScore = 0;
         if (nextAxisColor && nextChildColor) {
             let maxFutureScore = -Infinity;
             
             for (let nx = 0; nx < WIDTH; nx++) {
                 if (!isReachable(chainRes.finalBoard, nx)) continue;
                 
                 for (let nrot = 0; nrot < 4; nrot++) {
                     let nextBoard = chainRes.finalBoard.map(row => [...row]);
                     
                     if (placePuyo(nextBoard, nx, nrot, nextAxisColor, nextChildColor)) {
                         let nextChainRes = simulatePureChain(nextBoard);
                         let nextScore = nextChainRes.chains * 1000 + evaluateBoard(nextChainRes.finalBoard) * 0.6;
                         
                         if (nextScore > maxFutureScore) {
                             maxFutureScore = nextScore;
                         }
                     }
                 }
             }
             
             futureScore = maxFutureScore;
         }
         
         let totalScore = immediateScore + boardQuality + futureScore;
         
         // 中央が高すぎる場合は大きなペナルティ
         if (tempBoard[11][2] !== 0) {
             totalScore -= 200000;
         }
         
         if (totalScore > bestScore) {
             bestScore = totalScore;
             bestMove = { x, rotation: rot };
         }
     }
    ```
    
    }
    
    return bestMove;
    }
  
  function placePuyo(board, x, rot, axisColor, childColor) {
  let coords = [];
  coords.push({x: x, y: 13, color: axisColor});
  
  ```
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
  ```
  
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
