/**
 * PuyoAI v16 - Big Chain Only (No LR Bias)
 * ・左右バイアスなし
 * ・1連鎖即死
 * ・無理発火禁止
 * ・縦積み物理排除
 */

const PuyoAI = (() => {

  const WIDTH = 6;
  const HEIGHT = 14;
  const COLORS = [1,2,3,4];

  const clone = b => b.map(r => [...r]);

  function columnHeights(board) {
    return Array.from({length:WIDTH},(_,x)=>{
      let y=0; while(y<HEIGHT && board[y][x]) y++;
      return y;
    });
  }

  /* ================= 連鎖 ================= */

  function applyGravity(board) {
    for (let x=0;x<WIDTH;x++) {
      let w=0;
      for (let y=0;y<12;y++) {
        if (board[y][x]) {
          board[w][x]=board[y][x];
          if (w!==y) board[y][x]=0;
          w++;
        }
      }
    }
  }

  function simulatePureChain(board) {
    let chains=0;
    while(true){
      let erase=false;
      let vis=Array.from({length:12},()=>Array(WIDTH).fill(false));
      for(let y=0;y<12;y++)for(let x=0;x<WIDTH;x++){
        if(!board[y][x]||vis[y][x])continue;
        let c=board[y][x],st=[[x,y]],grp=[];
        vis[y][x]=true;
        while(st.length){
          let[p,q]=st.pop(); grp.push([p,q]);
          for(let[dX,dY] of [[1,0],[-1,0],[0,1],[0,-1]]){
            let nx=p+dX, ny=q+dY;
            if(nx>=0&&nx<WIDTH&&ny>=0&&ny<12&&!vis[ny][nx]&&board[ny][nx]===c){
              vis[ny][nx]=true; st.push([nx,ny]);
            }
          }
        }
        if(grp.length>=4){
          erase=true;
          grp.forEach(([x,y])=>board[y][x]=0);
        }
      }
      if(!erase) break;
      applyGravity(board);
      chains++;
    }
    return chains;
  }

  /* ================= 評価 ================= */

  function evaluate(board) {
    let score=0;

    // 即消し完全禁止
    let tmp=clone(board);
    let c=simulatePureChain(tmp);
    if(c>=1) return -10_000_000;

    // 縦積み物理排除
    let heights=columnHeights(board);
    for(let h of heights){
      if(h>=11) return -5_000_000;
      if(h>=9) score-=200_000;
    }

    // 3連結抑制
    let vis=Array.from({length:12},()=>Array(WIDTH).fill(false));
    for(let y=0;y<12;y++)for(let x=0;x<WIDTH;x++){
      if(board[y][x]&&!vis[y][x]){
        let c=board[y][x],st=[[x,y]],cnt=0;
        vis[y][x]=true;
        while(st.length){
          let[p,q]=st.pop(); cnt++;
          for(let[dX,dY] of [[1,0],[-1,0],[0,1],[0,-1]]){
            let nx=p+dX, ny=q+dY;
            if(nx>=0&&nx<WIDTH&&ny>=0&&ny<12&&!vis[ny][nx]&&board[ny][nx]===c){
              vis[ny][nx]=true; st.push([nx,ny]);
            }
          }
        }
        if(cnt===3) score-=3000;
      }
    }

    // 消えない未来連鎖のみ評価
    let maxFuture=0;
    for(let x=0;x<WIDTH;x++){
      for(let c of COLORS){
        let b=clone(board);
        let y=0; while(y<12&&b[y][x]) y++;
        if(y>=12) continue;
        b[y][x]=c;
        let f=simulatePureChain(b);
        if(f===0) continue;
        maxFuture=Math.max(maxFuture,f);
      }
    }

    score+=Math.pow(maxFuture,6)*8000;
    return score;
  }

  /* ================= 探索 ================= */

  function place(board,p1,p2,x,r){
    let b=clone(board);
    let cs=[];
    if(r===0)cs=[[x,p2],[x,p1]];
    if(r===2)cs=[[x,p1],[x,p2]];
    if(r===1)cs=[[x,p1],[x+1,p2]];
    if(r===3)cs=[[x,p1],[x-1,p2]];
    for(let[cx]of cs)if(cx<0||cx>=WIDTH)return null;
    for(let[cx,col]of cs){
      let y=0; while(y<12&&b[y][cx])y++;
      if(y>=12)return null;
      b[y][cx]=col;
    }
    return b;
  }

  function getBestMove(board,next){
    let best={s:-Infinity,x:2,r:0};
    for(let x=0;x<WIDTH;x++)for(let r=0;r<4;r++){
      let b=place(board,next[0],next[1],x,r);
      if(!b)continue;
      let s=evaluate(b);
      if(s>best.s)best={s,x,r};
    }
    return {x:best.x,rotation:best.r};
  }

  return {getBestMove};
})();

if(typeof module!=="undefined")module.exports=PuyoAI;
