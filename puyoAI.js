/**
 * PuyoAI.js (v15)
 * 大連鎖特化・非即消し・発火色固定モデル
 */

const PuyoAI = (() => {
    const WIDTH = 6;
    const HEIGHT = 14;
    const COLORS = [1, 2, 3, 4];

    let FIRE_COLOR = null;

    /* =============================
       メイン評価関数
    ============================= */
    function evaluateBoard(board) {
        let score = 0;

        // 窒息チェック（3列目）
        let h3 = 0;
        while (h3 < HEIGHT && board[h3][2] !== 0) h3++;
        if (h3 >= 11) return -1e9;

        const visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));

        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                if (board[y][x] === 0 || visited[y][x]) continue;

                const color = board[y][x];
                const stack = [{ x, y }];
                const group = [];
                visited[y][x] = true;

                while (stack.length) {
                    const p = stack.pop();
                    group.push(p);
                    [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy]) => {
                        const nx = p.x + dx, ny = p.y + dy;
                        if (
                            nx >= 0 && nx < WIDTH &&
                            ny >= 0 && ny < HEIGHT &&
                            !visited[ny][nx] &&
                            board[ny][nx] === color
                        ) {
                            visited[ny][nx] = true;
                            stack.push({ x: nx, y: ny });
                        }
                    });
                }

                /* ===== 評価 ===== */

                // 即消し完全否定
                if (group.length >= 4) {
                    score -= 1_000_000;
                    if (color === FIRE_COLOR) score -= 500_000;
                    continue;
                }

                // 3連結（最重要）
                if (group.length === 3) {
                    let avgY = group.reduce((s,p)=>s+p.y,0)/3;
                    score += 80_000;

                    // 中段ボーナス
                    if (avgY >= 4 && avgY <= 7) score += 50_000;

                    // 発火色なら慎重
                    if (color === FIRE_COLOR) score -= 30_000;
                }

                // 2連結（種）
                if (group.length === 2) {
                    score += 8_000;
                }
            }
        }

        // 折り返し・段差ボーナス
        score += evaluateShape(board);

        return score;
    }

    /* =============================
       段差・折り返し評価
    ============================= */
    function evaluateShape(board) {
        let bonus = 0;
        let heights = [];

        for (let x = 0; x < WIDTH; x++) {
            let h = 0;
            while (h < HEIGHT && board[h][x] !== 0) h++;
            heights.push(h);
        }

        for (let i = 0; i < WIDTH - 1; i++) {
            let d = heights[i] - heights[i+1];
            if (Math.abs(d) === 1 || Math.abs(d) === 2) bonus += 5_000;
            if (Math.abs(d) >= 4) bonus += 2_000;
        }

        return bonus;
    }

    /* =============================
       最善手探索（3手先）
    ============================= */
    function getBestMove(board, next) {
        if (!FIRE_COLOR) FIRE_COLOR = mostFrequentColor(board);

        let best = { score: -Infinity, x: 2, r: 0 };

        for (let x = 0; x < WIDTH; x++) {
            for (let r = 0; r < 4; r++) {
                let b1 = applyMove(board, next[0], next[1], x, r);
                if (!b1) continue;

                let s1 = evaluateBoard(b1);
                if (s1 > best.score) {
                    best = { score: s1, x, r };
                }
            }
        }
        return { x: best.x, rotation: best.r };
    }

    /* =============================
       発火色決定
    ============================= */
    function mostFrequentColor(board) {
        let count = {};
        COLORS.forEach(c => count[c] = 0);
        board.forEach(row => row.forEach(c => c && count[c]++));
        return COLORS.reduce((a,b)=>count[a]>count[b]?a:b);
    }

    /* =============================
       ぷよ設置
    ============================= */
    function applyMove(board, p1, p2, x, r) {
        let b = board.map(row => [...row]);
        let pos = [];

        if (r === 0) pos = [{x, y:0}, {x, y:1}];
        if (r === 1) pos = [{x, y:0}, {x:x+1, y:0}];
        if (r === 2) pos = [{x, y:1}, {x, y:0}];
        if (r === 3) pos = [{x, y:0}, {x:x-1, y:0}];

        if (pos.some(p => p.x < 0 || p.x >= WIDTH)) return null;

        let h = pos.map(p => {
            let y = 0;
            while (y < HEIGHT && b[y][p.x] !== 0) y++;
            return y;
        });

        if (Math.max(...h) >= 12) return null;

        b[h[0]][pos[0].x] = p1;
        b[h[1]][pos[1].x] = p2;

        return b;
    }

    return { getBestMove };
})();

if (typeof module !== 'undefined') module.exports = PuyoAI;
