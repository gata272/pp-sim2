/**
 * PuyoAI_safe.js
 * 安定性最優先・縦積み即死防止・大連鎖志向AI
 * Puyo Puyo Tetris 2 互換挙動前提
 */

const PuyoAI = (() => {

    const WIDTH = 6;
    const HEIGHT = 14;
    const COLORS = [1, 2, 3, 4];
    const EMPTY = 0;

    /* =========================
       重力
    ========================= */
    function simulateGravity(board) {
        for (let x = 0; x < WIDTH; x++) {
            let write = 0;
            for (let y = 0; y < HEIGHT; y++) {
                if (board[y][x] !== EMPTY) {
                    board[write][x] = board[y][x];
                    if (write !== y) board[y][x] = EMPTY;
                    write++;
                }
            }
        }
    }

    /* =========================
       連鎖シミュレーション
    ========================= */
    function simulateChain(board) {
        let chains = 0;

        while (true) {
            const visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
            let erase = [];

            for (let y = 0; y < HEIGHT; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    if (board[y][x] === EMPTY || visited[y][x]) continue;

                    let color = board[y][x];
                    let stack = [{ x, y }];
                    let group = [];
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

                    if (group.length >= 4) erase.push(...group);
                }
            }

            if (erase.length === 0) break;

            erase.forEach(p => board[p.y][p.x] = EMPTY);
            simulateGravity(board);
            chains++;
        }

        return chains;
    }

    /* =========================
       正しい落下配置（重要）
    ========================= */
    function simulateDrop(board, x, rot, c1, c2) {
        const temp = board.map(r => [...r]);

        let axis = { x, y: HEIGHT - 2 };
        let child = { x, y: HEIGHT - 2 };

        if (rot === 0) child.y++;
        if (rot === 1) child.x++;
        if (rot === 2) child.y--;
        if (rot === 3) child.x--;

        if (
            axis.x < 0 || axis.x >= WIDTH ||
            child.x < 0 || child.x >= WIDTH
        ) return null;

        while (true) {
            const na = { x: axis.x, y: axis.y - 1 };
            const nc = { x: child.x, y: child.y - 1 };

            if (
                na.y < 0 || nc.y < 0 ||
                temp[na.y]?.[na.x] !== EMPTY ||
                temp[nc.y]?.[nc.x] !== EMPTY
            ) break;

            axis = na;
            child = nc;
        }

        temp[axis.y][axis.x] = c1;
        temp[child.y][child.x] = c2;

        simulateGravity(temp);
        return temp;
    }

    /* =========================
       即死判定
    ========================= */
    function isDead(board) {
        return board[HEIGHT - 3][2] !== EMPTY;
    }

    /* =========================
       高さ・集中ペナルティ
    ========================= */
    function heightPenalty(board) {
        let p = 0;
        for (let x = 0; x < WIDTH; x++) {
            let h = 0;
            for (let y = HEIGHT - 1; y >= 0; y--) {
                if (board[y][x] !== EMPTY) {
                    h = y;
                    break;
                }
            }
            const centerWeight = Math.abs(2.5 - x) + 1;
            p += h * h * centerWeight;
        }
        return p;
    }

    /* =========================
       連結評価
    ========================= */
    function connectionScore(board) {
        let score = 0;
        const visited = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));

        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                if (board[y][x] === EMPTY || visited[y][x]) continue;

                let color = board[y][x];
                let stack = [{ x, y }];
                let size = 0;
                visited[y][x] = true;

                while (stack.length) {
                    const p = stack.pop();
                    size++;
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

                if (size === 3) score += 3000;
                if (size === 2) score += 500;
            }
        }
        return score;
    }

    /* =========================
       総合評価
    ========================= */
    function evaluate(board) {
        if (isDead(board)) return -Infinity;

        const copy = board.map(r => [...r]);
        const chains = simulateChain(copy);

        return (
            chains * 120000 +
            connectionScore(board) -
            heightPenalty(board)
        );
    }

    /* =========================
       最善手探索
    ========================= */
    function getBestMove(board, next) {
        let best = { score: -Infinity, x: 2, rotation: 0 };

        for (let x = 0; x < WIDTH; x++) {
            for (let r = 0; r < 4; r++) {
                const b1 = simulateDrop(board, x, r, next[0], next[1]);
                if (!b1) continue;

                let score = evaluate(b1);

                if (score > best.score) {
                    best = { score, x, rotation: r };
                }
            }
        }
        return best;
    }

    return { getBestMove };

})();

if (typeof module !== "undefined") {
    module.exports = PuyoAI;
}
