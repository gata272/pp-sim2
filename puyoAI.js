/**
 * PuyoAI_vFlexibleChain.js
 * - Flattening bias removed; flexible uneven shapes enabled
 * - Potential (future chain) and Δpotential are the dominant factors
 * - Templates and seed-count kept and rewarded
 * - Returns assist.axis and assist.child coordinates for drawing
 *
 * API:
 *   getBestMove(board, nextPuyos, options)
 *     nextPuyos: [axis, child, nextAxis, nextChild, ...]
 *     options:
 *       allow14thRule (default true)
 *       lookaheadNext (default false)
 *
 * Returns:
 *   { x, rotation, assist: {axis:{x,y}, child:{x,y}}, info }
 */

const PuyoAI = (function(){
  const WIDTH = 6;
  const HEIGHT = 14;
  const COLORS = [1,2,3,4];

  // -------------------------
  // utilities
  // -------------------------
  function clone(board){ return board.map(r => [...r]); }
  function emptyBoard(){ return Array.from({length: HEIGHT}, ()=>Array(WIDTH).fill(0)); }
  function getHeights(board){
    const h = Array(WIDTH).fill(0);
    for(let x=0;x<WIDTH;x++){
      let y=0; while(y<HEIGHT && board[y][x] !== 0) y++;
      h[x] = y;
    }
    return h;
  }
  function countHoles(board){
    let holes = 0;
    for(let x=0;x<WIDTH;x++){
      let seen = false;
      for(let y=0;y<HEIGHT;y++){
        if(board[y][x] !== 0) seen = true;
        else if(seen) holes++;
      }
    }
    return holes;
  }
  function heightVariance(heights){
    const mean = heights.reduce((a,b)=>a+b,0)/heights.length;
    return heights.reduce((s,h)=>s + (h-mean)*(h-mean),0)/heights.length;
  }

  // -------------------------
  // v11 special 14th-row rule
  // -------------------------
  function is14thRowAllowed(board){
    let has12=false, has13=false;
    for(let x=0;x<WIDTH;x++){
      let h=0; while(h<HEIGHT && board[h][x] !== 0) h++;
      if(h === 12) has12 = true;
      if(h === 13) has13 = true;
    }
    return has12 && has13;
  }

  // -------------------------
  // compute drop coords (no mutation)
  // rotation: 0 vertical (axis above child), 2 vertical flipped (axis below child)
  // 1 horizontal (axis left), 3 horizontal flipped (axis right)
  // -------------------------
  function computeDropCoords(board, targetX, rotation, options = { allow14thRule: true }){
    const heights = getHeights(board);
    let pos1x = targetX, pos2x = targetX;
    if(rotation === 1) pos2x = targetX + 1;
    else if(rotation === 3) pos2x = targetX - 1;
    if(pos1x < 0 || pos1x >= WIDTH || pos2x < 0 || pos2x >= WIDTH) return null;

    let h1 = heights[pos1x], h2 = heights[pos2x];

    if(pos1x === pos2x){
      // need two cells
      if(h1 + 1 >= HEIGHT) return null;
      const axisY = (rotation === 0) ? (h1+1) : h1;
      const childY = (rotation === 0) ? h1 : (h1+1);
      if(!options.allow14thRule){
        if(axisY === 13 || childY === 13) return null;
      } else {
        if((axisY === 13 || childY === 13) && !is14thRowAllowed(board)) return null;
      }
      return { axis: {x: pos1x, y: axisY}, child: {x: pos2x, y: childY} };
    } else {
      if(h1 >= HEIGHT || h2 >= HEIGHT) return null;
      if(!options.allow14thRule){
        if(h1 === 13 || h2 === 13) return null;
      } else {
        if((h1===13 || h2===13) && !is14thRowAllowed(board)) return null;
      }
      return { axis: {x: pos1x, y: h1}, child: {x: pos2x, y: h2} };
    }
  }

  // -------------------------
  // placePuyo (uses computeDropCoords)
  // returns new board or null
  // -------------------------
  function placePuyo(board, x, rotation, axisColor, childColor, options = { allow14thRule: true }){
    const coords = computeDropCoords(board, x, rotation, options);
    if(!coords) return null;
    const nb = clone(board);
    nb[coords.axis.y][coords.axis.x] = axisColor;
    nb[coords.child.y][coords.child.x] = childColor;
    // v11 semantics: clear row 13 (auto-delete) after placement
    for(let i=0;i<WIDTH;i++) nb[13][i] = 0;
    return nb;
  }

  // -------------------------
  // gravity & simulate chain (same y<12 rule)
  // -------------------------
  function applyGravity(board){
    for(let x=0;x<WIDTH;x++){
      let write = 0;
      for(let r=0;r<HEIGHT;r++){
        if(board[r][x] !== 0){
          board[write][x] = board[r][x];
          if(write !== r) board[r][x] = 0;
          write++;
        }
      }
      for(; write<HEIGHT; write++) board[write][x] = 0;
    }
  }

  function simulatePureChain(board){
    const b = clone(board);
    let totalChains = 0;
    while(true){
      let toErase = Array.from({length:HEIGHT}, ()=>Array(WIDTH).fill(false));
      let visited = Array.from({length:12}, ()=>Array(WIDTH).fill(false));
      let any = false;
      for(let y=0;y<12;y++){
        for(let x=0;x<WIDTH;x++){
          if(b[y][x] !== 0 && !visited[y][x]){
            const color = b[y][x];
            let stack = [{x,y}], group=[];
            visited[y][x] = true;
            while(stack.length){
              const p = stack.pop();
              group.push(p);
              [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx,dy])=>{
                const nx = p.x + dx, ny = p.y + dy;
                if(nx>=0 && nx<WIDTH && ny>=0 && ny<12 && !visited[ny][nx] && b[ny][nx] === color){
                  visited[ny][nx] = true;
                  stack.push({x:nx,y:ny});
                }
              });
            }
            if(group.length >= 4){
              any = true;
              group.forEach(p => toErase[p.y][p.x] = true);
            }
          }
        }
      }
      if(!any) break;
      totalChains++;
      for(let y=0;y<HEIGHT;y++) for(let x=0;x<WIDTH;x++) if(toErase[y][x]) b[y][x] = 0;
      applyGravity(b);
    }
    return { chains: totalChains, finalBoard: b };
  }

  // -------------------------
  // templates (small set; can expand)
  // -------------------------
  function buildTemplates(){
    const templates = [];
    templates.push({name:'stairs3_r', w:3,h:3, mask:[
      [0,0,1],[0,1,0],[1,0,0]
    ], weight:6000});
    templates.push({name:'stairs3_l', w:3,h:3, mask:[
      [1,0,0],[0,1,0],[0,0,1]
    ], weight:6000});
    templates.push({name:'sandwich', w:3,h:3, mask:[
      [0,0,0],[1,0,1],[1,0,1]
    ], weight:9000});
    templates.push({name:'gtr_hook', w:4,h:3, mask:[
      [0,0,0,0],[1,1,1,1],[1,0,1,0]
    ], weight:12000});
    return templates;
  }
  function matchTemplateAt(board, t, baseX, baseY){
    for(let ty=0; ty<t.h; ty++){
      for(let tx=0; tx<t.w; tx++){
        const m = t.mask[ty][tx];
        if(m===0) continue;
        const by = baseY + (t.h - 1 - ty);
        const bx = baseX + tx;
        if(bx<0||bx>=WIDTH||by<0||by>=HEIGHT) return false;
        if(m===1 && board[by][bx]===0) return false;
        if(m===-1 && board[by][bx]!==0) return false;
      }
    }
    return true;
  }
  function detectTemplateScore(board, templates){
    let score = 0;
    let counts = {};
    templates.forEach(t => counts[t.name]=0);
    for(const t of templates){
      for(let bx=-2; bx<WIDTH; bx++){
        for(let by=0; by<HEIGHT; by++){
          if(matchTemplateAt(board, t, bx, by)){
            score += t.weight;
            counts[t.name] = (counts[t.name]||0) + 1;
          }
        }
      }
    }
    return { score, counts };
  }

  // -------------------------
  // seeds (3-group count) - returns fractional count
  // -------------------------
  function countSeeds(board){
    let score = 0;
    const vis = Array.from({length:HEIGHT}, ()=>Array(WIDTH).fill(false));
    for(let y=0;y<HEIGHT;y++){
      for(let x=0;x<WIDTH;x++){
        if(board[y][x] !== 0 && !vis[y][x]){
          const col = board[y][x];
          let stack = [{x,y}], size=0;
          vis[y][x] = true;
          while(stack.length){
            const p = stack.pop(); size++;
            [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx,dy])=>{
              const nx = p.x + dx, ny = p.y + dy;
              if(nx>=0 && nx<WIDTH && ny>=0 && ny<HEIGHT && !vis[ny][nx] && board[ny][nx] === col){
                vis[ny][nx] = true; stack.push({x:nx,y:ny});
              }
            });
          }
          if(size === 3) score += 1.0;
          else if(size === 2) score += 0.25;
          else if(size === 1) score += 0.05;
        }
      }
    }
    return score;
  }

  // -------------------------
  // potential: try placing one puyo of each color in each column and simulate
  // returns max chains
  // -------------------------
  function getMaxPotential(board){
    const heights = getHeights(board);
    let maxC = 0;
    for(let x=0;x<WIDTH;x++){
      if(heights[x] >= HEIGHT-1) continue;
      for(const c of COLORS){
        const t = clone(board);
        t[heights[x]][x] = c;
        const r = simulatePureChain(t);
        if(r.chains > maxC) maxC = r.chains;
      }
    }
    return maxC;
  }

  // -------------------------
  // evaluatePlacement: flexible scoring that prioritizes potential & Δpotential
  // -------------------------
  function evaluatePlacement(originalBoard, placedBoard, templates, options){
    // weights - tune these to bias behaviour
    const weights = {
      immediateChainsWeight: 45000, // reward immediate chains
      potentialWeight: 20000,       // reward potential after placement
      deltaPotentialWeight: 30000,  // reward improvement in potential strongly
      templateScale: 0.8,           // multiply template total (templates have large raw weights)
      seedWeight: 14000,            // reward seeds (3-groups)
      mildColumnPenalty: 600,       // much lower than before: only mild discouragement
      extremeHeightPenalty: 1e6     // very large penalty for near-overflow in center columns
    };

    const heightsBefore = getHeights(originalBoard);
    const heightsAfter = getHeights(placedBoard);

    // immediate chains
    const simAfter = simulatePureChain(placedBoard);
    const immediateChains = simAfter.chains;

    // potentials
    const potentialBefore = getMaxPotential(originalBoard);
    const potentialAfter = getMaxPotential(placedBoard);
    const deltaPotential = potentialAfter - potentialBefore;

    // templates & seeds
    const templateResult = detectTemplateScore(placedBoard, templates);
    const templateScore = templateResult.score; // large numbers; we'll scale
    const seeds = countSeeds(placedBoard);

    // column mild penalty only (we removed flattening bias)
    let colPenalty = 0;
    for(const h of heightsAfter){
      // small quadratic penalty to discourage huge single columns, but gentle
      colPenalty += (h*h) * weights.mildColumnPenalty;
    }

    // flex bonus: moderate variance rewarded (we removed pressure to flatten)
    const varh = heightVariance(heightsAfter);
    let flexBonus = 0;
    if(varh >= 1 && varh <= 6) flexBonus = varh * 1800; // encourage some unevenness
    else if(varh > 9) flexBonus = - (varh * 1200); // extreme variance penalized

    // extreme central overflow risk penalty (strong)
    let extremePenalty = 0;
    if(heightsAfter[2] >= 11 || heightsAfter[3] >= 11) {
      extremePenalty = weights.extremeHeightPenalty;
    }

    // Compose
    const score =
      (immediateChains * weights.immediateChainsWeight) +
      (potentialAfter * weights.potentialWeight) +
      (deltaPotential * weights.deltaPotentialWeight) +
      (templateScore * weights.templateScale) +
      (seeds * weights.seedWeight) +
      flexBonus -
      colPenalty -
      extremePenalty;

    return {
      score,
      details: {
        immediateChains, potentialBefore, potentialAfter, deltaPotential,
        templateScore, seeds, colPenalty, flexBonus, varh, heightsAfter, extremePenalty
      }
    };
  }

  // -------------------------
  // main search: evaluate all placements for current pair; optional 1-step lookahead
  // returns assist coords as well
  // -------------------------
  function getBestMove(board, nextPuyos, options = {}) {
    const allow14thRule = options.allow14thRule === undefined ? true : !!options.allow14thRule;
    const lookahead = !!options.lookaheadNext;
    const templates = buildTemplates();

    const axis = nextPuyos[0], child = nextPuyos[1];
    let best = { score: -Infinity, x: 2, rotation: 0, assist: null, info: null };

    // precompute global potential
    const globalPotential = getMaxPotential(board);

    for(let x=0; x<WIDTH; x++){
      for(let r=0; r<4; r++){
        // compute drop coords first (for assist)
        const coords = computeDropCoords(board, x, r, { allow14thRule });
        if(!coords) continue;
        const placed = placePuyo(board, x, r, axis, child, { allow14thRule });
        if(!placed) continue;

        // evaluate placement focused on potential & Δpotential
        const ev = evaluatePlacement(board, placed, templates, options);
        let finalScore = ev.score;

        // lookahead on the next known pair (if provided)
        if(lookahead && nextPuyos.length >= 4){
          const nextAxis = nextPuyos[2], nextChild = nextPuyos[3];
          let bestNext = -Infinity;
          for(let nx=0; nx<WIDTH; nx++){
            for(let nr=0; nr<4; nr++){
              const placed2 = placePuyo(placed, nx, nr, nextAxis, nextChild, { allow14thRule });
              if(!placed2) continue;
              const ev2 = evaluatePlacement(placed, placed2, templates, options);
              if(ev2.score > bestNext) bestNext = ev2.score;
            }
          }
          if(bestNext !== -Infinity) finalScore = finalScore * 0.55 + bestNext * 0.45;
        }

        // small tie-break: prefer moves that improve global potential
        const potAfter = getMaxPotential(placed);
        finalScore += (potAfter - globalPotential) * 7000;

        if(finalScore > best.score){
          best.score = finalScore;
          best.x = x;
          best.rotation = r;
          best.assist = coords;
          best.info = { eval: ev.details, potAfter };
        }
      }
    }

    if(best.assist === null){
      // fallback: center horizontal
      const fallback = computeDropCoords(board, 2, 1, { allow14thRule });
      return { x:2, rotation:1, assist: fallback, info: { fallback: true } };
    }

    return { x: best.x, rotation: best.rotation, assist: best.assist, info: best.info };
  }

  // expose helpers for tuning/debugging
  return {
    getBestMove, computeDropCoords, placePuyo, simulatePureChain,
    _getMaxPotential: getMaxPotential,
    _detectTemplates: (board)=>detectTemplateScore(board, buildTemplates())
  };
})();

if(typeof module !== 'undefined' && module.exports) module.exports = PuyoAI;
