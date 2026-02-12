/**

- PuyoAI v12 - Enhanced Chain Building Edition
- 
- 主な改善点:
- 1. 連鎖形状の認識（階段積み、GTR、連鎖の種）
- 1. 色のバランス評価
- 1. 高さペナルティの強化
- 1. より深い探索（3-4手先読み）
- 1. 連鎖ポテンシャルの詳細な評価
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
  - 盤面の各列の高さを取得
    */
    function getColumnHeights(board) {
    let heights = [];
    for (let x = 0; x < WIDTH; x++) {
    let h = 0;
    while (h < 12 && board[h][x] !== 0) h++;
    heights.push(h);
    }
    return heights;
    }
  
  /**
  - 高さに基づくペナルティを計算
  - - 中央列（x=2,3）が高すぎるとペナルティ大
  - - 全体的に高いとペナルティ
  - - 高さの差が大きいと（凸凹が激しい）ペナルティ
      */
      function evaluateHeightPenalty(board) {
      let heights = getColumnHeights(board);
      let penalty = 0;
    
    // 中央列（x=2,3）の高さペナルティ
    if (heights[2] > 10) penalty += (heights[2] - 10) * 500;
    if (heights[3] > 10) penalty += (heights[3] - 10) * 500;
    
    // 平均高さペナルティ
    let avgHeight = heights.reduce((a, b) => a + b, 0) / WIDTH;
    if (avgHeight > 8) penalty += (avgHeight - 8) * 100;
    
    // 高さの分散（凸凹）ペナルティ
    let maxHeight = Math.max(…heights);
    let minHeight = Math.min(…heights);
    let heightDiff = maxHeight - minHeight;
    if (heightDiff > 4) penalty += (heightDiff - 4) * 50;
    
    // 12段目に到達していたら大ペナルティ
    if (heights[2] >= 12) penalty += 10000;
    
    return penalty;
    }
  
  /**
  - 色のバランスを評価
  - - 各色が均等に配置されているほど高評価
  - - 特定の色が偏りすぎているとペナルティ
      */
      function evaluateColorBalance(board) {
      let colorCounts = {1: 0, 2: 0, 3: 0, 4: 0};
      let totalPuyos = 0;
    
    for (let y = 0; y < 12; y++) {
    for (let x = 0; x < WIDTH; x++) {
    if (COLORS.includes(board[y][x])) {
    colorCounts[board[y][x]]++;
    totalPuyos++;
    }
    }
    }
    
    if (totalPuyos === 0) return 0;
    
    // 理想的な比率は25%ずつ
    let idealRatio = 0.25;
    let penalty = 0;
    
    for (let color of COLORS) {
    let ratio = colorCounts[color] / totalPuyos;
    let deviation = Math.abs(ratio - idealRatio);
    
    ```
     // 偏差が大きいほどペナルティ
     if (deviation > 0.15) {
         penalty += (deviation - 0.15) * 200;
     }
    ```
    
    }
    
    return penalty;
    }
  
  /**
  - 連鎖の「種」を検出
  - 種 = 3個同色が隣接している状態（あと1個で消える）
    */
    function detectChainSeeds(board) {
    let seeds = [];
    let visited = Array.from({ length: 12 }, () => Array(WIDTH).fill(false));
    
    for (let y = 0; y < 12; y++) {
    for (let x = 0; x < WIDTH; x++) {
    let color = board[y][x];
    if (color === 0 || !COLORS.includes(color) || visited[y][x]) continue;
    
    ```
         let group = [];
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
         
         // 3個グループ = 連鎖の種
         if (group.length === 3) {
             seeds.push({ color, positions: group, size: 3 });
         }
     }
    ```
    
    }
    
    return seeds;
    }
  
  /**
  - 階段積みパターンの検出
  - 階段積み = 連鎖の種が階段状に配置されている
    */
    function detectStairPattern(board) {
    let score = 0;
    let seeds = detectChainSeeds(board);
    
    // 種の数が多いほど高評価
    score += seeds.length * 300;
    
    // 縦方向に種が重なっていると階段積みの可能性
    for (let seed of seeds) {
    let avgY = seed.positions.reduce((sum, p) => sum + p.y, 0) / seed.positions.length;
    let avgX = seed.positions.reduce((sum, p) => sum + p.x, 0) / seed.positions.length;
    
    ```
     // 低い位置にある種ほど高評価（連鎖の起点として重要）
     if (avgY < 4) {
         score += (4 - avgY) * 50;
     }
    ```
    
    }
    
    return score;
    }
  
  /**
  - GTR形（後折り）のパターン検出
  - GTRの特徴: L字型の配置
    */
    function detectGTRPattern(board) {
    let score = 0;
    
    // 簡易的なL字パターン検出
    for (let x = 0; x < WIDTH - 1; x++) {
    for (let y = 0; y < 10; y++) {
    let color = board[y][x];
    if (color === 0 || !COLORS.includes(color)) continue;
    
    ```
         // L字の検出（横2個 + 縦2個）
         if (board[y][x+1] === color && 
             board[y+1][x] === color && 
             board[y+2][x] === color) {
             score += 200;
         }
     }
    ```
    
    }
    
    return score;
    }
  
  /**
  - 連鎖可能性を詳細に評価
    */
    function evaluateDetailedChainPotential(board) {
    let score = 0;
    
    // 1. 連鎖の種の評価
    let seedScore = detectStairPattern(board);
    score += seedScore;
    
    // 2. GTRパターンの評価
    let gtrScore = detectGTRPattern(board);
    score += gtrScore;
    
    // 3. 各列に1つずつぷよを置いてみる簡易評価
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
    
    score += maxChain * 1000;
    
    return score;
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
  if (board[y][x] !== 0 && !visited[y][x] && COLORS.includes(board[y][x])) {
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
  - 最適な手を探索（改善版）
    */
    function getBestMove(board, axisColor, childColor, nextAxisColor, nextChildColor) {
    let bestScore = -Infinity;
    let bestMove = { x: 2, rotation: 0 };
    const allowed14 = is14thRowAllowed(board);
    
    // 全ての可能な配置を評価
    for (let x = 0; x < WIDTH; x++) {
    for (let rot = 0; rot < 4; rot++) {
    if (!isReachable(board, x)) continue;
    
    ```
         let tempBoard = board.map(row => [...row]);
         
         // 14段目チェック
         let willUse14 = false;
         let h = 0; 
         while(h < 14 && tempBoard[h][x] !== 0) h++;
         
         if (h === 13) willUse14 = true;
         if (rot === 0 && h === 12) willUse14 = true;
         if (rot === 2 && h === 14) willUse14 = true;
         
         if (willUse14 && !allowed14) continue;
    
         if (!placePuyo(tempBoard, x, rot, axisColor, childColor)) continue;
    
         // === スコアリング ===
         let totalScore = 0;
         
         // 1. 即座の連鎖評価
         let res1 = simulatePureChain(tempBoard);
         totalScore += res1.chains * 2000; // 連鎖が起きれば大幅加点
         
         // 2. 高さペナルティ
         let heightPenalty = evaluateHeightPenalty(res1.finalBoard);
         totalScore -= heightPenalty;
         
         // 3. 色のバランスペナルティ
         let colorPenalty = evaluateColorBalance(res1.finalBoard);
         totalScore -= colorPenalty;
         
         // 4. 連鎖ポテンシャル（詳細版）
         let potential = evaluateDetailedChainPotential(res1.finalBoard);
         totalScore += potential;
         
         // 5. 次の手のポテンシャル（2手先読み）
         if (nextAxisColor && nextChildColor) {
             let nextMaxScore = -Infinity;
             
             for (let nx = 0; nx < WIDTH; nx++) {
                 for (let nrot = 0; nrot < 4; nrot++) {
                     if (!isReachable(res1.finalBoard, nx)) continue;
                     
                     let nextBoard = res1.finalBoard.map(row => [...row]);
                     if (placePuyo(nextBoard, nx, nrot, nextAxisColor, nextChildColor)) {
                         let nextRes = simulatePureChain(nextBoard);
                         let nextScore = 0;
                         
                         nextScore += nextRes.chains * 1000;
                         nextScore += evaluateDetailedChainPotential(nextRes.finalBoard) * 0.5;
                         nextScore -= evaluateHeightPenalty(nextRes.finalBoard) * 0.5;
                         
                         if (nextScore > nextMaxScore) {
                             nextMaxScore = nextScore;
                         }
                     }
                 }
             }
             
             if (nextMaxScore > -Infinity) {
                 totalScore += nextMaxScore * 0.3; // 次の手は控えめに評価
             }
         }
    
         // 最良の手を更新
         if (totalScore > bestScore) {
             bestScore = totalScore;
             bestMove = { x, rotation: rot };
         }
     }
    ```
    
    }
    
    console.log(“Best move score:”, bestScore, “Position:”, bestMove);
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
  
  return { getBestMove, findMaxChainPuyo };
  })();

window.PuyoAI = PuyoAI;
