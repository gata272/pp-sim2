/**
 * PuyoAI v15 - Pro Shape Oriented Edition
 * 縦1列積み完全抑制 + 横展開重視
 */
const PuyoAI = (() => {
  const WIDTH = 6;
  const HEIGHT = 14;
  const COLORS = [1,2,3,4];

  /* =========================
     基本ユーティリティ
  ========================= */

  function clone(board){
    return board.map(r => [...r]);
  }

  function getHeights(board){
    return Array.from({length:WIDTH},(_,x)=>{
      let h=0;
      while(h<HEIGHT && board[h][x]!==0) h++;
      return h;
    });
  }

  /* =========================
     形状評価（核心）
  ========================= */

  function evaluateShape(board){
    const h = getHeights(board);
    let score = 0;

    // 高さペナルティ（縦積み抑制）
    h.forEach(v => score -= v*v*4);

    // 高低差ペナルティ
    for(let i=0;i<WIDTH-1;i++){
      const d = Math.abs(h[i]-h[i+1]);
      if(d>=3) score -= 200;
      else score -= d*20;
    }

    // 中央低ボーナス
    score -= (h[2]+h[3])*15;

    // 横連結ボーナス
    for(let y=0;y<12;y++){
      for(let x=0;x<WIDTH-1;x++){
        if(board[y][x]!==0 && board[y][x]===board[y][x+1]){
          score += 25;
        }
      }
    }

    return score;
  }

  /* =========================
     即消し判定
  ========================= */

  function hasImmediateErase(board){
    for(let y=0;y<12;y++){
      for(let x=0;x<WIDTH;x++){
        if(board[y][x]===0) continue;
        const c=board[y][x];
        let cnt=1;
        [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy])=>{
          const nx=x+dx, ny=y+dy;
          if(nx>=0&&nx<WIDTH&&ny>=0&&ny<12&&board[ny][nx]===c) cnt++;
        });
        if(cnt>=4) return true;
      }
    }
    return false;
  }

  /* =========================
     重力 & 連鎖
  ========================= */

  function applyGravity(board){
    for(let x=0;x<WIDTH;x++){
      let w=0;
      for(let r=0;r<12;r++){
        if(board[r][x]!==0){
          board[w][x]=board[r][x];
          if(w!==r) board[r][x]=0;
          w++;
        }
      }
    }
  }

  function step(board){
    let vis=Array.from({length:12},()=>Array(WIDTH).fill(false));
    let exploded=false;

    for(let y=0;y<12;y++)for(let x=0;x<WIDTH;x++){
      if(board[y][x]!==0 && !vis[y][x]){
        let stack=[[x,y]], grp=[], col=board[y][x];
        vis[y][x]=true;
        while(stack.length){
          const [cx,cy]=stack.pop();
          grp.push([cx,cy]);
          [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy])=>{
            const nx=cx+dx, ny=cy+dy;
            if(nx>=0&&nx<WIDTH&&ny>=0&&ny<12&&!vis[ny][nx]&&board[ny][nx]===col){
              vis[ny][nx]=true;
              stack.push([nx,ny]);
            }
          });
        }
        if(grp.length>=4){
          grp.forEach(([gx,gy])=>board[gy][gx]=0);
          exploded=true;
        }
      }
    }
    if(exploded) applyGravity(board);
    return exploded;
  }

  function simulate(board){
    let b=clone(board), c=0;
    while(step(b)) c++;
    return c;
  }

  /* =========================
     メイン評価
  ========================= */

  function evaluate(board){
    let chain = simulate(board);
    let shape = evaluateShape(board);
    let instant = hasImmediateErase(board) ? -500 : 0;
    return chain*1000 + shape + instant;
  }

  /* =========================
     最善手探索
  ========================= */

  function getBestMove(board, a, c){
    let best={x:2,rot:0}, bestScore=-1e9;

    for(let x=0;x<WIDTH;x++)for(let r=0;r<4;r++){
      let b=clone(board);
      if(!place(b,x,r,a,c)) continue;
      let s=evaluate(b);
      if(s>bestScore){
        bestScore=s;
        best={x,rot:r};
      }
    }
    return best;
  }

  function place(board,x,rot,a,c){
    const ps=[[x,13,a]];
    if(rot===0) ps.push([x,14,c]);
    if(rot===1) ps.push([x+1,13,c]);
    if(rot===2) ps.push([x,12,c]);
    if(rot===3) ps.push([x-1,13,c]);
    for(const [px] of ps) if(px<0||px>=WIDTH) return false;
    ps.sort((p,q)=>p[1]-q[1]);
    for(const [px,py,col] of ps){
      let y=py;
      while(y>0&&board[y-1][px]===0) y--;
      if(y<HEIGHT) board[y][px]=col;
    }
    for(let i=0;i<WIDTH;i++) board[13][i]=0;
    return true;
  }

  return { getBestMove };
})();
