/**

- PuyoAI v12 - System Compatible Edition with Loading Indicator
- 既存のpuyoSim.jsと完全互換の強化版AI + 思考中表示機能
  */
  const PuyoAI = (function() {
  const WIDTH = 6;
  const HEIGHT = 14;
  const COLORS = [1, 2, 3, 4];
  
  // ===== ユーティリティ関数 =====
  
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
  
  function isReachable(board, targetX) {
  const startX = 2;
  const direction = targetX > startX ? 1 : -1;
  for (let x = startX; x !== targetX; x += direction) {
  if (board[12][x] !== 0) return false;
  }
  return true;
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
  
  function processStep(board) {
  let visited = Array.from({ length: 12 }, () => Array(WIDTH).fill(false));
  let exploded = false;
  
  ```
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
  ```
  
  }
  
  function simulatePureChain(board) {
  let tempBoard = board.map(row => […row]);
  let chainCount = 0;
  let exploded = processStep(tempBoard);
  
  ```
   if (exploded) {
       chainCount++;
       while (true) {
           exploded = processStep(tempBoard);
           if (!exploded) break;
           chainCount++;
       }
   }
   
   return { chains: chainCount, finalBoard: tempBoard };
  ```
  
  }
  
  function placePuyo(board, x, rot, axisColor, childColor) {
  let coords = [];
  coords.push({x: x, y: 13, color: axisColor});
  
  ```
   if (rot === 0) coords.push({x: x, y: 14, color: childColor});
   else if (rot === 1) coords.push({x: x + 1, y: 13, color: childColor});
   else if (rot === 2) coords.push({x: x, y: 12, color: childColor});
   else if (rot === 3) coords.push({x: x - 1, y: 13, color: childColor});
  
   for (let p of coords) {
       if (p.x < 0 || p.x >= WIDTH) return false;
   }
  
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
  
  // ===== 評価関数 =====
  
  function evaluateConnections(board) {
  let connectionScore = 0;
  let visited = Array.from({ length: 12 }, () => Array(WIDTH).fill(false));
  
  ```
   for (let y = 0; y < 12; y++) {
       for (let x = 0; x < WIDTH; x++) {
           if (board[y][x] !== 0 && !visited[y][x]) {
               let color = board[y][x];
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
               
               if (group.length === 2) connectionScore += 15;
               else if (group.length === 3) connectionScore += 80;
               else if (group.length >= 4) connectionScore += 150;
           }
       }
   }
   return connectionScore;
  ```
  
  }
  
  function evaluateColorClustering(board) {
  let clusterScore = 0;
  
  ```
   for (let x = 0; x < WIDTH; x++) {
       let prevColor = 0;
       let streak = 0;
       
       for (let y = 0; y < 12; y++) {
           let c = board[y][x];
           if (c !== 0) {
               if (c === prevColor) {
                   streak++;
                   clusterScore += streak * 5;
               } else {
                   streak = 1;
                   prevColor = c;
               }
           }
       }
   }
   
   return clusterScore;
  ```
  
  }
  
  function evaluateHeight(board) {
  let totalHeight = 0;
  let maxHeight = 0;
  let heights = [];
  
  ```
   for (let x = 0; x < WIDTH; x++) {
       let h = 0;
       while (h < 12 && board[h][x] !== 0) h++;
       heights.push(h);
       totalHeight += h;
       if (h > maxHeight) maxHeight = h;
   }
   
   let avgHeight = totalHeight / WIDTH;
   let heightScore = -(avgHeight * avgHeight * 2);
   
   let variance = 0;
   for (let h of heights) {
       variance += (h - avgHeight) * (h - avgHeight);
   }
   heightScore -= variance * 2;
   
   if (maxHeight >= 11) heightScore -= 2000;
   
   return heightScore;
  ```
  
  }
  
  function evaluateChainShapes(board) {
  let shapeScore = 0;
  
  ```
   // 階段形状
   for (let y = 0; y < 11; y++) {
       for (let x = 0; x < WIDTH - 1; x++) {
           if (board[y][x] !== 0 && board[y+1][x+1] !== 0) {
               if (board[y][x] === board[y+1][x+1]) {
                   shapeScore += 30;
               }
           }
       }
   }
   
   // 縦3
   for (let y = 0; y < 10; y++) {
       for (let x = 0; x < WIDTH; x++) {
           if (board[y][x] !== 0 && 
               board[y][x] === board[y+1][x] && 
               board[y+1][x] === board[y+2][x]) {
               shapeScore += 50;
           }
       }
   }
   
   // L字形状
   for (let y = 1; y < 11; y++) {
       for (let x = 0; x < WIDTH - 1; x++) {
           let c = board[y][x];
           if (c !== 0) {
               if (board[y+1][x] === c && board[y+1][x+1] === c) {
                   shapeScore += 35;
               }
               if (board[y-1][x] === c && board[y][x+1] === c) {
                   shapeScore += 35;
               }
           }
       }
   }
   
   return shapeScore;
  ```
  
  }
  
  function evaluateTriggerPoints(board) {
  let triggerScore = 0;
  
  ```
   for (let y = 0; y < 11; y++) {
       for (let x = 0; x < WIDTH; x++) {
           if (board[y][x] === 0) {
               for (let color of COLORS) {
                   let count = 0;
                   
                   [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx, dy]) => {
                       let nx = x + dx, ny = y + dy;
                       if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < 12 && 
                           board[ny][nx] === color) {
                           count++;
                       }
                   });
                   
                   if (count === 3) triggerScore += 200;
                   else if (count === 2) triggerScore += 50;
               }
           }
       }
   }
   
   return triggerScore;
  ```
  
  }
  
  function evaluateBoard(board) {
  let score = 0;
  
  ```
   score += evaluateConnections(board) * 80;
   score += evaluateColorClustering(board) * 40;
   score += evaluateHeight(board) * 30;
   score += evaluateChainShapes(board) * 120;
   score += evaluateTriggerPoints(board) * 100;
   
   let midHeight = 0;
   while (midHeight < 14 && board[midHeight][2] !== 0) midHeight++;
   if (midHeight > 10) score -= (midHeight - 10) * 800;
   
   return score;
  ```
  
  }
  
  // ===== 思考中表示のヘルパー関数 =====
  
  function showThinkingIndicator(buttonId) {
  const button = document.getElementById(buttonId);
  if (button) {
  button.disabled = true;
  button.dataset.originalText = button.textContent;
  button.textContent = ‘思考中…’;
  button.style.opacity = ‘0.6’;
  }
  }
  
  function hideThinkingIndicator(buttonId) {
  const button = document.getElementById(buttonId);
  if (button && button.dataset.originalText) {
  button.disabled = false;
  button.textContent = button.dataset.originalText;
  button.style.opacity = ‘1’;
  delete button.dataset.originalText;
  }
  }
  
  // ===== メインAPI =====
  
  function getBestMove(board, axisColor, childColor, nextAxisColor, nextChildColor) {
  // 思考中表示を開始
  showThinkingIndicator(‘ai-button’);
  
  ```
   // 非同期処理でUIをブロックしないようにする
   return new Promise((resolve) => {
       setTimeout(() => {
           let bestScore = -Infinity;
           let bestMove = { x: 2, rotation: 0 };
           const allowed14 = is14thRowAllowed(board);
  
           for (let x = 0; x < WIDTH; x++) {
               if (!isReachable(board, x)) continue;
               
               for (let rot = 0; rot < 4; rot++) {
                   // 14段目チェック
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
  
                   let tempBoard = board.map(row => [...row]);
                   
                   if (!placePuyo(tempBoard, x, rot, axisColor, childColor)) {
                       continue;
                   }
  
                   let chainRes = simulatePureChain(tempBoard);
                   let immediateScore = chainRes.chains * 2000;
                   let boardQuality = evaluateBoard(chainRes.finalBoard);
                   
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
                   
                   if (tempBoard[11][2] !== 0) {
                       totalScore -= 200000;
                   }
                   
                   if (totalScore > bestScore) {
                       bestScore = totalScore;
                       bestMove = { x, rotation: rot };
                   }
               }
           }
           
           // 思考中表示を終了
           hideThinkingIndicator('ai-button');
           
           resolve(bestMove);
       }, 10); // UIを更新するための短い遅延
   });
  ```
  
  }
  
  function findMaxChainPuyo(board) {
  // 思考中表示を開始
  showThinkingIndicator(‘max-chain-button’);
  
  ```
   return new Promise((resolve) => {
       setTimeout(() => {
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
           
           // 思考中表示を終了
           hideThinkingIndicator('max-chain-button');
           
           resolve(bestPuyo);
       }, 10);
   });
  ```
  
  }
  
  return {
  getBestMove: getBestMove,
  findMaxChainPuyo: findMaxChainPuyo
  };
  })();

// グローバルスコープに公開
window.PuyoAI = PuyoAI;

console.log(‘PuyoAI v12 with Loading Indicator loaded successfully’);
