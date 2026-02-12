/**

- PuyoAI v12 - Enhanced Chain Builder Edition
- 
- 主な改善点:
- 1. より詳細な評価関数（連結数、色の分布、高さバランス）
- 1. 探索深度の増加（3-4手先まで）
- 1. 連鎖形状の評価（階段、縦3など）
- 1. より賢い手の優先順位付け
   */
   const PuyoAI = (function() {
   const WIDTH = 6;
   const HEIGHT = 14;
   const COLORS = [1, 2, 3, 4];
   const SEARCH_DEPTH = 3; // 探索深度（3手先まで読む）
  
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
    score += evaluateConnections(board) * 50;
    
    // 2. 色の分布評価（色が散らばりすぎていないか）
    score += evaluateColorDistribution(board) * 30;
    
    // 3. 高さの評価（低い方が良い、バランスも重要）
    score += evaluateHeight(board) * 20;
    
    // 4. 連鎖形状の評価（階段、縦3など）
    score += evaluateChainShapes(board) * 100;
    
    // 5. 2連結・3連結の評価（連鎖の種）
    score += evaluateChainSeeds(board) * 80;
    
    // 6. 真ん中の高さペナルティ（3列目が高いと危険）
    let midHeight = 0;
    while (midHeight < 14 && board[midHeight][2] !== 0) midHeight++;
    if (midHeight > 10) score -= (midHeight - 10) * 500;
    
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
             
             // 2連結: +10, 3連結: +50, 4連結以上: +100
             if (group.length === 2) connectionScore += 10;
             else if (group.length === 3) connectionScore += 50;
             else if (group.length >= 4) connectionScore += 100;
         }
     }
    ```
    
    }
    return connectionScore;
    }
  
  /**
  - 色の分布を評価（各色がまとまっているか）
    */
    function evaluateColorDistribution(board) {
    let colorCounts = [0, 0, 0, 0, 0]; // index 0は未使用
    let colorCenters = [{x:0,y:0}, {x:0,y:0}, {x:0,y:0}, {x:0,y:0}, {x:0,y:0}];
    
    for (let y = 0; y < 12; y++) {
    for (let x = 0; x < WIDTH; x++) {
    let c = board[y][x];
    if (c !== 0) {
    colorCounts[c]++;
    colorCenters[c].x += x;
    colorCenters[c].y += y;
    }
    }
    }
    
    let distributionScore = 0;
    for (let c = 1; c <= 4; c++) {
    if (colorCounts[c] > 0) {
    // 色の重心を計算
    colorCenters[c].x /= colorCounts[c];
    colorCenters[c].y /= colorCounts[c];
    
    ```
         // 各ぷよが重心に近いほど良い
         let variance = 0;
         for (let y = 0; y < 12; y++) {
             for (let x = 0; x < WIDTH; x++) {
                 if (board[y][x] === c) {
                     let dx = x - colorCenters[c].x;
                     let dy = y - colorCenters[c].y;
                     variance += Math.sqrt(dx*dx + dy*dy);
                 }
             }
         }
         // 分散が小さいほど良い
         distributionScore -= variance;
     }
    ```
    
    }
    return distributionScore;
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
    let heightScore = -(avgHeight * avgHeight);
    
    // 高さのばらつきが少ないほど良い
    let variance = 0;
    for (let h of heights) {
    variance += (h - avgHeight) * (h - avgHeight);
    }
    heightScore -= variance;
    
    // 最大の高さが11を超えるとペナルティ
    if (maxHeight >= 11) heightScore -= 1000;
    
    return heightScore;
    }
  
  /**
  - 連鎖形状を評価（階段、縦3など）
    */
    function evaluateChainShapes(board) {
    let shapeScore = 0;
    
    // 階段形状の検出（横方向）
    for (let y = 0; y < 11; y++) {
    for (let x = 0; x < WIDTH - 1; x++) {
    if (board[y][x] !== 0 && board[y+1][x+1] !== 0) {
    // 階段の基本形
    if (board[y][x] === board[y+1][x+1]) {
    shapeScore += 20;
    }
    }
    }
    }
    
    // 縦3の検出
    for (let y = 0; y < 10; y++) {
    for (let x = 0; x < WIDTH; x++) {
    if (board[y][x] !== 0 &&
    board[y][x] === board[y+1][x] &&
    board[y+1][x] === board[y+2][x]) {
    shapeScore += 30;
    }
    }
    }
    
    // L字形状の検出
    for (let y = 0; y < 11; y++) {
    for (let x = 0; x < WIDTH - 1; x++) {
    let c = board[y][x];
    if (c !== 0) {
    // L字（右下）
    if (board[y+1][x] === c && board[y+1][x+1] === c) {
    shapeScore += 25;
    }
    // L字（右上）
    if (y > 0 && board[y-1][x] === c && board[y][x+1] === c) {
    shapeScore += 25;
    }
    }
    }
    }
    
    return shapeScore;
    }
  
  /**
  - 連鎖の種（2連結、3連結）を評価
    */
    function evaluateChainSeeds(board) {
    let seedScore = 0;
    
    // トリガーとなりうる位置を探す
    for (let y = 1; y < 11; y++) {
    for (let x = 0; x < WIDTH; x++) {
    if (board[y][x] === 0 && board[y-1][x] !== 0) {
    // この位置にぷよを置くと連鎖が起きるか？
    let color = board[y-1][x];
    let count = 1;
    
    ```
             // 周囲の同色をカウント
             [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx, dy]) => {
                 let nx = x + dx, ny = y + dy;
                 if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < 12 && 
                     board[ny][nx] === color) {
                     count++;
                 }
             });
             
             // あと1個で消える状態（3連結）は高評価
             if (count === 3) seedScore += 100;
             // あと2個で消える状態（2連結）も評価
             else if (count === 2) seedScore += 30;
         }
     }
    ```
    
    }
    
    return seedScore;
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
  
  /**
  - 深い探索を行う（ミニマックス風）
    */
    function searchBestMove(board, axisColor, childColor, depth, futurePuyos) {
    if (depth === 0) {
    // 葉ノード: 盤面を評価
    let chainRes = simulatePureChain(board);
    let chainScore = chainRes.chains * 1000;
    let boardScore = evaluateBoard(chainRes.finalBoard);
    return { score: chainScore + boardScore, move: null };
    }
    
    let bestScore = -Infinity;
    let bestMove = null;
    const allowed14 = is14thRowAllowed(board);
    
    // すべての可能な手を試す
    let moves = generatePossibleMoves(board, allowed14);
    
    for (let move of moves) {
    let tempBoard = board.map(row => […row]);
    
    ```
     if (!placePuyo(tempBoard, move.x, move.rotation, axisColor, childColor)) {
         continue;
     }
     
     // 連鎖を実行
     let chainRes = simulatePureChain(tempBoard);
     let immediateScore = chainRes.chains * 1000;
     
     // 次の手を探索
     let futureScore = 0;
     if (depth > 1 && futurePuyos && futurePuyos.length > 0) {
         let nextPuyo = futurePuyos[0];
         let remainingPuyos = futurePuyos.slice(1);
         let nextResult = searchBestMove(
             chainRes.finalBoard, 
             nextPuyo.axis, 
             nextPuyo.child, 
             depth - 1, 
             remainingPuyos
         );
         futureScore = nextResult.score * 0.8; // 未来の評価は割引
     } else {
         // 未来のぷよがない場合は盤面評価のみ
         futureScore = evaluateBoard(chainRes.finalBoard);
     }
     
     let totalScore = immediateScore + futureScore;
     
     // 中央が高すぎる場合は大きなペナルティ
     if (tempBoard[11][2] !== 0) {
         totalScore -= 100000;
     }
     
     if (totalScore > bestScore) {
         bestScore = totalScore;
         bestMove = move;
     }
    ```
    
    }
    
    return { score: bestScore, move: bestMove };
    }
  
  /**
  - 可能な手をすべて生成
    */
    function generatePossibleMoves(board, allowed14) {
    let moves = [];
    
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
         
         moves.push({ x, rotation: rot });
     }
    ```
    
    }
    
    return moves;
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
    // 未来のぷよリストを作成
    let futurePuyos = [];
    if (nextAxisColor && nextChildColor) {
    futurePuyos.push({ axis: nextAxisColor, child: nextChildColor });
    }
    
    // 深い探索を実行
    let result = searchBestMove(board, axisColor, childColor, SEARCH_DEPTH, futurePuyos);
    
    if (result.move) {
    return result.move;
    }
    
    // フォールバック: 安全な手を返す
    return { x: 2, rotation: 0 };
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
