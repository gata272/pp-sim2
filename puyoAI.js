/**

- PuyoAI v13 - Transparent Thinking Edition
- 
- 思考過程を可視化:
- - 思考中のローディング表示
- - 各配置の評価スコア詳細
- - 最終的な判断理由の表示
    */
    const PuyoAI = (function() {
    const WIDTH = 6;
    const HEIGHT = 14;
    const COLORS = [1, 2, 3, 4];
  
  // 思考ログ用の配列
  let thinkingLog = [];
  let isThinking = false;
  
  /**
  - 思考ログをクリア
    */
    function clearThinkingLog() {
    thinkingLog = [];
    }
  
  /**
  - 思考ログに追加
    */
    function addThinkingLog(message, data = {}) {
    thinkingLog.push({
    message,
    data,
    timestamp: Date.now()
    });
    
    // UIに反映
    updateThinkingDisplay();
    }
  
  /**
  - 思考過程をUIに表示
    */
    function updateThinkingDisplay() {
    const thinkingPanel = document.getElementById(‘ai-thinking-panel’);
    if (!thinkingPanel) return;
    
    if (isThinking && thinkingLog.length > 0) {
    const lastLog = thinkingLog[thinkingLog.length - 1];
    thinkingPanel.innerHTML = `<div class="thinking-message">${lastLog.message}</div> ${Object.keys(lastLog.data).length > 0 ? `<div class="thinking-details">${formatThinkingData(lastLog.data)}</div>` : ''}`;
    thinkingPanel.style.display = ‘block’;
    } else {
    thinkingPanel.style.display = ‘none’;
    }
    }
  
  /**
  - 思考データを整形
    */
    function formatThinkingData(data) {
    let html = ‘<ul>’;
    for (let [key, value] of Object.entries(data)) {
    if (typeof value === ‘number’) {
    value = Math.round(value * 10) / 10; // 小数点1桁
    }
    html += `<li><strong>${key}:</strong> ${value}</li>`;
    }
    html += ‘</ul>’;
    return html;
    }
  
  /**
  - 思考結果の詳細をコンソールとUIに出力
    */
    function showThinkingResult(evaluations, bestMove) {
    console.log(”=== AI思考結果 ===”);
    console.log(“評価した配置数:”, evaluations.length);
    
    // トップ5を表示
    const topEvaluations = evaluations
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 5);
    
    console.log(”\nトップ5の配置:”);
    topEvaluations.forEach((ev, idx) => {
    console.log(`${idx + 1}. x=${ev.x}, rot=${ev.rotation}, スコア=${Math.round(ev.totalScore)}`);
    console.log(`   即座の連鎖: ${ev.immediateChain}鎖`);
    console.log(`   ポテンシャル: ${Math.round(ev.potential)}`);
    console.log(`   高さペナルティ: -${Math.round(ev.heightPenalty)}`);
    console.log(`   色バランス: -${Math.round(ev.colorPenalty)}`);
    if (ev.nextScore !== undefined) {
    console.log(`   次の手評価: ${Math.round(ev.nextScore)}`);
    }
    });
    
    // UIに詳細を表示
    const detailsPanel = document.getElementById(‘ai-details-panel’);
    if (detailsPanel) {
    let html = ‘<div class="ai-result-header">🤔 AI思考結果</div>’;
    html += `<div class="ai-result-best">最良の手: x=${bestMove.x}, 回転=${['↑', '→', '↓', '←'][bestMove.rotation]}</div>`;
    html += ‘<div class="ai-result-top">トップ5の候補:</div>’;
    html += ‘<ol class="ai-evaluations-list">’;
    
    ```
     topEvaluations.forEach(ev => {
         const isSelected = ev.x === bestMove.x && ev.rotation === bestMove.rotation;
         html += `<li class="${isSelected ? 'selected' : ''}">`;
         html += `<div class="eval-position">x=${ev.x}, 回転=${['↑', '→', '↓', '←'][ev.rotation]} (${Math.round(ev.totalScore)}点)</div>`;
         html += '<div class="eval-breakdown">';
         html += `<span class="eval-item">連鎖: ${ev.immediateChain}鎖</span>`;
         html += `<span class="eval-item">形: +${Math.round(ev.potential)}</span>`;
         html += `<span class="eval-item">高さ: -${Math.round(ev.heightPenalty)}</span>`;
         html += '</div>';
         html += '</li>';
     });
     
     html += '</ol>';
     detailsPanel.innerHTML = html;
     detailsPanel.style.display = 'block';
    ```
    
    }
    }
  
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
    */
    function evaluateHeightPenalty(board) {
    let heights = getColumnHeights(board);
    let penalty = 0;
    
    if (heights[2] > 10) penalty += (heights[2] - 10) * 500;
    if (heights[3] > 10) penalty += (heights[3] - 10) * 500;
    
    let avgHeight = heights.reduce((a, b) => a + b, 0) / WIDTH;
    if (avgHeight > 8) penalty += (avgHeight - 8) * 100;
    
    let maxHeight = Math.max(…heights);
    let minHeight = Math.min(…heights);
    let heightDiff = maxHeight - minHeight;
    if (heightDiff > 4) penalty += (heightDiff - 4) * 50;
    
    if (heights[2] >= 12) penalty += 10000;
    
    return penalty;
    }
  
  /**
  - 色のバランスを評価
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
    
    let idealRatio = 0.25;
    let penalty = 0;
    
    for (let color of COLORS) {
    let ratio = colorCounts[color] / totalPuyos;
    let deviation = Math.abs(ratio - idealRatio);
    
    ```
     if (deviation > 0.15) {
         penalty += (deviation - 0.15) * 200;
     }
    ```
    
    }
    
    return penalty;
    }
  
  /**
  - 連鎖の「種」を検出
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
    */
    function detectStairPattern(board) {
    let score = 0;
    let seeds = detectChainSeeds(board);
    
    score += seeds.length * 300;
    
    for (let seed of seeds) {
    let avgY = seed.positions.reduce((sum, p) => sum + p.y, 0) / seed.positions.length;
    
    ```
     if (avgY < 4) {
         score += (4 - avgY) * 50;
     }
    ```
    
    }
    
    return score;
    }
  
  /**
  - GTR形（後折り）のパターン検出
    */
    function detectGTRPattern(board) {
    let score = 0;
    
    for (let x = 0; x < WIDTH - 1; x++) {
    for (let y = 0; y < 10; y++) {
    let color = board[y][x];
    if (color === 0 || !COLORS.includes(color)) continue;
    
    ```
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
    
    let seedScore = detectStairPattern(board);
    score += seedScore;
    
    let gtrScore = detectGTRPattern(board);
    score += gtrScore;
    
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
  - 最適な手を探索（思考過程を表示）
    */
    function getBestMove(board, axisColor, childColor, nextAxisColor, nextChildColor) {
    isThinking = true;
    clearThinkingLog();
    
    addThinkingLog(“🤔 思考開始…”);
    
    let bestScore = -Infinity;
    let bestMove = { x: 2, rotation: 0 };
    let evaluations = [];
    const allowed14 = is14thRowAllowed(board);
    
    addThinkingLog(“📊 可能な配置を評価中…”);
    
    let evaluatedCount = 0;
    
    // 全ての可能な配置を評価
    for (let x = 0; x < WIDTH; x++) {
    for (let rot = 0; rot < 4; rot++) {
    if (!isReachable(board, x)) continue;
    
    ```
         let tempBoard = board.map(row => [...row]);
         
         let willUse14 = false;
         let h = 0; 
         while(h < 14 && tempBoard[h][x] !== 0) h++;
         
         if (h === 13) willUse14 = true;
         if (rot === 0 && h === 12) willUse14 = true;
         if (rot === 2 && h === 14) willUse14 = true;
         
         if (willUse14 && !allowed14) continue;
    
         if (!placePuyo(tempBoard, x, rot, axisColor, childColor)) continue;
    
         evaluatedCount++;
         
         // 評価中の表示を更新
         if (evaluatedCount % 5 === 0) {
             addThinkingLog(`評価中... (${evaluatedCount}手目)`);
         }
    
         // === スコアリング ===
         let totalScore = 0;
         let evaluation = {
             x: x,
             rotation: rot,
             immediateChain: 0,
             potential: 0,
             heightPenalty: 0,
             colorPenalty: 0,
             totalScore: 0
         };
         
         // 1. 即座の連鎖評価
         let res1 = simulatePureChain(tempBoard);
         evaluation.immediateChain = res1.chains;
         totalScore += res1.chains * 2000;
         
         // 2. 高さペナルティ
         let heightPenalty = evaluateHeightPenalty(res1.finalBoard);
         evaluation.heightPenalty = heightPenalty;
         totalScore -= heightPenalty;
         
         // 3. 色のバランスペナルティ
         let colorPenalty = evaluateColorBalance(res1.finalBoard);
         evaluation.colorPenalty = colorPenalty;
         totalScore -= colorPenalty;
         
         // 4. 連鎖ポテンシャル
         let potential = evaluateDetailedChainPotential(res1.finalBoard);
         evaluation.potential = potential;
         totalScore += potential;
         
         // 5. 次の手のポテンシャル
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
                 evaluation.nextScore = nextMaxScore * 0.3;
                 totalScore += nextMaxScore * 0.3;
             }
         }
    
         evaluation.totalScore = totalScore;
         evaluations.push(evaluation);
    
         if (totalScore > bestScore) {
             bestScore = totalScore;
             bestMove = { x, rotation: rot };
             
             addThinkingLog(`✨ 新しい最良手発見!`, {
                 '位置': `x=${x}, 回転=${['↑', '→', '↓', '←'][rot]}`,
                 'スコア': Math.round(totalScore),
                 '即座の連鎖': `${res1.chains}鎖`
             });
         }
     }
    ```
    
    }
    
    addThinkingLog(“✅ 思考完了!”, {
    ‘評価した手数’: evaluatedCount,
    ‘最良の手’: `x=${bestMove.x}, 回転=${['↑', '→', '↓', '←'][bestMove.rotation]}`,
    ‘スコア’: Math.round(bestScore)
    });
    
    // 思考結果の詳細を表示
    showThinkingResult(evaluations, bestMove);
    
    isThinking = false;
    updateThinkingDisplay();
    
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
