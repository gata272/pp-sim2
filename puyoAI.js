/**
 * PuyoAI_safe.js
 * - オーバーフロー回避のための列高さペナルティ＋モンテカルロで将来リスク評価
 * - getBestMove(board, nextPuyos, options)
 */

const PuyoAI = (function() {
    const WIDTH = 6;
    const HEIGHT = 14;
    const COLORS = [1, 2, 3, 4];

    // ---------- 基本シミュレータ ----------
    function simulatePureChain(board) {
        let totalChains = 0;
        while (true) {
            let toErase = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
            let visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
            let any = false;
            for (let y = 0; y < HEIGHT; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    if (board[y][x] !== 0 && !visited[y][x]) {
                        let color = board[y][x];
                        let stack = [{x,y}];
                        visited[y][x] = true;
                        let group = [];
                        while (stack.length > 0) {
                            let p = stack.pop();
                            group.push(p);
                            [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx,dy])=>{
                                let nx = p.x+dx, ny = p.y+dy;
                                if (nx>=0 && nx<WIDTH && ny>=0 && ny<HEIGHT && !visited[ny][nx] && board[ny][nx] === color) {
                                    visited[ny][nx] = true;
                                    stack.push({x:nx,y:ny});
                                }
                            });
                        }
                        if (group.length >= 4) {
                            any = true;
                            group.forEach(p => toErase[p.y][p.x] = true);
                        }
                    }
                }
            }
            if (!any) break;
            totalChains++;
            // erase
            for (let y=0; y<HEIGHT; y++) for (let x=0; x<WIDTH; x++) if (toErase[y][x]) board[y][x] = 0;
            // gravity
            for (let x=0; x<WIDTH; x++) {
                let writeY = 0;
                for (let readY=0; readY<HEIGHT; readY++) {
                    if (board[readY][x] !== 0) {
                        board[writeY][x] = board[readY][x];
                        if (writeY !== readY) board[readY][x] = 0;
                        writeY++;
                    }
                }
                for (; writeY<HEIGHT; writeY++) board[writeY][x] = 0;
            }
        }
        return { chains: totalChains };
    }

    // ---------- ヘルパー ----------
    function getColumnHeights(board) {
        let heights = Array(WIDTH).fill(0);
        for (let x=0; x<WIDTH; x++) {
            let h = 0;
            while (h < HEIGHT && board[h][x] !== 0) h++;
            heights[x] = h;
        }
        return heights;
    }
    function countHoles(board) {
        let holes = 0;
        for (let x=0; x<WIDTH; x++) {
            let seen = false;
            for (let y=0; y<HEIGHT; y++) {
                if (board[y][x] !== 0) seen = true;
                else if (seen) holes++;
            }
        }
        return holes;
    }
    function heightVariance(heights) {
        let mean = heights.reduce((a,b)=>a+b,0)/heights.length;
        return heights.reduce((s,h)=>s+(h-mean)*(h-mean),0)/heights.length;
    }

    // ---------- applyMove（縦/横の配置ロジック） ----------
    function applyMove(board, p1, p2, x, r) {
        let temp = board.map(row => [...row]);
        let pos1x = x, pos2x = x;
        if (r === 0) { pos1x = x; pos2x = x; }        // 縦: p1 上 / p2 下 (扱いは下参照)
        else if (r === 1) { pos1x = x; pos2x = x + 1; } // 横: p1 左, p2 右
        else if (r === 2) { pos1x = x; pos2x = x; } // 縦反転: p1 下 / p2 上
        else if (r === 3) { pos1x = x; pos2x = x - 1; } // 横反転: p1 右, p2 左
        else return null;
        if (pos1x < 0 || pos1x >= WIDTH || pos2x < 0 || pos2x >= WIDTH) return null;

        let h1 = 0; while (h1 < HEIGHT && temp[h1][pos1x] !== 0) h1++;
        let h2 = 0; while (h2 < HEIGHT && temp[h2][pos2x] !== 0) h2++;

        // 同列縦置き
        if (pos1x === pos2x) {
            // 縦置きはその列の最下段に2つ入るスペースが必要
            if (h1 + 1 >= HEIGHT) return null;
            if (r === 0) {
                // r=0 を「上が p1, 下が p2」と判断していた元コードの混乱を避けるため、
                // ここではインターフェースに合わせて安定的に配置:
                // place lower at h1 (p2), upper at h1+1 (p1)
                temp[h1][pos1x] = p2;
                temp[h1+1][pos1x] = p1;
            } else if (r === 2) {
                temp[h1][pos1x] = p1;
                temp[h1+1][pos1x] = p2;
            } else {
                return null;
            }
        } else {
            // 横置き: 各列の現在の高さに落とす
            if (h1 >= HEIGHT || h2 >= HEIGHT) return null;
            temp[h1][pos1x] = p1;
            temp[h2][pos2x] = p2;
        }
        return temp;
    }

    // ---------- countConnections（種） ----------
    function countConnectionsEnhanced(board) {
        let score = 0;
        let visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
        for (let y=0; y<HEIGHT; y++) {
            for (let x=0; x<WIDTH; x++) {
                if (board[y][x] !== 0 && !visited[y][x]) {
                    let stack = [{x,y}], color = board[y][x], size=0;
                    visited[y][x] = true;
                    while (stack.length) {
                        let p = stack.pop(); size++;
                        [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx,dy])=>{
                            let nx = p.x+dx, ny = p.y+dy;
                            if (nx>=0 && nx<WIDTH && ny>=0 && ny<HEIGHT && !visited[ny][nx] && board[ny][nx] === color) {
                                visited[ny][nx] = true;
                                stack.push({x:nx,y:ny});
                            }
                        });
                    }
                    if (size === 3) score += 18000;
                    else if (size === 2) score += 1200;
                    else if (size === 1) score += 200;
                    if (size >= 4) score -= 4000;
                }
            }
        }
        return score;
    }

    // ---------- 軽量評価（途中探索用） ----------
    function quickScore(board) {
        // テンプレ検出は残さず、分散・holes・maxHeight を主に評価する軽量版
        let heights = getColumnHeights(board);
        let holes = countHoles(board);
        let varh = heightVariance(heights);
        let maxH = Math.max(...heights);
        // maxH に対する急峻なペナルティで単一列集中を嫌う
        let maxPen = Math.pow(Math.max(0, maxH - 8), 3) * 5000;
        let holePen = holes * 2500;
        let varPen = varh * 1200;
        let conn = countConnectionsEnhanced(board) * 0.1; // 軽く参照
        return - (maxPen + holePen + varPen) + conn;
    }

    // ---------- 簡易モンテカルロ: ランダムな未来を試し、その過程でのオーバーフロー確率を返す ----------
    function simulateRandomFutureOverflowRate(board, trials = 60, futurePairs = 3) {
        // policy: greedy by quickScore (minimizes max height & holes)
        let overflowCount = 0;
        for (let t = 0; t < trials; t++) {
            let b = board.map(row => [...row]);
            let overflowed = false;
            for (let step = 0; step < futurePairs; step++) {
                // random next pair
                let p1 = COLORS[Math.floor(Math.random() * COLORS.length)];
                let p2 = COLORS[Math.floor(Math.random() * COLORS.length)];
                // choose best placement by quickScore (try all placements)
                let best = null;
                for (let x = 0; x < WIDTH; x++) {
                    for (let r = 0; r < 4; r++) {
                        let nb = applyMove(b, p1, p2, x, r);
                        if (!nb) continue;
                        let s = quickScore(nb);
                        if (!best || s > best.score) best = { board: nb, score: s };
                    }
                }
                if (!best) { overflowed = true; break; }
                b = best.board;
                // immediate overflow check (column >= 12)
                let heights = getColumnHeights(b);
                if (Math.max(...heights) >= 12) { overflowed = true; break; }
            }
            if (overflowed) overflowCount++;
        }
        return overflowCount / trials;
    }

    // ---------- 総合評価（最終候補のより詳細な評価）
    //   overflowPenaltyWeight を大きくしてオーバーフローしやすい盤面を強力に弾く
    // ----------
    function evaluateBoardWithMC(board, options = {}) {
        const mcTrials = options.mcTrials || 60;
        const futurePairs = options.futurePairs || 3;
        // immediate fatal: 3列目 overflow (元コードルール反映)
        let h3 = 0;
        while (h3 < HEIGHT && board[h3][2] !== 0) h3++;
        if (h3 >= 11) return { score: -2e7, details: { reason: 'col3_over' } };

        // base metrics
        let heights = getColumnHeights(board);
        let holes = countHoles(board);
        let varh = heightVariance(heights);
        let maxH = Math.max(...heights);

        // potential chain check (簡易: 各列各色1つで試す)
        let maxChain = 0;
        for (let x=0; x<WIDTH; x++) {
            let h = heights[x];
            if (h >= HEIGHT - 1) continue;
            for (let color of COLORS) {
                let tmp = board.map(row=>[...row]); tmp[h][x] = color;
                let res = simulatePureChain(tmp);
                if (res.chains > maxChain) maxChain = res.chains;
            }
        }
        let potentialScore = Math.pow(Math.max(0, maxChain), 6) * 1400;

        // connections (種)
        let conn = countConnectionsEnhanced(board);

        // 強力な列高さペナルティ（単列集中対策）
        let colPenalty = 0;
        for (let h of heights) {
            if (h > 8) colPenalty += Math.pow(h - 8, 3) * 4500; // 9,10,11が急増
        }

        // holes / variance penalties
        let holePen = holes * 3000;
        let varPen = varh * 1500;

        // MC オーバーフローレート
        let overflowRate = simulateRandomFutureOverflowRate(board, mcTrials, futurePairs);
        // オーバーフローの重み（非常に大きくして、オーバーフロー率がある候補は容易に弾く）
        let overflowPenalty = overflowRate * 1e7;

        let total = potentialScore + conn - colPenalty - holePen - varPen - overflowPenalty;

        return {
            score: total,
            details: {
                maxChain, potentialScore, conn, colPenalty, holePen, varPen, overflowRate, heights, holes, varh
            }
        };
    }

    // ---------- getBestMove : ビームサーチ + 最終精査（MC評価） ----------
    // options: { depth, beamWidth, mcTrials, futurePairs }
    function getBestMove(board, nextPuyos, options = {}) {
        const depth = options.depth || Math.min(Math.floor(nextPuyos.length / 2), 3);
        const beamWidth = options.beamWidth || 180;
        const templates = []; // 今回テンプレマッチは省略して MC リスク回避を優先（テンプレは追加可）

        // 初期ビーム
        let beam = [{ board: board.map(row=>[...row]), seq: [], score: 0 }];

        // 展開（浅めの評価で枝を絞る）
        for (let step=0; step<depth; step++) {
            let p1 = nextPuyos[step*2];
            let p2 = nextPuyos[step*2 + 1];
            let candidates = [];
            for (let node of beam) {
                for (let x=0; x<WIDTH; x++) for (let r=0; r<4; r++) {
                    let nb = applyMove(node.board, p1, p2, x, r);
                    if (!nb) continue;
                    // 途中評価は quickScore を使用して単列化を避ける方向へ誘導
                    let s = quickScore(nb);
                    candidates.push({ board: nb, seq: node.seq.concat([{x,r,p1,p2}]), score: s });
                }
            }
            if (candidates.length === 0) break;
            candidates.sort((a,b)=>b.score - a.score);
            beam = candidates.slice(0, beamWidth);
        }

        // beam 中の候補を MC で精査（オーバーフロー率を含む）
        let best = null;
        for (let node of beam) {
            // 精密評価（MC）
            let evalRes = evaluateBoardWithMC(node.board, { mcTrials: options.mcTrials || 60, futurePairs: options.futurePairs || 3 });
            // さらに実際の連鎖数を計測して強く重視
            let simulated = simulatePureChain(node.board.map(row=>[...row]));
            let finalScore = evalRes.score + simulated.chains * 70000; // 実連鎖は非常に重要
            if (!best || finalScore > best.finalScore) {
                best = { finalScore, node, evalRes, simulated };
            }
        }

        if (!best) return { x: 2, rotation: 0, expectedChains: 0, score: -Infinity, info: null };

        let first = best.node.seq[0] || { x: 2, r: 0 };
        return {
            x: first.x,
            rotation: first.r,
            expectedChains: best.simulated.chains,
            score: best.finalScore,
            info: {
                seq: best.node.seq,
                evalDetails: best.evalRes ? best.evalRes.details : null,
                finalHeights: getColumnHeights(best.node.board),
                simulatedChains: best.simulated.chains
            }
        };
    }

    return { getBestMove };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PuyoAI;
}
