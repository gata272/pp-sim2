/**
 * PuyoAI_optimal.js
 * - テンプレート検出（GTR/階段/サンド）＋拡張評価＋深ビームサーチ
 * - getBestMove(board, nextPuyos, options) -> { x, rotation, expectedChains, score, info }
 */

const PuyoAI = (function() {
    const WIDTH = 6;
    const HEIGHT = 14;
    const COLORS = [1, 2, 3, 4];

    // ----------------------------
    // simulatePureChain: 連鎖シミュレータ（4個以上消去、落下処理含む）
    // board の y=0 が「下」(落ちていく方向)という前提で動きます（元コード準拠）
    // ----------------------------
    function simulatePureChain(board) {
        let totalChains = 0;
        while (true) {
            let toEraseMap = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
            let visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
            let anyErase = false;
            for (let y = 0; y < HEIGHT; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    if (board[y][x] !== 0 && !visited[y][x]) {
                        let color = board[y][x];
                        let stack = [{x, y}];
                        let group = [];
                        visited[y][x] = true;
                        while (stack.length > 0) {
                            let p = stack.pop();
                            group.push(p);
                            [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx, dy]) => {
                                let nx = p.x + dx, ny = p.y + dy;
                                if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT &&
                                    !visited[ny][nx] && board[ny][nx] === color) {
                                    visited[ny][nx] = true;
                                    stack.push({x: nx, y: ny});
                                }
                            });
                        }
                        if (group.length >= 4) {
                            anyErase = true;
                            group.forEach(p => toEraseMap[p.y][p.x] = true);
                        }
                    }
                }
            }
            if (!anyErase) break;
            totalChains++;
            // 消去
            for (let y = 0; y < HEIGHT; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    if (toEraseMap[y][x]) board[y][x] = 0;
                }
            }
            // 落下（下が小さい index のため、下から積む）
            for (let x = 0; x < WIDTH; x++) {
                let writeY = 0;
                for (let readY = 0; readY < HEIGHT; readY++) {
                    if (board[readY][x] !== 0) {
                        board[writeY][x] = board[readY][x];
                        if (writeY !== readY) board[readY][x] = 0;
                        writeY++;
                    }
                }
                for (; writeY < HEIGHT; writeY++) board[writeY][x] = 0;
            }
        }
        return { chains: totalChains };
    }

    // ----------------------------
    // ヘルパー（列高さ、穴、分散）
    // ----------------------------
    function getColumnHeights(board) {
        let heights = Array(WIDTH).fill(0);
        for (let x = 0; x < WIDTH; x++) {
            let h = 0;
            while (h < HEIGHT && board[h][x] !== 0) h++;
            heights[x] = h;
        }
        return heights;
    }
    function countHoles(board) {
        let holes = 0;
        for (let x = 0; x < WIDTH; x++) {
            let seenBlock = false;
            for (let y = 0; y < HEIGHT; y++) {
                if (board[y][x] !== 0) seenBlock = true;
                else if (seenBlock) holes++;
            }
        }
        return holes;
    }
    function heightVariance(heights) {
        let mean = heights.reduce((a,b)=>a+b,0)/heights.length;
        return heights.reduce((s,h)=>s + (h-mean)*(h-mean),0)/heights.length;
    }

    // ----------------------------
    // テンプレート群（簡単な GTR / stairs / sandwich のマスク）
    // - 各テンプレートは小さなグリッド (w,h) と、0=無視, 1=ブロック, -1=空欄 を持つ
    // - マッチ条件: テンプレートの 1 の場所に「任意の色(非0)」、-1 の場所に「0（空）」が必要
    // ----------------------------
    function buildTemplates() {
        // シンプルな例を複数用意（小さいテンプレ）
        // 注意: テンプレはローカルに簡易的に検出するためのもの。必要なら拡張してください。
        // 例: stairs (3段) — 横3×高さ3 のうち斜めに積まれている形
        let templates = [];

        // Stairs (右上に階段)
        templates.push({
            name: 'stairs3_right',
            w: 3, h: 3,
            mask: [
                [0,0,1],
                [0,1,0],
                [1,0,0]
            ],
            weight: 8000
        });
        // Stairs (左上に階段)
        templates.push({
            name: 'stairs3_left',
            w: 3, h: 3,
            mask: [
                [1,0,0],
                [0,1,0],
                [0,0,1]
            ],
            weight: 8000
        });

        // Sandwich (簡易): 中央に別色（空間）を残し、両側トップが同色を作れる余地がある形
        // マスク: 左と右はブロック、中央は空
        templates.push({
            name: 'sandwich3',
            w: 3, h: 2,
            mask: [
                [1,0,1],
                [1,0,1]
            ],
            weight: 6000
        });

        // GTR-like small hook: 平坦 + トリガー候補（簡易）
        templates.push({
            name: 'gtr_hook',
            w: 4, h: 3,
            mask: [
                [0,0,0,0],
                [1,1,1,1],
                [1,0,1,0]
            ],
            weight: 9000
        });

        return templates;
    }

    function matchTemplateAt(board, template, baseX, baseY) {
        for (let ty = 0; ty < template.h; ty++) {
            for (let tx = 0; tx < template.w; tx++) {
                let m = template.mask[ty][tx];
                if (m === 0) continue;
                let bx = baseX + tx;
                let by = baseY + (template.h - 1 - ty); // テンプレの上行を高い y に合わせる
                if (bx < 0 || bx >= WIDTH || by < 0 || by >= HEIGHT) return false;
                if (m === 1 && board[by][bx] === 0) return false;    // ブロック欲しいのに空
                if (m === -1 && board[by][bx] !== 0) return false;   // 空欲しいのに埋まっている
            }
        }
        return true;
    }

    function detectTemplateScores(board, templates) {
        let total = 0;
        let counts = {};
        for (let t of templates) counts[t.name] = 0;
        for (let t of templates) {
            for (let baseX = -2; baseX <= WIDTH; baseX++) {
                for (let baseY = 0; baseY < HEIGHT; baseY++) {
                    if (matchTemplateAt(board, t, baseX, baseY)) {
                        counts[t.name]++;
                        total += t.weight;
                    }
                }
            }
        }
        return { total, counts };
    }

    // ----------------------------
    // 改良版連結評価（3連・2連・1連の価値を考慮）
    // ----------------------------
    function countConnectionsEnhanced(board) {
        let score = 0;
        let visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                if (board[y][x] !== 0 && !visited[y][x]) {
                    let color = board[y][x];
                    let stack = [{x,y}];
                    visited[y][x] = true;
                    let groupSize = 0;
                    while (stack.length > 0) {
                        let p = stack.pop();
                        groupSize++;
                        [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dx,dy])=>{
                            let nx = p.x+dx, ny = p.y+dy;
                            if (nx>=0 && nx<WIDTH && ny>=0 && ny<HEIGHT && !visited[ny][nx] && board[ny][nx] === color) {
                                visited[ny][nx] = true;
                                stack.push({x:nx,y:ny});
                            }
                        });
                    }
                    if (groupSize === 3) score += 18000;
                    else if (groupSize === 2) score += 1200;
                    else if (groupSize === 1) score += 200;
                    if (groupSize >= 4) score -= 4000;
                }
            }
        }
        return score;
    }

    // ----------------------------
    // 評価関数（総合）
    // - 潜在連鎖（各列に各色1個を仮置きして simulate）＋テンプレスコア＋連結スコア＋穴・分散ペナルティ
    // ----------------------------
    function evaluateBoard(board, templates) {
        // 即死判定（3列目が11段以上）
        let h3 = 0;
        while (h3 < HEIGHT && board[h3][2] !== 0) h3++;
        if (h3 >= 11) return { score: -2e7, details: { reason: 'col3_over' } };

        let heights = getColumnHeights(board);
        let holes = countHoles(board);
        let varh = heightVariance(heights);

        // 潜在連鎖（各列に各色を1個置いて試す）
        let maxChain = 0;
        for (let x = 0; x < WIDTH; x++) {
            let h = heights[x];
            if (h >= HEIGHT - 1) continue; // 余裕のない列はスキップ
            for (let color of COLORS) {
                let temp = board.map(row => [...row]);
                temp[h][x] = color;
                let res = simulatePureChain(temp);
                if (res.chains > maxChain) maxChain = res.chains;
            }
        }
        let potentialScore = Math.pow(Math.max(0, maxChain), 6) * 1300;

        // テンプレマッチ
        let templateResult = detectTemplateScores(board, templates);

        // 連結（種）評価
        let connectionScore = countConnectionsEnhanced(board);

        // 高さ・穴ペナルティ
        let heightPenalty = varh * -1400;
        let holePenalty = -3000 * holes;

        let total = potentialScore + templateResult.total + connectionScore + heightPenalty + holePenalty;

        return {
            score: total,
            details: {
                maxChain,
                potentialScore,
                templateScore: templateResult.total,
                templateCounts: templateResult.counts,
                connectionScore,
                heightPenalty,
                holePenalty,
                heights,
                holes,
                varh
            }
        };
    }

    // ----------------------------
    // applyMove: 実際に置く（p1, p2 の順序は nextPuyos の通り）
    // 回転 r の定義：
    //  r=0: 縦（p1上/p2下） -> 同列 h を見つけ, p2 @ h, p1 @ h+1
    //  r=2: 縦（p1下/p2上） -> p1 @ h, p2 @ h+1
    //  r=1: 横（p1 が 左, p2 が 右） -> p1 @ col x, p2 @ col x+1
    //  r=3: 横（p1 が 右, p2 が 左） -> p1 @ col x, p2 @ col x-1
    // ----------------------------
    function applyMove(board, p1, p2, x, r) {
        let temp = board.map(row => [...row]);
        let pos1x = x, pos2x = x;
        if (r === 0) {
            pos1x = x; pos2x = x;
        } else if (r === 1) {
            pos1x = x; pos2x = x + 1;
        } else if (r === 2) {
            pos1x = x; pos2x = x;
        } else if (r === 3) {
            pos1x = x; pos2x = x - 1;
        } else {
            return null;
        }
        if (pos1x < 0 || pos1x >= WIDTH || pos2x < 0 || pos2x >= WIDTH) return null;

        // 各列の高さ
        let h1 = 0; while (h1 < HEIGHT && temp[h1][pos1x] !== 0) h1++;
        let h2 = 0; while (h2 < HEIGHT && temp[h2][pos2x] !== 0) h2++;

        // 同列の縦置き
        if (pos1x === pos2x) {
            // 縦置きの空きチェック（h+1が存在するか）
            if (h1 + 1 >= HEIGHT) return null;
            if (r === 0) {
                // p1上, p2下
                temp[h1][pos1x] = p2;
                temp[h1 + 1][pos1x] = p1;
            } else if (r === 2) {
                // p1下, p2上
                temp[h1][pos1x] = p1;
                temp[h1 + 1][pos1x] = p2;
            } else {
                // r other not valid here
                return null;
            }
        } else {
            // 横置き: place at respective column heights
            if (h1 >= HEIGHT || h2 >= HEIGHT) return null;
            // For horizontal, ensure we simulate physics: both pieces drop to their column heights
            temp[h1][pos1x] = p1;
            temp[h2][pos2x] = p2;
        }
        return temp;
    }

    // ----------------------------
    // ビームサーチで最良手を探索
    // options: { depth: int, beamWidth: int }
    // 戻り値: { x, rotation, expectedChains, score, info }
    // info は詳細（最終盤面の評価やテンプレカウント等）
    // ----------------------------
    function getBestMove(board, nextPuyos, options = {}) {
        const templates = buildTemplates();
        const maxDepth = options.depth || Math.floor(nextPuyos.length / 2);
        const beamWidth = options.beamWidth || 200;

        // 初期ノード
        let beam = [{
            board: board.map(row => [...row]),
            seq: [],
            score: 0
        }];

        for (let step = 0; step < maxDepth; step++) {
            let p1 = nextPuyos[step * 2];
            let p2 = nextPuyos[step * 2 + 1];
            let candidates = [];
            for (let node of beam) {
                for (let x = 0; x < WIDTH; x++) {
                    for (let r = 0; r < 4; r++) {
                        let nb = applyMove(node.board, p1, p2, x, r);
                        if (!nb) continue;
                        // 中間評価（軽量）— テンプレ含めた総合評価
                        let evalRes = evaluateBoard(nb, templates);
                        candidates.push({
                            board: nb,
                            seq: node.seq.concat([{ x, r, p1, p2 }]),
                            score: evalRes.score,
                            details: evalRes.details
                        });
                    }
                }
            }
            if (candidates.length === 0) break;
            // 上位 beamWidth を選ぶ
            candidates.sort((a,b)=>b.score - a.score);
            beam = candidates.slice(0, beamWidth);
        }

        // beam の中の各最終盤面について、本当の期待連鎖値を simulate しておく（精査）
        let best = null;
        for (let node of beam) {
            // 深い simulate：何連鎖起きるかを確認
            let simulated = simulatePureChain(node.board.map(row=>[...row]));
            // 最終評価（score に連鎖の具体値を足し込むことで「実際に連鎖がある盤面」を評価）
            // ここは重み付けで調整可能
            let finalScore = node.score + simulated.chains * 60000; // 連鎖が実際に多ければ大きく上がる
            if (!best || finalScore > best.finalScore) {
                best = {
                    finalScore,
                    node,
                    simulated
                };
            }
        }
        if (!best) {
            return { x: 2, rotation: 0, expectedChains: 0, score: -Infinity, info: null };
        }

        // 最適と判定したシーケンスの1手目を返す（ユーザーの要望：最適な場所を示す）
        let first = best.node.seq[0] || { x: 2, r: 0 };
        // 詳細情報の返却
        return {
            x: first.x,
            rotation: first.r,
            expectedChains: best.simulated.chains,
            score: best.finalScore,
            info: {
                sequence: best.node.seq,
                finalBoard: best.node.board,
                evalDetails: best.node.details,
                simulatedChains: best.simulated.chains,
                templateCounts: best.node.details ? best.node.details.templateCounts : null
            }
        };
    }

    // エクスポート
    return { getBestMove };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PuyoAI;
}
