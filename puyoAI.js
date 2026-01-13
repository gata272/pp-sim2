/**
 * PuyoAI ProBuilder v1
 * 上位ぷよらー思考完全反映型
 * 「消さず・縦3・段差・未完成」
 */

const PuyoAI = (() => {
  const WIDTH = 6;
  const HEIGHT = 14;
  const COLORS = [1,2,3,4];

  /* ================= 評価関数 ================= */

  function evaluate(board) {
    let score = 0;

    // ① 即消しチェック（最大ペナルティ）
    const sim = simulateChain(board);
    if (sim.chains === 1) return -1e9;
    if (sim.chains >= 2) score += sim.chains * 200000;

    // ② 縦3・縦2評価
    score += verticalPotential(board);

    // ③ 段差評価
    score += stepPotential(board);

    // ④ 高さ分散（偏り防止）
    score += heightBalance(board);

    // ⑤ 発火未完成ボーナス
    score += unfinishedBonus(board);

    // ⑥ 窒息防止
    if (isChoked(board)) score -= 1e8;

    return score;
  }

  /* ================= 評価詳細 ================= */

  function verticalPotential(board) {
    let s = 0;
    for (let x=0;x<WIDTH;x++) {
      let streak = 1;
      for (let y=1;y<12;y++) {
        if (board[y][x] && board[y][x] === board[y-1][x]) {
          streak++;
        } else {
          if (streak === 3) s += 200000;
          if (streak === 2) s += 20000;
          if (streak >= 4) s -= 300000;
          streak = 1;
        }
      }
    }
    return s;
  }

  function stepPotential(board) {
    let s = 0;
    const h = columnHeights(board);
    for (let i=0;i<WIDTH-1;i++) {
      const d = Math.abs(h[i]-h[i+1]);
      if (d === 1 || d === 2) s += 30000;
      if (d === 0) s -= 20000;
      if (d >= 4) s -= 30000;
    }
    return s;
  }

  function heightBalance(board) {
    const h = columnHeights(board);
    const avg = h.reduce((a,b)=>a+b,0)/WIDTH;
    let v = 0;
    h.forEach(x => v += Math.abs(x-avg));
    return -v * 1000;
  }

  function unfinishedBonus(board) {
    let s = 0;
    const visited = Array.from({length:12},()=>Array(WIDTH).fill(false));
    for (let y=0;y<12;y++) {
      for (let x=0;x<WIDTH;x++) {
        if (!visited[y][x] && board[y][x]) {
          let g=[];
          dfs(board,x,y,visited,g);
          if (g.length === 3) s += 100000;
          if (g.length === 4) s -= 500000;
        }
      }
    }
    return s;
  }

  function isChoked(board) {
    let h=0;
    while (h<HEIGHT && board[h][2]!==0) h++;
    return h>=11;
  }

  /* ================= 探索 ================= */

  function getBestMove(board, next) {
    let best = -Infinity;
    let bestMove = {x:2,rotation:0};

    for (let x=0;x<WIDTH;x++) {
      for (let r=0;r<4;r++) {
        const b = applyMove(board,next[0],next[1],x,r);
        if (!b) continue;

        let worst = Infinity;
        for (let c1 of COLORS) for (let c2 of COLORS) {
          const b2 = applyMove(b,c1,c2,x,r);
          if (!b2) continue;
          worst = Math.min(worst,evaluate(b2));
        }

        if (worst > best) {
          best = worst;
          bestMove = {x,rotation:r};
        }
      }
    }
    return bestMove;
  }

  /* ================= 基本処理 ================= */

  function applyMove(board,p1,p2,x,r) {
    const b = board.map(r=>[...r]);
    let pos = [];
    if (r===0) pos=[[x,1,p1],[x,0,p2]];
    if (r===1) pos=[[x,0,p1],[x+1,0,p2]];
    if (r===2) pos=[[x,0,p2],[x,1,p1]];
    if (r===3) pos=[[x,0,p1],[x-1,0,p2]];

    for (let [px] of pos) if (px<0||px>=WIDTH) return null;
    for (let [px,_,c] of pos) {
      let y=0; while (y<HEIGHT && b[y][px]) y++;
      if (y>=12) return null;
      b[y][px]=c;
    }
    return b;
  }

  function simulateChain(board) {
    let chains=0;
    const b=board.map(r=>[...r]);
    while (true) {
      const del=[];
      const vis=Array.from({length:12},()=>Array(WIDTH).fill(false));
      for (let y=0;y<12;y++) for (let x=0;x<WIDTH;x++)
        if (b[y][x]&&!vis[y][x]) {
          const g=[];
          dfs(b,x,y,vis,g);
          if (g.length>=4) del.push(...g);
        }
      if (!del.length) break;
      del.forEach(p=>b[p.y][p.x]=0);
      gravity(b);
      chains++;
    }
    return {chains};
  }

  function gravity(b) {
    for (let x=0;x<WIDTH;x++) {
      let w=0;
      for (let y=0;y<HEIGHT;y++) if (b[y][x]) {
        b[w][x]=b[y][x];
        if (w!==y) b[y][x]=0;
        w++;
      }
    }
  }

  function dfs(b,x,y,v,g) {
    const c=b[y][x];
    const st=[[x,y]];
    v[y][x]=true;
    while (st.length) {
      const p=st.pop(); g.push(p);
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy])=>{
        const nx=p.x+dx, ny=p.y+dy;
        if(nx>=0&&nx<WIDTH&&ny>=0&&ny<12&&!v[ny][nx]&&b[ny][nx]===c){
          v[ny][nx]=true; st.push({x:nx,y:ny});
        }
      });
    }
  }

  function columnHeights(b) {
    return [...Array(WIDTH)].map((_,x)=>{
      let y=0; while (y<HEIGHT && b[y][x]) y++; return y;
    });
  }

  return { getBestMove };
})();
