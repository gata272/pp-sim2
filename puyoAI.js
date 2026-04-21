// ==========================================
// Puyo AI (Chain Maximization Version)
// depth-3 + pseudo-depth-4 + beam search
// ==========================================

const AI_CONFIG = {
    BEAM_WIDTH: 25,
    MAX_DEPTH: 3,
};

// -----------------------------
// エントリーポイント
// -----------------------------
window.runPuyoAI = function(board, current, next1, next2) {
    const result = beamSearch(board, current, [next1, next2]);
    return result;
};

// -----------------------------
// Beam Search
// -----------------------------
function beamSearch(board, current, nextList) {
    let beam = [{
        board: copyBoard(board),
        moves: [],
        score: 0
    }];

    for (let depth = 0; depth < AI_CONFIG.MAX_DEPTH; depth++) {
        let nextBeam = [];

        for (const node of beam) {
            const piece = depth === 0 ? current : nextList[depth - 1];

            const moves = generateMoves(node.board, piece);

            for (const move of moves) {
                const newBoard = simulate(node.board, piece, move);
                if (!newBoard) continue;

                const evalScore = evaluate(newBoard);

                nextBeam.push({
                    board: newBoard,
                    moves: [...node.moves, move],
                    score: node.score + evalScore
                });
            }
        }

        nextBeam.sort((a, b) => b.score - a.score);
        beam = nextBeam.slice(0, AI_CONFIG.BEAM_WIDTH);
    }

    return beam[0].moves[0];
}

// -----------------------------
// 全配置生成
// -----------------------------
function generateMoves(board, piece) {
    let moves = [];

    for (let x = 0; x < 6; x++) {
        for (let rot = 0; rot < 4; rot++) {
            moves.push({ x, rot });
        }
    }

    return moves;
}

// -----------------------------
// シミュレーション
// -----------------------------
function simulate(board, piece, move) {
    let newBoard = copyBoard(board);

    let x = move.x;
    let y = 13;

    const [dx, dy] = getOffset(move.rot);

    let px1 = x;
    let py1 = y;
    let px2 = x + dx;
    let py2 = y + dy;

    if (!isInside(px2)) return null;

    while (py1 > 0 && newBoard[py1 - 1][px1] === 0 &&
           py2 > 0 && newBoard[py2 - 1][px2] === 0) {
        py1--;
        py2--;
    }

    newBoard[py1][px1] = piece[1];
    newBoard[py2][px2] = piece[0];

    return resolve(newBoard);
}

// -----------------------------
// 連鎖解決
// -----------------------------
function resolve(board) {
    let chain = 0;
    let totalScore = 0;

    while (true) {
        const groups = findGroups(board);
        if (groups.length === 0) break;

        chain++;

        let erased = 0;

        for (const g of groups) {
            erased += g.length;
            for (const p of g) {
                board[p.y][p.x] = 0;
            }
        }

        totalScore += chain * erased * 10;

        applyGravity(board);
    }

    board._chainScore = totalScore;
    board._chainLength = chain;

    return board;
}

// -----------------------------
// 評価関数（超重要）
// -----------------------------
function evaluate(board) {

    let score = 0;

    // ① 連鎖（最重要）
    score += (board._chainLength || 0) * 5000;

    // ② 連鎖スコア
    score += (board._chainScore || 0);

    // ③ 将来連鎖（疑似 depth-4）
    score += estimateFutureChain(board) * 2000;

    // ④ 高さペナルティ
    score -= getMaxHeight(board) * 30;

    // ⑤ 形状評価（谷型ボーナス）
    score += shapeBonus(board);

    return score;
}

// -----------------------------
// 疑似 depth-4
// -----------------------------
function estimateFutureChain(board) {

    let best = 0;

    for (let color = 1; color <= 4; color++) {

        for (let x = 0; x < 6; x++) {

            let test = copyBoard(board);

            let y = dropY(test, x);
            if (y < 0) continue;

            test[y][x] = color;

            test = resolve(test);

            best = Math.max(best, test._chainLength || 0);
        }
    }

    return best;
}

// -----------------------------
// 形状評価
// -----------------------------
function shapeBonus(board) {

    let score = 0;

    for (let x = 1; x < 5; x++) {
        let h = columnHeight(board, x);
        let hl = columnHeight(board, x - 1);
        let hr = columnHeight(board, x + 1);

        if (h < hl && h < hr) score += 50;
    }

    return score;
}

// -----------------------------
// グループ探索
// -----------------------------
function findGroups(board) {
    let visited = Array(14).fill().map(() => Array(6).fill(false));
    let groups = [];

    for (let y = 0; y < 14; y++) {
        for (let x = 0; x < 6; x++) {
            if (board[y][x] === 0 || visited[y][x]) continue;

            let stack = [{ x, y }];
            let group = [];
            let color = board[y][x];

            visited[y][x] = true;

            while (stack.length) {
                let p = stack.pop();
                group.push(p);

                [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy]) => {
                    let nx = p.x + dx;
                    let ny = p.y + dy;

                    if (nx >= 0 && nx < 6 && ny >= 0 && ny < 14 &&
                        !visited[ny][nx] && board[ny][nx] === color) {

                        visited[ny][nx] = true;
                        stack.push({ x: nx, y: ny });
                    }
                });
            }

            if (group.length >= 4) groups.push(group);
        }
    }

    return groups;
}

// -----------------------------
function applyGravity(board) {
    for (let x = 0; x < 6; x++) {
        let col = [];
        for (let y = 0; y < 14; y++) {
            if (board[y][x] !== 0) col.push(board[y][x]);
        }
        for (let y = 0; y < 14; y++) {
            board[y][x] = y < col.length ? col[y] : 0;
        }
    }
}

// -----------------------------
function dropY(board, x) {
    for (let y = 13; y >= 0; y--) {
        if (board[y][x] === 0) return y;
    }
    return -1;
}

// -----------------------------
function columnHeight(board, x) {
    for (let y = 13; y >= 0; y--) {
        if (board[y][x] !== 0) return y + 1;
    }
    return 0;
}

// -----------------------------
function getMaxHeight(board) {
    let max = 0;
    for (let x = 0; x < 6; x++) {
        max = Math.max(max, columnHeight(board, x));
    }
    return max;
}

// -----------------------------
function getOffset(rot) {
    if (rot === 0) return [0, 1];
    if (rot === 1) return [-1, 0];
    if (rot === 2) return [0, -1];
    return [1, 0];
}

// -----------------------------
function isInside(x) {
    return x >= 0 && x < 6;
}

// -----------------------------
function copyBoard(b) {
    return b.map(row => row.slice());
}