/**
 * PuyoAI_fixedAssist_and_safe.js
 * - assist (ghost) for both axis and child
 * - vertical stacking suppression via strong column penalties
 * - place / drop coordinate calculation separated (computeDropCoords)
 *
 * Public API:
 *   getBestMove(board, nextPuyos, options)
 *     board: 2D array board[y][x], y=0 bottom .. y=HEIGHT-1 top (matches your existing code)
 *     nextPuyos: array like [axisColor, childColor, nextAxis, nextChild, ...]
 *     options: { allow14thRule: boolean (default true), lookaheadNext: boolean (default false) }
 *
 *   Returns:
 *     { x, rotation, assist: { axis: {x,y}, child: {x,y} }, info: { score, reason,... } }
 */

const PuyoAI = (function(){
  const WIDTH = 6;
  const HEIGHT = 14;
  const COLORS = [1,2,3,4];

  // --- Utility ---
  function clone(board){ return board.map(r => [...r]); }
  function getHeights(board){
    const h = Array(WIDTH).fill(0);
    for(let x=0;x<WIDTH;x++){
      let y=0; while(y<HEIGHT && board[y][x]!==0) y++;
      h[x]=y;
    }
    return h;
  }

  // preserve old special rule from v11
  function is14thRowAllowed(board){
    let has12=false, has13=false;
    for(let x=0;x<WIDTH;x++){
      let height=0; while(height<HEIGHT && board[height][x]!==0) height++;
      if(height===12) has12=true;
      if(height===13) has13=true;
    }
    return has12 && has13;
  }

  // --- compute where axis & child will land given (x, rotation) WITHOUT mutating board ---
  // rotation meanings:
  // 0: vertical with axis above child (axis at higher y)
  // 2: vertical with axis below child (axis at lower y)
  // 1: horizontal with axis left, child right
  // 3: horizontal with axis right, child left
  function computeDropCoords(board, targetX, rotation, options = { allow14thRule: true }){
    const heights = getHeights(board);
    let pos1x = targetX;
    let pos2x = targetX;
    if(rotation === 1) pos2x = targetX + 1;
    else if(rotation === 3) pos2x = targetX - 1;
    // bounds
    if(pos1x < 0 || pos1x >= WIDTH || pos2x < 0 || pos2x >= WIDTH) return null;

    let h1 = heights[pos1x];
    let h2 = heights[pos2x];

    // same column vertical placement: need two rows
    if(pos1x === pos2x){
      // both in same column
      // we will place lower at h1 and upper at h1+1
      if(h1 + 1 >= HEIGHT) return null; // no room
      // interpret rotation: axis above child (r=0) means axisY = h1+1, childY=h1
      let axisY = (rotation === 0) ? (h1+1) : (h1);
      let childY = (rotation === 0) ? h1 : (h1+1);
      // check 14th row rule if any of landing y == 13
      if(!options.allow14thRule){
        if(axisY === 13 || childY === 13) return null;
      } else {
        // If rule enabled, verify special allowed condition
        if((axisY === 13 || childY === 13) && !is14thRowAllowed(board)) return null;
      }
      return { axis: {x: pos1x, y: axisY}, child: {x: pos2x, y: childY} };
    } else {
      // horizontal: land at heights of respective columns
      // bounds check
      if(h1 >= HEIGHT || h2 >= HEIGHT) return null;
      // check 14th row constraints per cell
      if(!options.allow14thRule){
        if(h1 === 13 || h2 === 13) return null;
      } else {
        if((h1 === 13 || h2 === 13) && !is14thRowAllowed(board)) return null;
      }
      return { axis: {x: pos1x, y: h1}, child: {x: pos2x, y: h2} };
    }
  }

  // place using computeDropCoords; returns new board or null
  function placePuyo(board, x, rotation, axisColor, childColor, options = { allow14thRule: true }){
    const coords = computeDropCoords(board, x, rotation, options);
    if(!coords) return null;
    const nb = clone(board);
    // place axis
    nb[coords.axis.y][coords.axis.x] = axisColor;
    nb[coords.child.y][coords.child.x] = childColor;
    // If Y==13 auto-delete behavior in original: clear row 13 after placement (preserve semantics)
    for(let i=0;i<WIDTH;i++) nb[13][i] = 0;
    return nb;
  }

  // apply gravity across full height (we want realistic falling for safety)
  function applyGravity(board){
    for(let x=0;x<WIDTH;x++){
      let write = 0;
      for(let read=0; read<HEIGHT; read++){
        if(board[read][x] !== 0){
          board[write][x] = board[read][x];
          if(write !== read) board[read][x] = 0;
          write++;
        }
      }
      for(; write<HEIGHT; write++) board[write][x] = 0;
    }
  }

  // simulate chains (respecting v11 behavior: chain detection only uses y<12)
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
      for(let y=0;y<HEIGHT;y++) for(let x=0;x<WIDTH;x++) if(toErase[y][x]) b[y][x]=0;
      applyGravity(b);
    }
    return { chains: totalChains, finalBoard: b };
  }

  // --- evaluation: chains + shape + heavy column penalty to avoid vertical stacking ---
  function evaluateBoard(board, options = { allow14thRule: true }){
    // 1) immediate overflow prohibition
    const heights = getHeights(board);
    if(Math.max(...heights) >= 12) return { score: -9e8, reason: 'overflow' };

    // 2) immediate chain count
    const sim = simulatePureChain(board);
    const immediateChains = sim.chains;

    // 3) potential (test placing one puyo of each color in each column)
    let maxPotential = 0;
    for(let x=0;x<WIDTH;x++){
      for(let color of COLORS){
        const t = clone(board);
        const heights2 = getHeights(t);
        let y = heights2[x];
        // if placing would be invalid (14th row rule), skip
        if(y === 13){
          if(options.allow14thRule){
            if(!is14thRowAllowed(t)) continue;
          } else continue;
        }
        if(y >= HEIGHT) continue;
        t[y][x] = color;
        const r = simulatePureChain(t);
        if(r.chains > maxPotential) maxPotential = r.chains;
      }
    }

    // 4) shape / column penalties
    let shapeScore = 0;
    // penalize tall columns strongly (quadratic/cubic)
    for(const h of heights) {
      if(h > 7) shapeScore -= Math.pow(h-7,3) * 1200; // strong penalty for h>=8, grows fast
      else shapeScore -= h*h * 8; // mild penalty for general height
    }
    // penalize big adjacent differences
    for(let i=0;i<WIDTH-1;i++){
      const d = Math.abs(heights[i] - heights[i+1]);
      if(d >= 3) shapeScore -= d * 3000;
      else shapeScore -= d * 60;
    }
    // reward horizontal spread (prefers axis != child)
    // count horizontal neighbor same-color pairs in y<12
    let horizBonus = 0;
    for(let y=0;y<12;y++){
      for(let x=0;x<WIDTH-1;x++){
        if(board[y][x] !== 0 && board[y][x] === board[y][x+1]) horizBonus += 120;
      }
    }

    // 5) risk from placing into top rows
    let topRisk = 0;
    if(heights[2] >= 10 || heights[3] >= 10) topRisk += 50000; // central columns high risk
    // 6) combine scores
    const score = immediateChains * 50000 + maxPotential * 12000 + shapeScore + horizBonus - topRisk;

    return { score, details: { immediateChains, maxPotential, shapeScore, horizBonus, heights } };
  }

  // getBestMove: evaluate all placements for current pair, optionally do 1-step lookahead on next pair
  function getBestMove(board, nextPuyos, options = {}){
    const allow14thRule = (options.allow14thRule === undefined) ? true : !!options.allow14thRule;
    const lookaheadNext = !!options.lookaheadNext; // if true, consider next pair in nextPuyos[2..3]
    const axisColor = nextPuyos[0];
    const childColor = nextPuyos[1];

    let best = { score: -Infinity, x: 2, rotation: 0, assist: null, info: null };

    for(let x=0;x<WIDTH;x++){
      for(let r=0;r<4;r++){
        // compute assist coords
        const coords = computeDropCoords(board, x, r, { allow14thRule });
        if(!coords) continue;
        // If unreachable path rules are used in your environment, you can add a reachability check here.
        // place and evaluate
        const nb = placePuyo(board, x, r, axisColor, childColor, { allow14thRule });
        if(!nb) continue;
        // evaluate immediate board
        const evalRes = evaluateBoard(nb, { allow14thRule });
        let totalScore = evalRes.score;

        // optional 1-step lookahead: assume next pair will be random — we consider best possible next placement
        if(lookaheadNext && nextPuyos.length >= 4){
          const nextAxis = nextPuyos[2], nextChild = nextPuyos[3];
          let bestNext = -Infinity;
          for(let nx=0; nx<WIDTH; nx++){
            for(let nr=0; nr<4; nr++){
              const nb2 = placePuyo(nb, nx, nr, nextAxis, nextChild, { allow14thRule });
              if(!nb2) continue;
              const e2 = evaluateBoard(nb2, { allow14thRule });
              if(e2.score > bestNext) bestNext = e2.score;
            }
          }
          if(bestNext !== -Infinity) totalScore = totalScore * 0.6 + bestNext * 0.4; // blend
        }

        // If this move results in central column overflow, heavy penalty
        const heightsAfter = getHeights(nb);
        if(heightsAfter[2] >= 12 || heightsAfter[3] >= 12) totalScore -= 1e7;

        if(totalScore > best.score){
          best.score = totalScore;
          best.x = x;
          best.rotation = r;
          best.assist = coords; // both axis and child positions
          best.info = { evalRes, heightsAfter };
        }
      }
    }

    // if none found, fallback center
    if(best.assist === null){
      // try center safe rotation horizontal if possible
      const fallbackCoords = computeDropCoords(board, 2, 1, { allow14thRule });
      return { x: 2, rotation: 1, assist: fallbackCoords, info: { fallback: true } };
    }

    // return compact result
    return {
      x: best.x,
      rotation: best.rotation,
      assist: best.assist,
      info: best.info
    };
  }

  // export
  return { getBestMove, computeDropCoords, placePuyo, simulatePureChain, is14thRowAllowed };
})();

// Node.js export if needed
if (typeof module !== 'undefined' && module.exports) module.exports = PuyoAI;
