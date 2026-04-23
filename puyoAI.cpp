#include <emscripten/emscripten.h>

#include <array>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <vector>

static constexpr int W = 6;
static constexpr int H = 14;
static constexpr int N = W * H;

static constexpr int EMPTY   = 0;
static constexpr int RED     = 1;
static constexpr int BLUE    = 2;
static constexpr int GREEN   = 3;
static constexpr int YELLOW  = 4;
static constexpr int GARBAGE = 5;

static constexpr int DANGER_X = 2;
static constexpr int DANGER_Y = 11; // 左から3列目 / 下から12段目
static constexpr int ALL_CLEAR_BONUS = 2100;

using Board = std::array<int, N>;

struct Piece {
    int subColor;
    int mainColor;
};

struct Move {
    int x = 2;
    int y = 12;
    int rot = 0;
};

struct Pos {
    int x;
    int y;
};

struct Group {
    int color;
    std::vector<Pos> cells;
};

struct ResolvedBoard {
    Board board{};
    int chains = 0;
    int rawScore = 0;
    int attack = 0;
    bool allClear = false;
};

struct Candidate {
    Move move;
    ResolvedBoard sim;
    double quickScore = 0.0;
};

static inline int idx(int x, int y) {
    return y * W + x;
}

static inline int get(const Board& b, int x, int y) {
    return b[idx(x, y)];
}

static inline int& get(Board& b, int x, int y) {
    return b[idx(x, y)];
}

static inline bool inBounds(int x, int y) {
    return x >= 0 && x < W && y >= 0 && y < H;
}

static std::array<Pos, 2> pieceCells(const Piece& p, int x, int y, int rot) {
    Pos main{ x, y };
    Pos sub{ x, y };

    if (rot == 0) sub = { x, y + 1 };
    else if (rot == 1) sub = { x - 1, y };
    else if (rot == 2) sub = { x, y - 1 };
    else sub = { x + 1, y };

    return { main, sub };
}

static bool canPlace(const Board& b, const Piece& p, int x, int y, int rot) {
    auto cells = pieceCells(p, x, y, rot);
    for (const auto& c : cells) {
        if (!inBounds(c.x, c.y)) return false;
        if (get(b, c.x, c.y) != EMPTY) return false;
    }
    return true;
}

static int findRestY(const Board& b, const Piece& p, int x, int rot) {
    // 盤面は y=0 が下。操作ぷよの主ぷよは最大で y=12 を想定。
    for (int y = H - 2; y >= 0; --y) {
        if (!canPlace(b, p, x, y, rot)) continue;
        if (y == 0 || !canPlace(b, p, x, y - 1, rot)) return y;
    }
    return -1;
}

static void applyGravity(Board& b) {
    for (int x = 0; x < W; ++x) {
        std::vector<int> col;
        col.reserve(H);

        for (int y = 0; y < H; ++y) {
            int v = get(b, x, y);
            if (v != EMPTY) col.push_back(v);
        }

        for (int y = 0; y < H; ++y) {
            get(b, x, y) = (y < static_cast<int>(col.size())) ? col[y] : EMPTY;
        }
    }
}

static std::vector<Group> findGroups(const Board& b) {
    std::array<std::array<bool, W>, H> visited{};
    std::vector<Group> groups;

    for (int y = 0; y < H; ++y) {
        for (int x = 0; x < W; ++x) {
            const int color = get(b, x, y);
            if (color == EMPTY || color == GARBAGE || visited[y][x]) continue;

            std::vector<Pos> stack;
            stack.push_back({x, y});
            visited[y][x] = true;

            Group g;
            g.color = color;

            while (!stack.empty()) {
                Pos cur = stack.back();
                stack.pop_back();
                g.cells.push_back(cur);

                const Pos dirs[4] = { {1,0}, {-1,0}, {0,1}, {0,-1} };
                for (const auto& d : dirs) {
                    const int nx = cur.x + d.x;
                    const int ny = cur.y + d.y;
                    if (!inBounds(nx, ny)) continue;
                    if (visited[ny][nx]) continue;
                    if (get(b, nx, ny) != color) continue;

                    visited[ny][nx] = true;
                    stack.push_back({nx, ny});
                }
            }

            if (static_cast<int>(g.cells.size()) >= 4) groups.push_back(std::move(g));
        }
    }

    return groups;
}

static std::vector<Group> findLooseGroups(const Board& b) {
    std::array<std::array<bool, W>, H> visited{};
    std::vector<Group> groups;

    for (int y = 0; y < H; ++y) {
        for (int x = 0; x < W; ++x) {
            const int color = get(b, x, y);
            if (color == EMPTY || color == GARBAGE || visited[y][x]) continue;

            std::vector<Pos> stack;
            stack.push_back({x, y});
            visited[y][x] = true;

            Group g;
            g.color = color;

            while (!stack.empty()) {
                Pos cur = stack.back();
                stack.pop_back();
                g.cells.push_back(cur);

                const Pos dirs[4] = { {1,0}, {-1,0}, {0,1}, {0,-1} };
                for (const auto& d : dirs) {
                    const int nx = cur.x + d.x;
                    const int ny = cur.y + d.y;
                    if (!inBounds(nx, ny)) continue;
                    if (visited[ny][nx]) continue;
                    if (get(b, nx, ny) != color) continue;

                    visited[ny][nx] = true;
                    stack.push_back({nx, ny});
                }
            }

            groups.push_back(std::move(g));
        }
    }

    return groups;
}

static int openNeighborCount(const Board& b, const std::vector<Pos>& cells) {
    std::array<bool, N> seen{};
    int count = 0;

    for (const auto& p : cells) {
        const Pos dirs[4] = { {1,0}, {-1,0}, {0,1}, {0,-1} };
        for (const auto& d : dirs) {
            const int nx = p.x + d.x;
            const int ny = p.y + d.y;
            if (!inBounds(nx, ny)) continue;
            if (get(b, nx, ny) != EMPTY) continue;

            const int k = idx(nx, ny);
            if (!seen[k]) {
                seen[k] = true;
                ++count;
            }
        }
    }

    return count;
}

static void clearGarbageNeighbors(Board& b, const std::vector<Pos>& erased) {
    std::array<bool, N> mark{};

    for (const auto& p : erased) {
        const Pos dirs[4] = { {1,0}, {-1,0}, {0,1}, {0,-1} };
        for (const auto& d : dirs) {
            const int nx = p.x + d.x;
            const int ny = p.y + d.y;
            if (!inBounds(nx, ny)) continue;
            if (get(b, nx, ny) == GARBAGE) {
                mark[idx(nx, ny)] = true;
            }
        }
    }

    for (int i = 0; i < N; ++i) {
        if (mark[i]) b[i] = EMPTY;
    }
}

static bool isBoardEmpty(const Board& b) {
    for (int i = 0; i < N; ++i) {
        if (b[i] != EMPTY) return false;
    }
    return true;
}

static std::array<int, 6> columnHeights(const Board& b) {
    std::array<int, 6> h{};
    for (int x = 0; x < W; ++x) {
        int hh = 0;
        for (int y = H - 1; y >= 0; --y) {
            if (get(b, x, y) != EMPTY) {
                hh = y + 1;
                break;
            }
        }
        h[x] = hh;
    }
    return h;
}

static int countHoles(const Board& b, const std::array<int, 6>& heights) {
    int holes = 0;
    for (int x = 0; x < W; ++x) {
        for (int y = 0; y < heights[x]; ++y) {
            if (get(b, x, y) == EMPTY) ++holes;
        }
    }
    return holes;
}

static double templateScore(const Board& b) {
    static const std::array<std::array<int, 6>, 6> templates = {
        std::array<int,6>{0,1,2,3,2,1},
        std::array<int,6>{0,1,2,2,1,0},
        std::array<int,6>{2,1,0,0,1,2},
        std::array<int,6>{0,1,2,3,3,3},
        std::array<int,6>{3,3,3,2,1,0},
        std::array<int,6>{1,2,3,3,2,1}
    };

    double best1 = 0.0;
    double best2 = 0.0;
    const auto heights = columnHeights(b);

    for (const auto& tp : templates) {
        int base = std::numeric_limits<int>::max();
        for (int x = 0; x < W; ++x) {
            base = std::min(base, heights[x] - tp[x]);
        }

        double s = 0.0;
        for (int x = 0; x < W; ++x) {
            const int target = base + tp[x];
            const int diff = std::abs(heights[x] - target);
            s += std::max(0, 9 - diff * 3);
        }

        if (s > best1) {
            best2 = best1;
            best1 = s;
        } else if (s > best2) {
            best2 = s;
        }
    }

    return best1 + best2 * 0.5;
}

static double seedScore(const Board& b) {
    double s = 0.0;
    const auto groups = findLooseGroups(b);

    for (const auto& g : groups) {
        const int size = static_cast<int>(g.cells.size());
        if (size == 2) {
            s += 12.0 + openNeighborCount(b, g.cells) * 2.5;
        } else if (size == 3) {
            s += 35.0 + openNeighborCount(b, g.cells) * 4.5;
        } else if (size == 4) {
            s += 18.0;
        } else if (size >= 5) {
            s += std::min(60.0, size * 5.0);
        }
    }

    // 横/縦の3連を少し優遇
    for (int y = 0; y < H; ++y) {
        for (int x = 0; x < W; ++x) {
            const int c = get(b, x, y);
            if (c == EMPTY || c == GARBAGE) continue;

            if (x + 2 < W && get(b, x + 1, y) == c && get(b, x + 2, y) == c) {
                if ((x - 1 >= 0 && get(b, x - 1, y) == EMPTY) ||
                    (x + 3 < W && get(b, x + 3, y) == EMPTY)) {
                    s += 16.0;
                }
            }

            if (y + 2 < H && get(b, x, y + 1) == c && get(b, x, y + 2) == c) {
                if ((y - 1 >= 0 && get(b, x, y - 1) == EMPTY) ||
                    (y + 3 < H && get(b, x, y + 3) == EMPTY)) {
                    s += 16.0;
                }
            }
        }
    }

    return s;
}

static double dangerPenalty(const Board& b) {
    const auto heights = columnHeights(b);
    double penalty = 0.0;

    if (get(b, DANGER_X, DANGER_Y) != EMPTY) {
        penalty += 1000000.0;
    }
    if (heights[DANGER_X] >= DANGER_Y + 1) {
        penalty += 250000.0;
    }
    if (heights[DANGER_X] >= DANGER_Y - 1) {
        penalty += 80000.0;
    }

    for (int y = std::max(0, DANGER_Y - 2); y <= DANGER_Y; ++y) {
        if (get(b, DANGER_X, y) != EMPTY) penalty += 25000.0;
    }

    return penalty;
}

static double evaluateBoard(const Board& b) {
    const auto heights = columnHeights(b);
    const int holes = countHoles(b, heights);
    const int maxH = *std::max_element(heights.begin(), heights.end());

    int bumpiness = 0;
    for (int i = 1; i < W; ++i) {
        bumpiness += std::abs(heights[i] - heights[i - 1]);
    }

    // 色の偏りを少し見る
    std::array<int, 5> counts{};
    for (int i = 0; i < N; ++i) {
        const int v = b[i];
        if (v >= 1 && v <= 4) counts[v]++;
    }

    std::array<int, 4> sortedColors = { counts[1], counts[2], counts[3], counts[4] };
    std::sort(sortedColors.begin(), sortedColors.end(), std::greater<int>());

    double s = 0.0;

    // 未来の連鎖の「種」を強く見る
    s += templateScore(b) * 18.0;
    s += seedScore(b) * 14.0;

    // 盤面の安定性
    s -= holes * 55.0;
    s -= bumpiness * 10.0;
    s -= maxH * 30.0;

    // 危険マス付近の強烈なペナルティ
    s -= dangerPenalty(b);

    // ほぼ天井のときの追加ペナルティ
    if (maxH >= H - 3) s -= 120.0;
    if (maxH >= H - 2) s -= 260.0;

    // 4色を散らしすぎない
    s += (sortedColors[0] + sortedColors[1]) * 0.6;
    s -= (sortedColors[2] + sortedColors[3]) * 0.8;

    return s;
}

static int groupBonus(int size) {
    static const int table[] = {0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12};
    const int idx = std::min(size, static_cast<int>(std::size(table)) - 1);
    return table[idx];
}

static int chainBonus(int chainNo) {
    static const int table[] = {0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512};
    int idx = chainNo - 1; // 1連鎖目で table[0] ではなく table[1] を使うため
    if (idx < 0) idx = 0;
    if (idx >= static_cast<int>(std::size(table))) idx = static_cast<int>(std::size(table)) - 1;
    return table[idx];
}

static int colorBonus(int colorCount) {
    static const int table[] = {0, 0, 3, 6, 12};
    const int idx = std::min(colorCount, static_cast<int>(std::size(table)) - 1);
    return table[idx];
}

static int calculateScore(const std::vector<Group>& groups, int chainNo) {
    int totalPuyos = 0;
    std::array<bool, 5> usedColors{};
    int bonusTotal = 0;

    for (const auto& g : groups) {
        totalPuyos += static_cast<int>(g.cells.size());
        usedColors[g.color] = true;
        bonusTotal += groupBonus(static_cast<int>(g.cells.size()));
    }

    bonusTotal += chainBonus(chainNo);

    int colorCount = 0;
    for (int c = 1; c <= 4; ++c) {
        if (usedColors[c]) ++colorCount;
    }
    bonusTotal += colorBonus(colorCount);

    if (bonusTotal <= 0) bonusTotal = 1;

    // 仕様: X × (A + B + C)
    // X = 10 × 消したぷよの数
    return (10 * totalPuyos) * bonusTotal;
}

static ResolvedBoard resolveBoard(Board b) {
    ResolvedBoard out;
    out.board = b;

    while (true) {
        applyGravity(out.board);
        auto groups = findGroups(out.board);
        if (groups.empty()) break;

        out.chains++;
        const int chainScore = calculateScore(groups, out.chains);
        out.rawScore += chainScore;

        std::vector<Pos> erased;
        for (const auto& g : groups) {
            for (const auto& p : g.cells) {
                get(out.board, p.x, p.y) = EMPTY;
                erased.push_back(p);
            }
        }

        clearGarbageNeighbors(out.board, erased);
    }

    applyGravity(out.board);

    if (isBoardEmpty(out.board)) {
        out.allClear = true;
        out.rawScore += ALL_CLEAR_BONUS;
    }

    out.attack = std::max(0, out.rawScore / 70);
    return out;
}

static ResolvedBoard simulateMove(const Board& b, const Piece& p, const Move& m) {
    Board next = b;
    auto cells = pieceCells(p, m.x, m.y, m.rot);

    // ここに来るのは合法手のみの前提
    for (const auto& c : cells) {
        if (inBounds(c.x, c.y)) {
            get(next, c.x, c.y) = (c.x == m.x && c.y == m.y) ? p.mainColor : p.subColor;
        }
    }

    return resolveBoard(next);
}

static double chainOutcomeValue(const ResolvedBoard& sim) {
    // 長い連鎖をかなり優先しつつ、攻撃量と全消しも少し評価する
    const double chainPart = std::pow(std::max(1, sim.chains), 2.15) * 30000.0;
    const double scorePart = sim.rawScore * 8.0;
    const double attackPart = sim.attack * 1500.0;
    const double acPart = sim.allClear ? 250000.0 : 0.0;
    return chainPart + scorePart + attackPart + acPart;
}

static std::vector<Move> generatePlacements(const Board& b, const Piece& p) {
    std::vector<Move> moves;

    for (int rot = 0; rot < 4; ++rot) {
        for (int x = 0; x < W; ++x) {
            const int y = findRestY(b, p, x, rot);
            if (y < 0) continue;
            moves.push_back({x, y, rot});
        }
    }

    return moves;
}

static double quickScore(const Board& b, const ResolvedBoard& sim) {
    return evaluateBoard(sim.board) * 0.25
         + seedScore(sim.board) * 1.2
         + chainOutcomeValue(sim) * 0.02
         - dangerPenalty(b) * 0.02;
}

struct SearchResult {
    double score = -1e100;
    Move move{};
};

static SearchResult search(const Board& b, const std::array<Piece, 3>& pieces, int depth, const Move& rootMove, bool hasRoot) {
    if (depth >= 3) {
        return { evaluateBoard(b), hasRoot ? rootMove : Move{} };
    }

    const auto placements = generatePlacements(b, pieces[depth]);
    if (placements.empty()) {
        return { -1e100, hasRoot ? rootMove : Move{} };
    }

    std::vector<Candidate> cands;
    cands.reserve(placements.size());

    for (const auto& mv : placements) {
        const auto sim = simulateMove(b, pieces[depth], mv);
        const double q = quickScore(b, sim);
        cands.push_back({ mv, sim, q });
    }

    std::sort(cands.begin(), cands.end(), [](const Candidate& a, const Candidate& b) {
        return a.quickScore > b.quickScore;
    });

    constexpr int BEAM_WIDTH = 12;
    if (static_cast<int>(cands.size()) > BEAM_WIDTH) {
        cands.resize(BEAM_WIDTH);
    }

    SearchResult best;
    for (const auto& c : cands) {
        const Move nextRoot = hasRoot ? rootMove : c.move;

        const double immediate =
            chainOutcomeValue(c.sim) * 1.0 +
            evaluateBoard(c.sim.board) * 0.10;

        SearchResult child = search(c.sim.board, pieces, depth + 1, nextRoot, true);

        const double total = immediate + child.score;
        if (total > best.score) {
            best.score = total;
            best.move = nextRoot;
        }
    }

    return best;
}

static int packMove(const Move& m) {
    // rot (0..3), x (0..5), y (0..13)
    return (m.rot & 0xFF) | ((m.x & 0xFF) << 8) | ((m.y & 0xFF) << 16);
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
int ai_choose_move(const int* boardPtr, const int* piecesPtr) {
    Board b{};
    for (int i = 0; i < N; ++i) {
        b[i] = boardPtr[i];
    }

    std::array<Piece, 3> pieces{};
    pieces[0] = { piecesPtr[0], piecesPtr[1] };
    pieces[1] = { piecesPtr[2], piecesPtr[3] };
    pieces[2] = { piecesPtr[4], piecesPtr[5] };

    SearchResult r = search(b, pieces, 0, Move{2, 12, 0}, false);
    if (r.score <= -1e90) {
        r.move = {2, 12, 0};
    }

    return packMove(r.move);
}

} // extern "C"