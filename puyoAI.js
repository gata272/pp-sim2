/**
 * PuyoAI_longtermMC.js
 * - 目的: すぐ消える短期手を避け、長期的に大連鎖を組める配置を優先
 * - アシスト座標 (assist.axis / assist.child) を返す
 * - heavy: 深ビーム + Monte Carlo ロールアウトで期待される連鎖性能を評価
 *
 * Public API:
 *   getBestMove(board, nextPuyos, options)
 *     board: 2D array board[y][x], y=0 bottom ... y=HEIGHT-1 top (same as earlier)
 *     nextPuyos: [axis, child, nextAxis, nextChild, ...] (may be shorter)
 *     options (optional): {
 *        allow14thRule: true/false,
 *        beamDepth: int (default 4),
 *        beamWidth: int (default 300),
 *        rollouts: int (default 300),
 *        horizonPairs: int (default 6),
 *        lookaheadNext: boolean (use deterministic 1-step lookahead when available)
 *     }
 *
 * Returns:
 *   { x, rotation, assist: { axis:{x,y}, child:{x,y} }, info }
 */

const PuyoAI = (function(){
  const WIDTH = 6;
  const HEIGHT = 14;
  const COLORS = [1,2,3,4];

  // -----------------------------
  // Utilities
  // -----------------------------
  function clone(board){ return board.map(r => [...r]); }
  function emptyBoard(){ return Array.from({length:HEIGHT}, ()=>Array(WIDTH).fill(0)); }
  function getHeights(board){
    const h = Array(WIDTH).fill(0);
    for(let x=0;x<WIDTH;x++){
      let y=0; while(y<HEIGHT && board[y][x] !== 0) y++;
      h[x]=y;
    }
    return h;
  }
  function countHoles(board){
    let holes = 0;
    for(let x=0;x<WIDTH;x++){
      let seen=false;
      for(let y=0;y<HEIGHT;y++){
        if(board[y][x] !== 0) seen = true;
        else if(seen) holes++;
      }
    }
    return holes;
  }

  // -----------------------------
  // v11 special rule: 14th row allowed only if exists col height 12 and 13
  // -----------------------------
  function is14thRowAllowed(board){
    let has12=false, has13=false;
    for(let x=0;x<WIDTH;x++){
      let h=0; while(h<HEIGHT && board[h][x] !== 0) h++;
      if(h===12) has12=true;
      if(h===13) has13=true;
    }
    return has12 && has13;
  }

  // -----------------------------
  // Compute drop coords (no mutation) - returns null if invalid
  // rotation semantics:
  //  0: vertical with axis above child (axis higher y)
  //  2: vertical flipped (axis below child)
  //  1: horizontal axis left
  //  3: horizontal axis right
  // -----------------------------
  function computeDropCoords(board, targetX, rotation, options = { allow14thRule: true }){
    const heights = getHeights(board);
    let pos1x = targetX;
    let pos2x = targetX;
    if(rotation === 1) pos2x = targetX + 1;
    else if(rotation === 3) pos2x = targetX - 1;
    if(pos1x < 0 || pos1x >= WIDTH || pos2x < 0 || pos2x >= WIDTH) return null;

    let h1 = heights[pos1x];
    let h2 = heights[pos2x];

    if(pos1x === pos2x){
      if(h1 + 1 >= HEIGHT) return null;
      let axisY = (rotation === 0) ? (h1+1) : h1;
      let childY = (rotation === 0) ? h1 : (h1+1);
      if(!options.allow14thRule){
        if(axisY === 13 || childY === 13) return null;
      } else {
        if((axisY===13||childY===13) && !is14thRowAllowed(board)) return null;
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

  // -----------------------------
  // placePuyo uses computeDropCoords; returns new board or null
  // After placement we follow v11 semantics: clear row 13 (auto-delete)
  // -----------------------------
  function placePuyo(board, x, rotation, axisColor, childColor, options = { allow14thRule: true }){
    const coords = computeDropCoords(board, x, rotation, options);
    if(!coords) return null;
    const nb = clone(board);
    nb[coords.axis.y][coords.axis.x] = axisColor;
    nb[coords.child.y][coords.child.x] = childColor;
    for(let i=0;i<WIDTH;i++) nb[13][i] = 0;
    return nb;
  }

  // -----------------------------
  // gravity and chain simulation
  // chain detection only uses y<12 (same as earlier)
  // -----------------------------
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
            let stack = [{x,y}], group = [];
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

  // -----------------------------
  // small template list for encouraging good forms
  // -----------------------------
  function buildTemplates(){
    const templates = [];
    templates.push({name:'stairs3_r', w:3,h:3, mask:[
      [0,0,1],[0,1,0],[1,0,0]
    ], weight:7000});
    templates.push({name:'stairs3_l', w:3,h:3, mask:[
      [1,0,0],[0,1,0],[0,0,1]
    ], weight:7000});
    templates.push({name:'sandwich', w:3,h:3, mask:[
      [0,0,0],[1,0,1],[1,0,1]
    ], weight:10000});
    templates.push({name:'gtr_hook', w:4,h:3, mask:[
      [0,0,0,0],[1,1,1,1],[1,0,1,0]
    ], weight:14000});
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

  // -----------------------------
  // seeds (3-groups) fractional count
  // -----------------------------
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

  // -----------------------------
  // potential: place 1 puyo of each color in each column and simulate -> max chains
  // -----------------------------
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

  // -----------------------------
  // Greedy policy used in rollouts:
  // for a given board and a random next pair, choose placement that maximizes
  // (potentialAfter * w1 + templateScore * w2 + seeds * w3) with a heavy immediate-erase avoidance.
  // This is used to simulate "plausible" future play during rollouts.
  // -----------------------------
  function greedyPlacementPolicy(board, pair, options){
    const axis = pair[0], child = pair[1];
    const templates = buildTemplates();
    let best = { score: -Infinity, x: 2, r: 0 };
    for(let x=0;x<WIDTH;x++){
      for(let r=0;r<4;r++){
        const placed = placePuyo(board, x, r, axis, child, options);
        if(!placed) continue;
        const sim = simulatePureChain(placed);
        // If immediate small erase (chains>0 && <4), penalize strongly (we want to avoid immediate small clears)
        if(sim.chains > 0 && sim.chains < 4) {
          // discourage
          continue;
        }
        const pot = getMaxPotential(placed);
        const templ = detectTemplateScore(placed, templates).score;
        const seeds = countSeeds(placed);
        const sc = pot * 2000 + templ * 0.1 + seeds * 800;
        if(sc > best.score){ best.score = sc; best.x = x; best.r = r; }
      }
    }
    if(best.score === -Infinity) return null;
    return { x: best.x, rotation: best.r };
  }

  // -----------------------------
  // Monte Carlo rollouts for evaluating a candidate placed board
  // For each rollout: generate 'horizonPairs' random pairs (unless nextPuyos array provides known ones),
  // place them with greedyPlacementPolicy (which avoids immediate small erase), and return the
  // maximal chain observed during the rollout (simulatePureChain results).
  // Returns aggregated statistics: meanChains, maxChains, pct90Chains
  // -----------------------------
  function rolloutMaxChainStatistics(startBoard, knownNext = [], rollouts = 200, horizonPairs = 6, options = {}){
    const results = [];
    const allow14thRule = options.allow14thRule === undefined ? true : !!options.allow14thRule;
    for(let t=0;t<rollouts;t++){
      // copy
      let b = clone(startBoard);
      // prepare sequence: include knownNext first then random
      const seq = [];
      for(let i=0;i<knownNext.length && seq.length < horizonPairs; i+=2){
        seq.push([ knownNext[i], knownNext[i+1] ]);
      }
      while(seq.length < horizonPairs){
        seq.push([ COLORS[Math.floor(Math.random()*COLORS.length)], COLORS[Math.floor(Math.random()*COLORS.length)] ]);
      }

      let maxChainsHere = 0;
      for(let step=0; step<seq.length; step++){
        const pair = seq[step];
        // choose placement by greedy policy
        const action = greedyPlacementPolicy(b, pair, { allow14thRule });
        if(!action){
          // no legal placement -> overflow -> consider as failure; set high penalty (0 chains)
          maxChainsHere = Math.max(maxChainsHere, 0);
          break;
        }
        const nb = placePuyo(b, action.x, action.rotation, pair[0], pair[1], { allow14thRule });
        if(!nb){ break; }
        // simulate immediate chain and update board for next steps
        const sim = simulatePureChain(nb);
        // sim mutates not original; we used simulatePureChain that clones inside, so must replace b with sim.finalBoard
        b = sim.finalBoard;
        if(sim.chains > maxChainsHere) maxChainsHere = sim.chains;
        // also check overflow
        const heights = getHeights(b);
        if(Math.max(...heights) >= 12) break;
      }
      results.push(maxChainsHere);
    }
    // compute stats
    results.sort((a,b)=>a-b);
    const n = results.length;
    const mean = results.reduce((s,v)=>s+v,0)/n;
    const max = results[n-1];
    const p90 = results[Math.max(0, Math.floor(n*0.9)-1)];
    return { meanChains: mean, maxChains: max, p90Chains: p90, all: results };
  }

  // -----------------------------
  // Candidate evaluation:
  // For a candidate placement (boardAfter), run rollouts to estimate long-term chainability.
  // Score formula (tunable):
  //   score = rollout.meanChains * A + rollout.p90Chains * B + rollout.maxChains * C
  //         + templateScore * D + seeds * E - immediateSmallErasePenalty
  // Immediate small erase (chains >0 && <4) is heavily penalized (we want to avoid it).
  // -----------------------------
  function evaluateCandidateLongterm(originalBoard, boardAfter, knownNext, options){
    const rollouts = options.rollouts || 300;
    const horizonPairs = options.horizonPairs || 6;
    const allow14thRule = options.allow14thRule === undefined ? true : !!options.allow14thRule;

    // immediate chain check on the placed board
    const sim = simulatePureChain(boardAfter);
    const immediateChains = sim.chains;

    const templates = buildTemplates();
    const templateScore = detectTemplateScore(boardAfter, templates).score;
    const seeds = countSeeds(boardAfter);
    const potentialAfter = getMaxPotential(boardAfter);

    // If immediate small erase (1~3 chains) => heavy penalty (but if it's already very large like >=6 allow)
    const immediateSmallPenalty = (immediateChains > 0 && immediateChains < 4) ? 1e8 : 0;
    // If immediate large chain present (>=4) reward but it's also captured by later evaluation
    const immediateLargeBonus = (immediateChains >= 4) ? immediateChains * 6e6 : 0;

    // Monte Carlo rollouts for long-term estimate (expensive)
    const stats = rolloutMaxChainStatistics(boardAfter, knownNext || [], rollouts, horizonPairs, { allow14thRule });

    // Compose score (weights chosen to strongly favor higher mean/p90)
    const score =
        stats.meanChains * 4e7
      + stats.p90Chains * 2e7
      + stats.maxChains * 1e7
      + templateScore * 0.05
      + seeds * 2e6
      + potentialAfter * 1.5e7
      + immediateLargeBonus
      - immediateSmallPenalty;

    const info = {
      immediateChains, templateScore, seeds, potentialAfter,
      rolloutsStats: stats
    };
    return { score, info };
  }

  // -----------------------------
  // Beam search: explore depth 'beamDepth' using heuristic pruning (quickScore)
  // Then for top beam candidates run evaluateCandidateLongterm (heavy MC)
  // -----------------------------
  function quickPruneScore(board){
    // light heuristic to prefer higher potential / templates and avoid immediate small clears
    const pot = getMaxPotential(board);
    const templates = buildTemplates();
    const templ = detectTemplateScore(board, templates).score;
    const seeds = countSeeds(board);
    // immediate small erase detection
    const sim = simulatePureChain(board);
    const immediate = sim.chains;
    let penalty = 0;
    if(immediate > 0 && immediate < 4) penalty = 1e5;
    return pot * 1000 + templ * 0.01 + seeds * 200 - penalty;
  }

  function getBestMove(board, nextPuyos, options = {}){
    const allow14thRule = options.allow14thRule === undefined ? true : !!options.allow14thRule;
    const beamDepth = options.beamDepth || 4;
    const beamWidth = options.beamWidth || 300;
    const rollouts = options.rollouts || 300;
    const horizonPairs = options.horizonPairs || 6;
    const lookaheadNext = !!options.lookaheadNext;

    // initial beam node
    let beam = [{ board: clone(board), seq: [], score: 0 }];

    // expand beam up to beamDepth using greedy quickPruneScore
    for(let step=0; step<beamDepth; step++){
      const pairAxis = nextPuyos[step*2] !== undefined ? nextPuyos[step*2] : null;
      const pairChild = nextPuyos[step*2+1] !== undefined ? nextPuyos[step*2+1] : null;
      const candidates = [];
      for(const node of beam){
        // if we don't have known next color for this step, we'll generate all possibilities as branches (heavy)
        // but to limit explosion, if unknown we try a small sample of color pairs instead of all 16 combos
        const pairsToTry = [];
        if(pairAxis !== null && pairChild !== null){
          pairsToTry.push([pairAxis, pairChild]);
        } else {
          // sample 8 common pairs uniformly
          for(let s=0;s<8;s++){
            pairsToTry.push([COLORS[Math.floor(Math.random()*COLORS.length)], COLORS[Math.floor(Math.random()*COLORS.length)]]);
          }
        }

        for(const pair of pairsToTry){
          const axis = pair[0], child = pair[1];
          for(let x=0;x<WIDTH;x++){
            for(let r=0;r<4;r++){
              const nb = placePuyo(node.board, x, r, axis, child, { allow14thRule });
              if(!nb) continue;
              const sc = quickPruneScore(nb);
              candidates.push({ board: nb, seq: node.seq.concat([{x,r,axis,child}]), score: sc });
            }
          }
        }
      }
      if(candidates.length === 0) break;
      candidates.sort((a,b)=>b.score - a.score);
      beam = candidates.slice(0, Math.max(1, Math.min(beamWidth, candidates.length)));
    }

    // Now we have candidate end-states in beam; evaluate each with heavy Monte Carlo rollouts
    let best = null;
    const topCandidates = beam; // already pruned
    for(const node of topCandidates){
      // evaluate node.board by running long-term MC rollouts, passing knownNext as remaining known nexts (if available)
      // build knownNext sequence from nextPuyos starting at 2*node.seq.length
      const knownNext = [];
      let startIdx = node.seq.length * 2;
      for(let k = startIdx; k < nextPuyos.length && knownNext.length < horizonPairs*2; k++){
        knownNext.push(nextPuyos[k]);
      }
      const evalRes = evaluateCandidateLongterm(board, node.board, knownNext, { rollouts, horizonPairs, allow14thRule });
      // we also attach node.seq info so we can return first move easily
      const entry = { node, score: evalRes.score, info: evalRes.info };
      if(!best || entry.score > best.score) best = entry;
    }

    if(!best){
      // fallback: simple center horizontal
      const coords = computeDropCoords(board, 2, 1, { allow14thRule });
      return { x: 2, rotation: 1, assist: coords, info: { fallback: true } };
    }

    // first move is node.seq[0]
    const first = best.node.seq[0] || { x: 2, r: 0 };
    // compute assist coords for display from original board and first move
    const assist = computeDropCoords(board, first.x, first.r, { allow14thRule });
    // pack info: include stats from best.info.rolloutsStats
    return {
      x: first.x,
      rotation: first.r,
      assist,
      info: {
        seq: best.node.seq,
        longtermInfo: best.info,
        score: best.score,
        rollouts: options.rollouts || rollouts,
        beamDepth, beamWidth
      }
    };
  }

  // expose helpers for debugging/tuning
  return {
    getBestMove,
    computeDropCoords,
    placePuyo,
    simulatePureChain,
    _getMaxPotential: getMaxPotential,
    _rollout: rolloutMaxChainStatistics
  };
})();

// Node export
if(typeof module !== 'undefined' && module.exports) module.exports = PuyoAI;
