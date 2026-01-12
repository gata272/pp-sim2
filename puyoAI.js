/**
 * PuyoAI_vChainFocus.js
 * - 目的: 「大連鎖ポテンシャルを最優先」する評価に改良
 * - assist (axis/child) を返す（描画側は両方を使う）
 *
 * Public API:
 *   getBestMove(board, nextPuyos, options)
 *     nextPuyos: [axis, child, nextAxis, nextChild, ...]
 *   Returns { x, rotation, assist: {axis:{x,y}, child:{x,y}}, info }
 */

const PuyoAI = (function(){
  const WIDTH = 6;
  const HEIGHT = 14;
  const COLORS = [1,2,3,4];

  // ---------- utils ----------
  function clone(board){ return board.map(r=>[...r]); }
  function getHeights(board){
    const h = Array(WIDTH).fill(0);
    for(let x=0;x<WIDTH;x++){
      let y=0; while(y<HEIGHT && board[y][x]!==0) y++;
      h[x]=y;
    }
    return h;
  }

  // ---------- special 14th-row rule from v11 ----------
  function is14thRowAllowed(board){
    let has12=false, has13=false;
    for(let x=0;x<WIDTH;x++){
      let height=0; while(height<HEIGHT && board[height][x]!==0) height++;
      if(height===12) has12=true;
      if(height===13) has13=true;
    }
    return has12 && has13;
  }

  // ---------- drop coordinate computation (returns null if invalid) ----------
  function computeDropCoords(board, targetX, rotation, options = { allow14thRule: true }){
    const heights = getHeights(board);
    let pos1x = targetX, pos2x = targetX;
    if(rotation === 1) pos2x = targetX + 1;
    else if(rotation === 3) pos2x = targetX - 1;
    if(pos1x < 0 || pos1x >= WIDTH || pos2x < 0 || pos2x >= WIDTH) return null;

    let h1 = heights[pos1x], h2 = heights[pos2x];

    // same column vertical
    if(pos1x === pos2x){
      if(h1 + 1 >= HEIGHT) return null;
      let axisY = (rotation === 0) ? (h1+1) : h1;
      let childY = (rotation === 0) ? h1 : (h1+1);
      if(!options.allow14thRule){
        if(axisY===13 || childY===13) return null;
      } else {
        if((axisY===13 || childY===13) && !is14thRowAllowed(board)) return null;
      }
      return { axis:{x:pos1x,y:axisY}, child:{x:pos2x,y:childY} };
    } else {
      if(h1 >= HEIGHT || h2 >= HEIGHT) return null;
      if(!options.allow14thRule){
        if(h1===13 || h2===13) return null;
      } else {
        if((h1===13 || h2===13) && !is14thRowAllowed(board)) return null;
      }
      return { axis:{x:pos1x,y:h1}, child:{x:pos2x,y:h2} };
    }
  }

  // ---------- place (uses computeDropCoords) ----------
  function placePuyo(board, x, rotation, axisColor, childColor, options = { allow14thRule: true }){
    const coords = computeDropCoords(board, x, rotation, options);
    if(!coords) return null;
    const nb = clone(board);
    nb[coords.axis.y][coords.axis.x] = axisColor;
    nb[coords.child.y][coords.child.x] = childColor;
    // keep v11 semantics: clear row 13 after placement (auto delete)
    for(let i=0;i<WIDTH;i++) nb[13][i] = 0;
    return nb;
  }

  // ---------- gravity and chain sim ----------
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
      for(;write<HEIGHT;write++) board[write][x] = 0;
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
            let color = b[y][x];
            let stack = [{x,y}], group=[];
            visited[y][x] = true;
            while(stack.length){
              const p = stack.pop();
              group.push(p);
              [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx,dy])=>{
                const nx = p.x+dx, ny = p.y+dy;
                if(nx>=0 && nx<WIDTH && ny>=0 && ny<12 && !visited[ny][nx] && b[ny][nx]===color){
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

  // ---------- template detection (small templates) ----------
  function buildTemplates(){
    const templates = [];
    // small stairs
    templates.push({name:'stairs3_r', w:3,h:3, mask:[
      [0,0,1],
      [0,1,0],
      [1,0,0]
    ], weight:6000});
    templates.push({name:'stairs3_l', w:3,h:3, mask:[
      [1,0,0],
      [0,1,0],
      [0,0,1]
    ], weight:6000});
    // sandwich
    templates.push({name:'sandwich', w:3,h:3, mask:[
      [0,0,0],
      [1,0,1],
      [1,0,1]
    ], weight:9000});
    // small GTR hook
    templates.push({name:'gtr_hook', w:4,h:3, mask:[
      [0,0,0,0],
      [1,1,1,1],
      [1,0,1,0]
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
    for(let t of templates){
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

  // ---------- connection seed counting ----------
  function countSeeds(board){
    let score = 0;
    let vis = Array.from({length:HEIGHT}, ()=>Array(WIDTH).fill(false));
    for(let y=0;y<HEIGHT;y++){
      for(let x=0;x<WIDTH;x++){
        if(board[y][x] !== 0 && !vis[y][x]){
          const col = board[y][x];
          let stack = [{x,y}], size=0;
          vis[y][x] = true;
          while(stack.length){
            const p = stack.pop(); size++;
            [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx,dy])=>{
              const nx=p.x+dx, ny=p.y+dy;
              if(nx>=0 && nx<WIDTH && ny>=0 && ny<HEIGHT && !vis[ny][nx] && board[ny][nx]===col){
                vis[ny][nx] = true; stack.push({x:nx,y:ny});
              }
            });
          }
          if(size === 3) score += 1;
          else if(size === 2) score += 0.2;
          else if(size === 1) score += 0.05;
        }
      }
    }
    return score;
  }

  // ---------- baseline metrics ----------
  function getMaxPotential(board){
    // For each column, try each color one puyo and simulate, return max chains found
    const heights = getHeights(board);
    let maxC = 0;
    for(let x=0;x<WIDTH;x++){
      if(heights[x] >= HEIGHT-1) continue;
      for(let c of COLORS){
        let t = clone(board);
        t[heights[x]][x] = c;
        const r = simulatePureChain(t);
        if(r.chains > maxC) maxC = r.chains;
      }
    }
    return maxC;
  }

  // ---------- evaluation for a candidate placement ----------
  function evaluatePlacement(originalBoard, placedBoard, templates, options){
    // weights: tuned to favor potential & templates (big-chain focus)
    const weights = {
      immediateChainsWeight: 70000,   // reward actual immediate chain, but lower than potential importance
      potentialWeight: 16000,         // major weight: future chain potential
      templateWeight: 9000,           // reward forming templates
      seedWeight: 12000,              // reward forming 3-seeds
      bottomPlacementPenalty: 5000,   // penalty for placing both pieces at very low heights (discourage always floor)
      columnPenaltyBase: 900,         // existing column height penalty multiplier
      centralTopRisk: 60000           // heavy risk if central columns get too high
    };

    const heightsBefore = getHeights(originalBoard);
    const heightsAfter = getHeights(placedBoard);

    // immediate chain reward
    const simAfter = simulatePureChain(placedBoard);
    const immediateChains = simAfter.chains;

    // max potential after placement
    const potentialAfter = getMaxPotential(placedBoard);
    const potentialBefore = getMaxPotential(originalBoard);
    const deltaPotential = potentialAfter - potentialBefore;

    // template score on placed board
    const templateResult = detectTemplateScore(placedBoard, templates);
    const templateScore = templateResult.score;

    // seeds (3-groups)
    const seeds = countSeeds(placedBoard);

    // column penalty to avoid tall columns (but allow controlled stacking)
    let colPenalty = 0;
    for(const h of heightsAfter){
      if(h > 8){
        colPenalty += Math.pow(h - 8, 3) * weights.columnPenaltyBase;
      } else {
        colPenalty += h*h * 12;
      }
    }

    // bottom placement penalty: discourage placing both pieces at ground or nearly ground often
    // We compute average delta height: if both axis and child landed at <=1 (very bottom) penalize moderately
    // find coordinates of newly placed puyos by comparing heightsBefore vs heightsAfter
    let bottomPenalty = 0;
    let bottoms = 0;
    for(let x=0;x<WIDTH;x++){
      if(heightsAfter[x] - heightsBefore[x] >= 1 && heightsAfter[x] <= 1) bottoms++;
    }
    if(bottoms >= 1) bottomPenalty = weights.bottomPlacementPenalty * bottoms;

    // central high risk
    let centralRisk = 0;
    if(heightsAfter[2] >= 10 || heightsAfter[3] >= 10) centralRisk = weights.centralTopRisk;

    // Compose final score:
    // - Reward: deltaPotential (big), potentialAfter (absolute), templateScore, seeds
    // - Reward immediate chains but not too dominating
    const score =
      (immediateChains * weights.immediateChainsWeight) +
      ((potentialAfter) * weights.potentialWeight) +
      ((deltaPotential) * (weights.potentialWeight * 1.6)) + // reward improvement of potential strongly
      (templateScore * weights.templateWeight / 1000) + // template weights are large numbers, scale down here
      (seeds * weights.seedWeight) -
      colPenalty - bottomPenalty - centralRisk;

    return {
      score,
      details: {
        immediateChains, potentialAfter, potentialBefore, deltaPotential,
        templateScore, seeds, colPenalty, bottomPenalty, centralRisk, heightsAfter
      }
    };
  }

  // ---------- main search ----------
  // We evaluate all placements for the current pair. Optionally perform 1-step lookahead.
  function getBestMove(board, nextPuyos, options = {}) {
    const allow14thRule = options.allow14thRule === undefined ? true : !!options.allow14thRule;
    const lookahead = !!options.lookaheadNext;
    const templates = buildTemplates();

    const axisColor = nextPuyos[0], childColor = nextPuyos[1];
    let best = { score: -Infinity, x: 2, rotation: 0, assist: null, info: null };

    const potentialBeforeGlobal = getMaxPotential(board);

    for(let x=0; x<WIDTH; x++){
      for(let r=0; r<4; r++){
        const coords = computeDropCoords(board, x, r, { allow14thRule });
        if(!coords) continue;
        const placed = placePuyo(board, x, r, axisColor, childColor, { allow14thRule });
        if(!placed) continue;

        // evaluate placement (favor chain potential)
        const evalRes = evaluatePlacement(board, placed, templates, options);

        let finalScore = evalRes.score;

        // optional one-step lookahead: consider best next placement for next pair (if provided)
        if(lookahead && nextPuyos.length >= 4){
          const nextAxis = nextPuyos[2], nextChild = nextPuyos[3];
          let bestNextScore = -Infinity;
          for(let nx=0; nx<WIDTH; nx++){
            for(let nr=0; nr<4; nr++){
              const nb2 = placePuyo(placed, nx, nr, nextAxis, nextChild, { allow14thRule });
              if(!nb2) continue;
              const e2 = evaluatePlacement(placed, nb2, templates, options);
              if(e2.score > bestNextScore) bestNextScore = e2.score;
            }
          }
          if(bestNextScore !== -Infinity){
            // blend: we bias towards placements whose best-next is strong
            finalScore = finalScore * 0.55 + bestNextScore * 0.45;
          }
        }

        // small tie-breaker: prefer placements that increase potential relative to global before
        const potAfter = getMaxPotential(placed);
        const potDeltaGlobal = potAfter - potentialBeforeGlobal;
        finalScore += potDeltaGlobal * 8000;

        if(finalScore > best.score){
          best.score = finalScore;
          best.x = x;
          best.rotation = r;
          best.assist = coords;
          best.info = {
            eval: evalRes.details,
            potAfter,
            templateCounts: detectTemplateScore(placed, templates).counts
          };
        }
      }
    }

    // if nothing valid, fallback
    if(best.assist === null){
      const fb = computeDropCoords(board, 2, 1, { allow14thRule });
      return { x:2, rotation:1, assist: fb, info: { fallback: true } };
    }

    return {
      x: best.x,
      rotation: best.rotation,
      assist: best.assist,
      info: best.info
    };
  }

  // expose small helpers for debugging
  return {
    getBestMove, computeDropCoords, placePuyo, simulatePureChain,
    // tuning helpers
    _getMaxPotential: getMaxPotential,
    _detectTemplates: (board)=>detectTemplateScore(board, buildTemplates())
  };
})();

if(typeof module !== 'undefined' && module.exports) module.exports = PuyoAI;
