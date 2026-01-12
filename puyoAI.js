/**
 * PuyoAI_advanced.js
 * - GTR/Stairs/Sandwich テンプレ検出
 * - ビームサーチ + MC 精査
 * - ランダムぷよ自動プレイのシミュレーションハーネス
 *
 * 使い方（Node例）:
 *   const AI = require('./PuyoAI_advanced');
 *   (async ()=> {
 *     let res = await AI.runSimulations(200, { depth: 3, beamWidth: 300, mcTrials: 120, maxMoves: 120 });
 *     console.log(res);
 *   })();
 */

const PuyoAI = (function() {
  const WIDTH = 6;
  const HEIGHT = 14;
  const COLORS = [1,2,3,4];

  // ---------- 基本シミュレータ ----------
  function copyBoard(b) { return b.map(r => [...r]); }
  function emptyBoard() { return Array.from({length:HEIGHT},()=>Array(WIDTH).fill(0)); }

  function simulatePureChain(board) {
    let totalChains = 0;
    while (true) {
      let toErase = Array.from({length:HEIGHT},()=>Array(WIDTH).fill(false));
      let visited = Array.from({length:HEIGHT},()=>Array(WIDTH).fill(false));
      let any = false;
      for (let y=0;y<HEIGHT;y++){
        for (let x=0;x<WIDTH;x++){
          if (board[y][x]!==0 && !visited[y][x]) {
            let color = board[y][x];
            let stack=[{x,y}], group=[];
            visited[y][x]=true;
            while(stack.length){
              let p = stack.pop(); group.push(p);
              [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx,dy])=>{
                let nx=p.x+dx, ny=p.y+dy;
                if (nx>=0 && nx<WIDTH && ny>=0 && ny<HEIGHT && !visited[ny][nx] && board[ny][nx]===color) {
                  visited[ny][nx]=true; stack.push({x:nx,y:ny});
                }
              });
            }
            if (group.length>=4) { any=true; group.forEach(p=>toErase[p.y][p.x]=true); }
          }
        }
      }
      if (!any) break;
      totalChains++;
      for (let y=0;y<HEIGHT;y++) for (let x=0;x<WIDTH;x++) if (toErase[y][x]) board[y][x]=0;
      // gravity (y=0 bottom)
      for (let x=0;x<WIDTH;x++){
        let write=0;
        for (let read=0;read<HEIGHT;read++){
          if (board[read][x]!==0) { board[write][x]=board[read][x]; if (write!==read) board[read][x]=0; write++; }
        }
        for (;write<HEIGHT;write++) board[write][x]=0;
      }
    }
    return { chains: totalChains };
  }

  // ---------- helpers ----------
  function getColumnHeights(board){
    let res=Array(WIDTH).fill(0);
    for (let x=0;x<WIDTH;x++){
      let h=0; while (h<HEIGHT && board[h][x]!==0) h++; res[x]=h;
    }
    return res;
  }
  function countHoles(board){
    let holes=0;
    for (let x=0;x<WIDTH;x++){
      let seen=false;
      for (let y=0;y<HEIGHT;y++){
        if (board[y][x]!==0) seen=true;
        else if (seen) holes++;
      }
    }
    return holes;
  }
  function heightVariance(heights){
    let mean=heights.reduce((a,b)=>a+b,0)/heights.length;
    return heights.reduce((s,h)=>s+(h-mean)*(h-mean),0)/heights.length;
  }

  // ---------- applyMove ----------
  // rotation: 0 = vertical (p1 above p2), 1 = horizontal (p1 left), 2 = vertical flipped (p1 below), 3 = horizontal flipped (p1 right)
  function applyMove(board, p1,p2, x, r){
    let b = copyBoard(board);
    let pos1x=x, pos2x=x;
    if (r===1) pos2x = x+1;
    else if (r===3) pos2x = x-1;
    if (pos1x<0||pos1x>=WIDTH||pos2x<0||pos2x>=WIDTH) return null;
    let h1=0; while(h1<HEIGHT && b[h1][pos1x]!==0) h1++;
    let h2=0; while(h2<HEIGHT && b[h2][pos2x]!==0) h2++;
    // same column vertical
    if (pos1x===pos2x){
      if (h1+1 >= HEIGHT) return null;
      if (r===0){
        // p1 above p2 -> place p2 at h1, p1 at h1+1
        b[h1][pos1x]=p2; b[h1+1][pos1x]=p1;
      } else if (r===2){
        b[h1][pos1x]=p1; b[h1+1][pos1x]=p2;
      } else return null;
    } else {
      if (h1>=HEIGHT || h2>=HEIGHT) return null;
      b[h1][pos1x]=p1; b[h2][pos2x]=p2;
    }
    return b;
  }

  // ---------- templates (より多くの典型フォームを登録) ----------
  // mask: 1 -> block required (any nonzero), 0 -> don't care, -1 -> must be empty
  function buildTemplateList(){
    const templates = [];
    // small stairs (3)
    templates.push({name:'stairs3_r', w:3,h:3, mask:[
      [0,0,1],
      [0,1,0],
      [1,0,0]
    ], weight:7000});
    templates.push({name:'stairs3_l', w:3,h:3, mask:[
      [1,0,0],
      [0,1,0],
      [0,0,1]
    ], weight:7000});
    // Sandwich simple
    templates.push({name:'sandwich3', w:3,h:3, mask:[
      [0,0,0],
      [1,0,1],
      [1,0,1]
    ], weight:9000});
    // GTR-style small (hook)
    templates.push({name:'gtr_hook1', w:4,h:3, mask:[
      [0,0,0,0],
      [1,1,1,1],
      [1,0,1,0]
    ], weight:12000});
    // More templates can be added (L-shapes, tails, 2-2 stairs etc.)
    return templates;
  }

  function matchTemplateAt(board, t, baseX, baseY){
    for (let ty=0; ty<t.h; ty++){
      for (let tx=0; tx<t.w; tx++){
        const m = t.mask[ty][tx];
        if (m===0) continue;
        // template top corresponds to high y value: align template bottom at baseY
        const by = baseY + (t.h - 1 - ty);
        const bx = baseX + tx;
        if (bx<0||bx>=WIDTH||by<0||by>=HEIGHT) return false;
        if (m===1 && board[by][bx]===0) return false;
        if (m===-1 && board[by][bx]!==0) return false;
      }
    }
    return true;
  }

  function detectTemplates(board, templates){
    let score=0;
    let counts={};
    for (let t of templates) counts[t.name]=0;
    for (let t of templates){
      for (let bx=-2; bx<WIDTH; bx++){
        for (let by=0; by<HEIGHT; by++){
          if (matchTemplateAt(board,t,bx,by)){
            score += t.weight;
            counts[t.name] = (counts[t.name]||0) + 1;
          }
        }
      }
    }
    return { score, counts };
  }

  // ---------- connection seed scoring ----------
  function countConnectionsEnhanced(board){
    let score=0;
    let vis=Array.from({length:HEIGHT},()=>Array(WIDTH).fill(false));
    for (let y=0;y<HEIGHT;y++) for (let x=0;x<WIDTH;x++){
      if (board[y][x]!==0 && !vis[y][x]){
        let col = board[y][x];
        let stack=[{x,y}], size=0; vis[y][x]=true;
        while(stack.length){
          let p = stack.pop(); size++;
          [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx,dy])=>{
            let nx=p.x+dx, ny=p.y+dy;
            if (nx>=0 && nx<WIDTH && ny>=0 && ny<HEIGHT && !vis[ny][nx] && board[ny][nx]===col){
              vis[ny][nx]=true; stack.push({x:nx,y:ny});
            }
          });
        }
        if (size===3) score+=20000;
        else if (size===2) score+=1500;
        else if (size===1) score+=300;
        if (size>=4) score -= 3000;
      }
    }
    return score;
  }

  // ---------- quickScore (枝刈り用) ----------
  function quickScore(board){
    let heights = getColumnHeights(board);
    let holes = countHoles(board);
    let varh = heightVariance(heights);
    let maxH = Math.max(...heights);
    let maxPen = Math.pow(Math.max(0, maxH - 8), 3) * 6000; // 強め
    let holePen = holes * 3000;
    let varPen = varh * 1300;
    let conn = countConnectionsEnhanced(board)*0.08;
    return - (maxPen + holePen + varPen) + conn;
  }

  // ---------- Monte Carlo overflow estimate ----------
  function simulateRandomFutureOverflowRate(board, trials=100, futurePairs=4){
    let overflow=0;
    for (let t=0;t<trials;t++){
      let b = copyBoard(board);
      let ov=false;
      for (let step=0; step<futurePairs; step++){
        let p1 = COLORS[Math.floor(Math.random()*COLORS.length)];
        let p2 = COLORS[Math.floor(Math.random()*COLORS.length)];
        // choose placement by quickScore greedy
        let best=null;
        for (let x=0;x<WIDTH;x++) for (let r=0;r<4;r++){
          let nb = applyMove(b,p1,p2,x,r);
          if (!nb) continue;
          let s = quickScore(nb);
          if (!best || s>best.score) best = {board:nb,score:s};
        }
        if (!best) { ov=true; break; }
        b = best.board;
        if (Math.max(...getColumnHeights(b))>=12){ ov=true; break; }
      }
      if (ov) overflow++;
    }
    return overflow / trials;
  }

  // ---------- evaluateBoard (総合) ----------
  function evaluateBoard(board, templates, options = {}){
    let heights = getColumnHeights(board);
    // immediate fatal
    let h3=0; while(h3<HEIGHT && board[h3][2]!==0) h3++; if (h3>=11) return { score:-2e7, details:{ reason:'col3_over' } };

    // potential chain: try placing single puyo in each column and sim
    let maxChain=0;
    for (let x=0;x<WIDTH;x++){
      let h=heights[x]; if (h>=HEIGHT-1) continue;
      for (let c of COLORS){
        let t = copyBoard(board); t[h][x]=c;
        let res = simulatePureChain(t);
        if (res.chains > maxChain) maxChain = res.chains;
      }
    }
    let potentialScore = Math.pow(Math.max(0,maxChain),6) * 1600;

    let tempRes = detectTemplates(board, templates);
    let conn = countConnectionsEnhanced(board);
    let holes = countHoles(board);
    let varh = heightVariance(heights);
    // strong column penalty
    let colPenalty = 0;
    for (let h of heights) if (h>8) colPenalty += Math.pow(h-8,3) * 5000;
    let holePen = holes * 3200;
    let varPen = varh * 1600;

    // MC overflow
    const mcTrials = options.mcTrials || 120;
    const futurePairs = options.futurePairs || 4;
    let overflowRate = simulateRandomFutureOverflowRate(board, mcTrials, futurePairs);
    let overflowPenalty = overflowRate * 1.5e7;

    let total = potentialScore + tempRes.score + conn - colPenalty - holePen - varPen - overflowPenalty;
    return { score: total, details: { maxChain, potentialScore, templateScore: tempRes.score, conn, colPenalty, holePen, varPen, overflowRate, heights } };
  }

  // ---------- Beam search + final MC精査 ----------
  function getBestMove(board, nextPuyos, options = {}){
    const depth = options.depth || Math.min(Math.floor(nextPuyos.length/2), 4);
    const beamWidth = options.beamWidth || 400;
    const templates = buildTemplateList();
    // initial beam
    let beam = [{ board: copyBoard(board), seq: [], score: 0 }];
    for (let step=0; step<depth; step++){
      let p1 = nextPuyos[step*2];
      let p2 = nextPuyos[step*2+1];
      let cand = [];
      for (let node of beam){
        for (let x=0;x<WIDTH;x++) for (let r=0;r<4;r++){
          let nb = applyMove(node.board, p1,p2, x, r);
          if (!nb) continue;
          // use quickScore + small template heuristics for pruning
          let s = quickScore(nb);
          cand.push({ board: nb, seq: node.seq.concat([{x,r,p1,p2}]), score: s });
        }
      }
      if (cand.length===0) break;
      cand.sort((a,b)=>b.score - a.score);
      beam = cand.slice(0, beamWidth);
    }
    // final MC evaluate beam members
    let best = null;
    for (let node of beam){
      let evalRes = evaluateBoard(node.board, templates, { mcTrials: options.mcTrials || 160, futurePairs: options.futurePairs || 4 });
      // measure actual chain that would occur immediately (simulatePureChain)
      let sim = simulatePureChain(copyBoard(node.board));
      let finalScore = evalRes.score + sim.chains * 90000;
      if (!best || finalScore > best.finalScore) best = { finalScore, node, evalRes, sim };
    }
    if (!best) return { x:2, rotation:0, expectedChains:0, score:-Infinity, info:null };
    let first = best.node.seq[0] || { x:2, r:0 };
    return { x:first.x, rotation:first.r, expectedChains: best.sim.chains, score: best.finalScore, info:{ seq: best.node.seq, evalDetails: best.evalRes.details, finalHeights: getColumnHeights(best.node.board), simulatedChains: best.sim.chains } };
  }

  // ---------- Simulation harness: play random games and report max chain achieved ----------
  async function simulateGameRandom(aiOptions = {}, maxMoves = 200){
    // game loop: generate random nextPuyos in sequence; use AI to pick placement for each pair
    let board = emptyBoard();
    let maxSingleChain = 0;
    // Pre-generate a long sequence of random pairs
    let pairCount = Math.ceil(maxMoves);
    let nextPairs = [];
    for (let i=0;i<pairCount;i++){
      nextPairs.push(COLORS[Math.floor(Math.random()*COLORS.length)]);
      nextPairs.push(COLORS[Math.floor(Math.random()*COLORS.length)]);
    }
    for (let step=0; step<pairCount; step++){
      let nextWindow = nextPairs.slice(step*2, step*2 + (aiOptions.depth ? aiOptions.depth*2 : 8));
      // ensure length for getBestMove
      while (nextWindow.length < (aiOptions.depth?aiOptions.depth*2:8)) {
        nextWindow.push(COLORS[Math.floor(Math.random()*COLORS.length)]);
      }
      let mv = getBestMove(board, nextWindow, aiOptions);
      let nb = applyMove(board, nextWindow[0], nextWindow[1], mv.x, mv.rotation);
      if (!nb) {
        // cannot place -> game over
        break;
      }
      board = nb;
      // after placement, immediate chain sim
      let simRes = simulatePureChain(board);
      if (simRes.chains > 0) {
        maxSingleChain = Math.max(maxSingleChain, simRes.chains);
        // after chains, board updated by simulatePureChain already in function - but we need to apply it to board
        // BUT simulatePureChain above mutates input; we passed board by reference. So board is already updated.
      }
      // overflow check
      let heights = getColumnHeights(board);
      if (Math.max(...heights) >= 12) break;
    }
    return maxSingleChain;
  }

  async function runSimulations(runCount = 200, options = {}) {
    const results = [];
    for (let i=0;i<runCount;i++){
      const maxChain = await simulateGameRandom(options, options.maxMoves || 200);
      results.push(maxChain);
      // lightweight progress log
      if ((i+1) % 20 === 0) {
        if (typeof process !== 'undefined' && process.stdout) process.stdout.write(`\rCompleted ${i+1}/${runCount}`);
      }
    }
    // stats
    let counts = {};
    for (let c of results) counts[c] = (counts[c]||0)+1;
    let max = Math.max(...results);
    let avg = results.reduce((a,b)=>a+b,0)/results.length;
    return { runs: runCount, maxChain: max, avgChain: avg, distribution: counts, all: results };
  }

  // export
  return {
    getBestMove,
    simulateGameRandom,
    runSimulations,
    // helpers exported for debugging
    simulatePureChain,
    applyMove,
    emptyBoard,
    copyBoard
  };
})();

// if Node, export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PuyoAI;
}
