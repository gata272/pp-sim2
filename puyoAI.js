/* puyoAI.js
 * GTR opening + beam search AI for Puyo Puyo Simulator
 * - First 4 turns: GTR-focused opening
 * - Opening uses current piece + NEXT1 + NEXT2 + NEXT3
 * - After opening: beam search with future-chain evaluation
 * - Works with the existing puyoSim.js globals
 */
(function () {
    'use strict';

    // ========= Settings =========
    const AI_CONFIG = {
        AUTO_TICK_MS: 120,
        BEAM_WIDTH: 10,
        LEAF_BRANCH_LIMIT: 6,
        VISUALIZE_DELAY_MS: 0,
        OPENING_TURNS: 4
    };

    const MEMO = new Map();

    let autoEnabled = false;
    let autoTimer = null;
    let busy = false;
    let uiInitialized = false;

    let openingTurn = 0;

    // ========= Safe accessors =========
    const getWidth = () => (typeof WIDTH !== 'undefined' ? WIDTH : 6);
    const getHeight = () => (typeof HEIGHT !== 'undefined' ? HEIGHT : 14);
    const getColors = () => (typeof COLORS !== 'undefined' ? COLORS : {
        EMPTY: 0,
        RED: 1,
        BLUE: 2,
        GREEN: 3,
        YELLOW: 4,
        GARBAGE: 5
    });

    function safeBoard() {
        return (typeof board !== 'undefined' && Array.isArray(board)) ? board : null;
    }

    function safeCurrentPuyo() {
        return (typeof currentPuyo !== 'undefined' && currentPuyo) ? currentPuyo : null;
    }

    function safeQueue() {
        if (typeof window.getNextQueue === 'function') {
            const q = window.getNextQueue();
            return Array.isArray(q) ? q : [];
        }
        if (typeof nextQueue !== 'undefined' && Array.isArray(nextQueue)) {
            return nextQueue.map(p => p.slice());
        }
        return [];
    }

    function safeQueueIndex() {
        if (typeof queueIndex !== 'undefined' && Number.isFinite(queueIndex)) return queueIndex;
        return 0;
    }

    function cloneBoard(src) {
        return src.map(row => row.slice());
    }

    function boardToKey(b) {
        return b.map(row => row.join('')).join('|');
    }

    function updateStatus(text) {
        const el = document.getElementById('ai-status');
        if (el) el.textContent = text;
    }

    function updateAutoButton() {
        const btn = document.getElementById('ai-auto-button');
        if (btn) btn.textContent = autoEnabled ? 'AI自動: ON' : 'AI自動: OFF';
    }

    function getUpcomingPieces(count = 4) {
        const cur = safeCurrentPuyo();
        if (!cur) return [];

        const q = safeQueue();
        const idx = safeQueueIndex();

        const pieces = [{ mainColor: cur.mainColor, subColor: cur.subColor }];
        for (let i = 0; i < count - 1; i++) {
            const p = q[idx + i];
            if (Array.isArray(p) && p.length >= 2) {
                pieces.push({ subColor: p[0], mainColor: p[1] });
            }
        }
        return pieces;
    }

    function makeLabelContext(pieces) {
        const colorToLabel = new Map();
        const labelToColor = {};
        const letters = ['A', 'B', 'C', 'D'];
        let next = 0;

        for (const piece of pieces) {
            for (const color of [piece.subColor, piece.mainColor]) {
                if (!colorToLabel.has(color)) {
                    const label = letters[Math.min(next, letters.length - 1)];
                    colorToLabel.set(color, label);
                    labelToColor[label] = color;
                    next++;
                }
            }
        }

        const codes = pieces.map(piece => `${colorToLabel.get(piece.subColor)}${colorToLabel.get(piece.mainColor)}`);
        return { colorToLabel, labelToColor, codes };
    }

    function codeSet(code) {
        return new Set(code.split(''));
    }

    function setEqualsCode(code, letters) {
        const s = codeSet(code);
        if (s.size !== letters.length) return false;
        for (const letter of letters) {
            if (!s.has(letter)) return false;
        }
        return true;
    }

    function hasSameColor(code) {
        return code[0] === code[1];
    }

    function classifyOpening(codes) {
        const c0 = codes[0] || '';
        const c1 = codes[1] || '';
        const s0 = codeSet(c0);
        const s1 = codeSet(c1);

        if (s0.size === 1 && s1.size === 2) {
            if ([...s1].some(v => s0.has(v))) {
                return 'AAAB';
            }
            return 'AABC';
        }

        if (s0.size === 1 && s1.size === 1 && c0 !== c1) {
            return 'AABB';
        }

        if (s0.size === 2 && s1.size === 2) {
            const inter = [...s0].filter(v => s1.has(v));
            if (inter.length === 2) return 'ABAB';
            if (inter.length === 1) return 'ABAC';
        }

        return 'GTR';
    }

    function rotationForLabel(piece, labelToColor, targetLabel, position) {
        const targetColor = labelToColor[targetLabel];
        if (targetColor === undefined) return null;

        const isSub = piece.subColor === targetColor;
        const isMain = piece.mainColor === targetColor;

        if (!isSub && !isMain) return null;

        switch (position) {
            case 'down':
                return isSub ? 2 : 0;
            case 'up':
                return isSub ? 0 : 2;
            case 'left':
                return isSub ? 1 : 3;
            case 'right':
                return isSub ? 3 : 1;
            default:
                return null;
        }
    }

    function addRawCandidate(list, x, rotation, priority = 0) {
        list.push({ x, rotation, priority });
    }

    function addLabelCandidate(list, piece, labelToColor, x, targetLabel, position, priority = 0) {
        const rotation = rotationForLabel(piece, labelToColor, targetLabel, position);
        if (rotation !== null) {
            list.push({ x, rotation, priority });
        }
    }

    function openingBoardScore(boardState) {
        const heights = columnHeights(boardState);
        const holes = countHoles(boardState, heights);
        const maxH = Math.max(...heights);
        const bumpiness = heights.reduce((sum, h, i) => sum + (i > 0 ? Math.abs(h - heights[i - 1]) : 0), 0);

        let s = 0;

        s += templateScore(boardState) * 20;
        s -= holes * 28;
        s -= bumpiness * 12;
        s -= maxH * 40;

        // GTRっぽい左寄せ・低重心を優先
        s += Math.max(0, 6 - heights[0]) * 45;
        s += Math.max(0, 6 - heights[1]) * 28;
        s += Math.max(0, 5 - heights[2]) * 14;

        // 危険列を避ける
        s -= dangerPenalty(boardState) * 0.12;

        return s;
    }

    function sameColorCount(piece) {
        return piece.subColor === piece.mainColor;
    }

    function applyPlacementOnly(boardState, piece, x, y, rotation) {
        const next = placePiece(boardState, piece, x, y, rotation);
        gravityOn(next);
        return next;
    }

    function searchOpening(boardState, pieces, turn, context, rootMove) {
        if (turn >= Math.min(AI_CONFIG.OPENING_TURNS, pieces.length)) {
            return { score: openingBoardScore(boardState), move: rootMove };
        }

        const piece = pieces[turn];
        const pattern = context.pattern;
        const candidates = openingCandidates(pattern, turn, pieces, context);

        if (!candidates.length) {
            return { score: -1e15, move: rootMove };
        }

        let best = { score: -1e15, move: rootMove };

        for (const cand of candidates) {
            const y = findRestY(boardState, piece, cand.x, cand.rotation);
            if (y === null) continue;

            const nextBoard = applyPlacementOnly(boardState, piece, cand.x, y, cand.rotation);
            const nextRoot = rootMove || { x: cand.x, y, rotation: cand.rotation };
            const child = searchOpening(nextBoard, pieces, turn + 1, context, nextRoot);

            if (!child) continue;

            const total = openingBoardScore(nextBoard) + child.score + (cand.priority || 0);
            if (total > best.score) {
                best = { score: total, move: child.move };
            }
        }

        return best;
    }

    function openingCandidates(pattern, turn, pieces, context) {
        const list = [];
        const codes = context.codes;
        const piece = pieces[turn];
        const labelToColor = context.labelToColor;

        const c0 = codes[0] || '';
        const c1 = codes[1] || '';
        const c2 = codes[2] || '';
        const c3 = codes[3] || '';

        const s0 = codeSet(c0);
        const s1 = codeSet(c1);
        const s2 = codeSet(c2);
        const s3 = codeSet(c3);

        // ---- AAAB ----
        if (pattern === 'AAAB') {
            const A = [...s0][0];
            const B = [...s1].find(v => !s0.has(v)) || [...s1][0];

            if (turn === 0) {
                addRawCandidate(list, 0, 3, 1000); // 1,2 横
            } else if (turn === 1) {
                addLabelCandidate(list, piece, labelToColor, 2, B, 'down', 1000); // 3列目 B下
            } else if (turn === 2) {
                if (hasSameColor(c2) && c2[0] === A) {
                    addRawCandidate(list, 3, 3, 1000); // AA -> 4,5 横
                }
                if (setEqualsCode(c2, [A, B])) {
                    addLabelCandidate(list, piece, labelToColor, 3, A, 'down', 1000); // AB -> A下
                }
                if (setEqualsCode(c2, [A, 'C'])) {
                    addLabelCandidate(list, piece, labelToColor, 1, 'C', 'down', 1000); // AC -> C下
                }
                if (hasSameColor(c2) && c2[0] === B) {
                    addRawCandidate(list, 3, 0, 1000); // BB -> 4列目縦
                }
                if (setEqualsCode(c2, [B, 'C'])) {
                    addLabelCandidate(list, piece, labelToColor, 3, 'C', 'down', 1000); // BC -> C下
                }
                if (hasSameColor(c2) && c2[0] === 'C') {
                    addRawCandidate(list, 0, 3, 1000); // CC -> 1,2 横
                }
                if (setEqualsCode(c2, ['C', 'D'])) {
                    addRawCandidate(list, 4, 3, 800); // CD -> 5,6 横
                    addRawCandidate(list, 5, 0, 750); // or 6列目縦
                }
            } else if (turn === 3) {
                // 4手目の具体分岐
                if (setEqualsCode(c2, ['C', 'D'])) {
                    if (hasSameColor(c3) && c3[0] === 'C') {
                        addLabelCandidate(list, piece, labelToColor, 5, 'C', 'up', 1000);   // 6列目縦、C上
                        addRawCandidate(list, 3, 3, 950);                                     // 4,5横
                    } else if (setEqualsCode(c3, ['B', 'C'])) {
                        addLabelCandidate(list, piece, labelToColor, 4, 'C', 'left', 1000);  // 5,6横、C左
                    } else {
                        addRawCandidate(list, 3, 3, 800);
                        addRawCandidate(list, 4, 3, 780);
                        addRawCandidate(list, 5, 0, 760);
                    }
                } else {
                    addRawCandidate(list, 3, 3, 700);
                    addRawCandidate(list, 4, 3, 680);
                    addRawCandidate(list, 5, 0, 660);
                }
            }
        }

        // ---- AABB ----
        else if (pattern === 'AABB') {
            const A = [...s0][0];
            const B = [...s1][0];

            if (turn === 0) {
                addRawCandidate(list, 0, 3, 1000); // AA -> 1,2 横
            } else if (turn === 1) {
                addRawCandidate(list, 0, 3, 1000); // BB -> 1,2 横
            } else if (turn === 2) {
                if (hasSameColor(c2) && c2[0] === A) {
                    addRawCandidate(list, 3, 3, 1000); // AA -> 4,5 横
                }
                if (setEqualsCode(c2, [A, B])) {
                    addLabelCandidate(list, piece, labelToColor, 0, A, 'right', 1000); // AB -> A右
                }
                if (setEqualsCode(c2, [A, 'C'])) {
                    addLabelCandidate(list, piece, labelToColor, 2, 'C', 'down', 1000); // AC -> C下
                }
                if (hasSameColor(c2) && c2[0] === B) {
                    addRawCandidate(list, 3, 3, 1000); // BB -> 4,5 横
                }
                if (setEqualsCode(c2, [B, 'C'])) {
                    addLabelCandidate(list, piece, labelToColor, 0, B, 'down', 1000); // BC -> B下
                }
                if (hasSameColor(c2) && c2[0] === 'C') {
                    addRawCandidate(list, 3, 3, 1000); // CC -> 4,5 横
                }
                if (setEqualsCode(c2, ['C', 'D'])) {
                    addRawCandidate(list, 2, 3, 900); // 3,4 横
                    addRawCandidate(list, 5, 0, 880); // 6列目縦
                }
            } else if (turn === 3) {
                if (setEqualsCode(c2, ['C', 'D'])) {
                    if (setEqualsCode(c3, [B, 'C'])) {
                        addRawCandidate(list, 2, 3, 1000); // 3手目CD -> 3,4 横
                        addRawCandidate(list, 4, 3, 980);  // 4手目BC -> 5,6 横
                    } else if (setEqualsCode(c3, ['C', 'D'])) {
                        addRawCandidate(list, 2, 3, 1000); // 3手目CD -> 3,4 横
                        addRawCandidate(list, 1, 2, 980);  // 4手目CD -> 2列目縦
                    } else if (hasSameColor(c3) && c3[0] === 'C') {
                        addRawCandidate(list, 5, 2, 1000); // 3手目CD -> C下で6列目縦
                        addRawCandidate(list, 3, 3, 980);  // 4手目CC -> 4,5 横
                    } else {
                        addRawCandidate(list, 4, 3, 850);
                        addRawCandidate(list, 5, 0, 830);
                    }
                } else {
                    addRawCandidate(list, 3, 3, 700);
                    addRawCandidate(list, 4, 3, 680);
                    addRawCandidate(list, 5, 0, 660);
                }
            }
        }

        // ---- ABAB ----
        else if (pattern === 'ABAB') {
            const A = [...s0][0];
            const B = [...s0][1];

            if (turn === 0) {
                addLabelCandidate(list, piece, labelToColor, 0, A, 'down', 1000); // 1列目 A下
                addLabelCandidate(list, piece, labelToColor, 0, B, 'down', 980);   // 1列目 B下
            } else if (turn === 1) {
                addLabelCandidate(list, piece, labelToColor, 1, A, 'down', 1000); // 2列目 A下
                addLabelCandidate(list, piece, labelToColor, 1, B, 'down', 980);   // 2列目 B下
            } else if (turn === 2) {
                if (hasSameColor(c2) && c2[0] === A) {
                    addRawCandidate(list, 3, 3, 1000); // AA -> 4,5 横
                }
                if (setEqualsCode(c2, [A, B])) {
                    addLabelCandidate(list, piece, labelToColor, 0, A, 'right', 1000); // AB -> A右
                }
                if (setEqualsCode(c2, [A, 'C'])) {
                    addLabelCandidate(list, piece, labelToColor, 2, 'C', 'down', 1000); // AC -> C下
                }
                if (hasSameColor(c2) && c2[0] === B) {
                    addRawCandidate(list, 3, 3, 1000); // BB -> 4,5 横
                }
                if (setEqualsCode(c2, [B, 'C'])) {
                    addLabelCandidate(list, piece, labelToColor, 0, B, 'down', 1000); // BC -> B下
                }
                if (hasSameColor(c2) && c2[0] === 'C') {
                    addRawCandidate(list, 3, 3, 1000); // CC -> 4,5 横
                }
                if (setEqualsCode(c2, ['C', 'D'])) {
                    addRawCandidate(list, 2, 3, 900);
                    addRawCandidate(list, 5, 0, 880);
                }
            } else if (turn === 3) {
                if (setEqualsCode(c2, ['C', 'D'])) {
                    if (setEqualsCode(c3, [B, 'C'])) {
                        addRawCandidate(list, 2, 3, 1000); // 3手目CD -> 3,4 横
                        addRawCandidate(list, 4, 3, 980);  // 4手目BC -> 5,6 横
                    } else if (setEqualsCode(c3, ['C', 'D'])) {
                        addRawCandidate(list, 2, 3, 1000); // 3手目CD -> 3,4 横
                        addRawCandidate(list, 1, 2, 980);  // 4手目CD -> 2列目縦
                    } else if (hasSameColor(c3) && c3[0] === 'C') {
                        addRawCandidate(list, 5, 2, 1000); // 3手目CD -> C下で6列目縦
                        addRawCandidate(list, 3, 3, 980);  // 4手目CC -> 4,5 横
                    } else {
                        addRawCandidate(list, 4, 3, 850);
                        addRawCandidate(list, 5, 0, 830);
                    }
                } else {
                    addRawCandidate(list, 3, 3, 700);
                    addRawCandidate(list, 4, 3, 680);
                    addRawCandidate(list, 5, 0, 660);
                }
            }
        }

        // ---- ABAC ----
        else if (pattern === 'ABAC') {
            const A = [...s0].find(v => s1.has(v)) || [...s0][0];
            const other0 = [...s0].find(v => v !== A);
            const other1 = [...s1].find(v => v !== A);
            const B = other0 || other1 || 'B';
            const C = [...new Set([...s0, ...s1])].find(v => v !== A && v !== B) || 'C';

            if (turn === 0) {
                // 2通り
                addLabelCandidate(list, piece, labelToColor, 1, A, 'left', 1000); // 2,3 横（A左）
                addLabelCandidate(list, piece, labelToColor, 0, A, 'down', 990);  // 1列目縦（A下）
            } else if (turn === 1) {
                // 2手目は初手分岐を包含して幅広く候補化
                addRawCandidate(list, 2, 3, 1000); // 3,4 横
                addRawCandidate(list, 0, 3, 980);   // 1,2 横
                addLabelCandidate(list, piece, labelToColor, 3, B, 'down', 1000);   // B下縦
                addRawCandidate(list, 3, 3, 980);   // 4,5 横
                addLabelCandidate(list, piece, labelToColor, 3, C, 'up', 1000);      // C上縦
                addLabelCandidate(list, piece, labelToColor, 2, A, 'down', 980);     // A下縦
                addLabelCandidate(list, piece, labelToColor, 1, A, 'right', 980);     // A右横
            } else if (turn === 2) {
                if (hasSameColor(c2) && c2[0] === A) {
                    addRawCandidate(list, 2, 3, 1000); // AA -> 3,4 横
                }
                if (setEqualsCode(c2, [A, 'D'])) {
                    addLabelCandidate(list, piece, labelToColor, 2, A, 'left', 1000); // AD -> A左
                }
                if (setEqualsCode(c2, [B, 'C'])) {
                    addLabelCandidate(list, piece, labelToColor, 3, B, 'down', 1000); // BC -> B下
                }
                if (hasSameColor(c2) && c2[0] === 'D') {
                    addRawCandidate(list, 3, 3, 1000); // DD -> 4,5 横
                }
                if (hasSameColor(c2) && c2[0] === 'C') {
                    addRawCandidate(list, 0, 3, 1000); // CC -> 1,2 横
                }
                if (setEqualsCode(c2, [B, 'D'])) {
                    addLabelCandidate(list, piece, labelToColor, 0, B, 'down', 1000); // BD -> B下
                }
                if (setEqualsCode(c2, ['C', 'D'])) {
                    addLabelCandidate(list, piece, labelToColor, 3, 'C', 'up', 1000); // CD -> C上で縦
                }
                if (setEqualsCode(c2, [A, 'C'])) {
                    addLabelCandidate(list, piece, labelToColor, 2, A, 'down', 1000); // AC -> A下
                }
                if (setEqualsCode(c2, [A, B])) {
                    addLabelCandidate(list, piece, labelToColor, 1, A, 'right', 1000); // AB -> A右
                }
                if (hasSameColor(c2) && c2[0] === B) {
                    addRawCandidate(list, 0, 3, 980); // BB -> 1,2 横
                }
            } else if (turn === 3) {
                addRawCandidate(list, 3, 3, 800);
                addRawCandidate(list, 4, 3, 780);
                addRawCandidate(list, 5, 0, 760);
            }
        }

        // ---- AABC ----
        else if (pattern === 'AABC') {
            const A = [...s0][0];

            if (turn === 0) {
                addRawCandidate(list, 0, 3, 1000); // AA -> 1,2 横
            } else if (turn === 1) {
                // 基本形 + 特殊形を幅広く
                addRawCandidate(list, 2, 3, 1000); // BC -> 3,4 横
                addRawCandidate(list, 1, 3, 980);  // 2,3 横（後続依存）
                addRawCandidate(list, 0, 3, 970);  // 1,2 横
                addRawCandidate(list, 3, 3, 960);  // 4,5 横
            } else if (turn === 2) {
                if (setEqualsCode(c2, [A, 'B'])) {
                    addLabelCandidate(list, piece, labelToColor, 4, B, 'left', 1000); // AB -> B左で5,6横
                }
                if (hasSameColor(c2) && c2[0] === 'B') {
                    addRawCandidate(list, 4, 3, 1000); // BB -> 5,6横
                }
                if (setEqualsCode(c2, [A, 'C'])) {
                    addLabelCandidate(list, piece, labelToColor, 4, B, 'down', 1000); // BC -> B下で5列縦
                }
                if (setEqualsCode(c2, [A, 'D'])) {
                    addLabelCandidate(list, piece, labelToColor, 4, B, 'left', 1000); // BD -> B左で5,6横
                }

                // 特殊分岐
                if (hasSameColor(c2) && c2[0] === A) {
                    addRawCandidate(list, 1, 3, 980); // AA -> 2,3横
                }
                if (setEqualsCode(c2, [A, 'D'])) {
                    addRawCandidate(list, 2, 3, 980); // AD -> 2,3横
                }
                if (hasSameColor(c2) && c2[0] === 'D') {
                    addRawCandidate(list, 0, 3, 980); // DD -> 1,2横
                }
            } else if (turn === 3) {
                addRawCandidate(list, 3, 3, 800);
                addRawCandidate(list, 4, 3, 780);
                addRawCandidate(list, 5, 0, 760);
            }
        }

        // ---- GTR fallback ----
        else {
            if (turn === 0) {
                addRawCandidate(list, 0, 3, 1000);
            } else if (turn === 1) {
                addRawCandidate(list, 2, 0, 900);
                addRawCandidate(list, 1, 3, 880);
            } else if (turn === 2) {
                addRawCandidate(list, 3, 3, 800);
                addRawCandidate(list, 4, 3, 780);
                addRawCandidate(list, 5, 0, 760);
            } else {
                addRawCandidate(list, 3, 3, 800);
                addRawCandidate(list, 4, 3, 780);
                addRawCandidate(list, 5, 0, 760);
            }
        }

        return list;
    }

    function chooseOpeningMove() {
        const cur = safeCurrentPuyo();
        const b = safeBoard();
        if (!cur || !b) return null;
        if (openingTurn >= AI_CONFIG.OPENING_TURNS) return null;

        const pieces = getUpcomingPieces(4);
        if (pieces.length < 4) return null;

        const ctx = makeLabelContext(pieces);
        ctx.pattern = classifyOpening(ctx.codes);

        const snapshot = cloneBoard(b);
        const result = searchOpening(snapshot, pieces, 0, ctx, null);
        return result && result.move ? result.move : null;
    }

    // ========= Board simulation =========
    function gravityOn(boardState) {
        const W = getWidth();
        const H = getHeight();
        const C = getColors();

        for (let x = 0; x < W; x++) {
            const col = [];
            for (let y = 0; y < H; y++) {
                if (boardState[y][x] !== C.EMPTY) col.push(boardState[y][x]);
            }
            for (let y = 0; y < H; y++) {
                boardState[y][x] = y < col.length ? col[y] : C.EMPTY;
            }
        }
    }

    function placePiece(boardState, piece, x, y, rotation) {
        const next = cloneBoard(boardState);
        const coords = getPieceCoords(piece, x, y, rotation);

        for (const c of coords) {
            if (c.x >= 0 && c.x < getWidth() && c.y >= 0 && c.y < getHeight()) {
                next[c.y][c.x] = c.color;
            }
        }
        return next;
    }

    function getPieceCoords(piece, x, y, rotation) {
        let sx = x;
        let sy = y;

        if (rotation === 0) sy = y + 1;
        else if (rotation === 1) sx = x - 1;
        else if (rotation === 2) sy = y - 1;
        else if (rotation === 3) sx = x + 1;

        return [
            { x, y, color: piece.mainColor },
            { x: sx, y: sy, color: piece.subColor }
        ];
    }

    function canPlace(boardState, piece, x, y, rotation) {
        const C = getColors();
        const coords = getPieceCoords(piece, x, y, rotation);

        for (const c of coords) {
            if (c.x < 0 || c.x >= getWidth() || c.y < 0 || c.y >= getHeight()) return false;
            if (boardState[c.y][c.x] !== C.EMPTY) return false;
        }
        return true;
    }

    function findRestY(boardState, piece, x, rotation) {
        const H = getHeight();
        let y = H - 2;

        if (!canPlace(boardState, piece, x, y, rotation)) return null;
        while (y > 0 && canPlace(boardState, piece, x, y - 1, rotation)) {
            y--;
        }
        return y;
    }

    function dropPlacements(boardState, piece) {
        const placements = [];
        for (let rot = 0; rot < 4; rot++) {
            for (let x = 0; x < getWidth(); x++) {
                const y = findRestY(boardState, piece, x, rot);
                if (y !== null) placements.push({ x, y, rotation: rot });
            }
        }
        return placements;
    }

    function findGroups(boardState) {
        const W = getWidth();
        const H = getHeight();
        const C = getColors();
        const visited = Array.from({ length: H }, () => Array(W).fill(false));
        const groups = [];

        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const color = boardState[y][x];
                if (color === C.EMPTY || color === C.GARBAGE || visited[y][x]) continue;

                const stack = [{ x, y }];
                visited[y][x] = true;
                const group = [];

                while (stack.length) {
                    const cur = stack.pop();
                    group.push(cur);

                    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
                    for (const [dx, dy] of dirs) {
                        const nx = cur.x + dx;
                        const ny = cur.y + dy;
                        if (
                            nx >= 0 && nx < W &&
                            ny >= 0 && ny < H &&
                            !visited[ny][nx] &&
                            boardState[ny][nx] === color
                        ) {
                            visited[ny][nx] = true;
                            stack.push({ x: nx, y: ny });
                        }
                    }
                }

                if (group.length >= 4) groups.push({ color, group });
            }
        }

        return groups;
    }

    function clearGarbageNeighbors(boardState, erasedCoords) {
        const W = getWidth();
        const H = getHeight();
        const C = getColors();
        const toClear = new Set();

        for (const { x, y } of erasedCoords) {
            const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
            for (const [dx, dy] of dirs) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
                    if (boardState[ny][nx] === C.GARBAGE) toClear.add(`${nx},${ny}`);
                }
            }
        }

        for (const key of toClear) {
            const [x, y] = key.split(',').map(Number);
            boardState[y][x] = C.EMPTY;
        }
    }

    function isBoardEmpty(boardState) {
        const C = getColors();
        for (let y = 0; y < getHeight(); y++) {
            for (let x = 0; x < getWidth(); x++) {
                if (boardState[y][x] !== C.EMPTY) return false;
            }
        }
        return true;
    }

    function groupBonus(size) {
        const table = (typeof BONUS_TABLE !== 'undefined' && BONUS_TABLE.GROUP)
            ? BONUS_TABLE.GROUP
            : [0,0,0,0,0,2,3,4,5,6,7,8,9,10,11,12];
        return table[Math.min(size, table.length - 1)] || 0;
    }

    function chainBonus(chainNo) {
        const table = (typeof BONUS_TABLE !== 'undefined' && BONUS_TABLE.CHAIN)
            ? BONUS_TABLE.CHAIN
            : [0,8,16,32,64,96,128,160,192,224,256,288,320,352,384,416,448,480,512];
        const idx = Math.max(0, Math.min(chainNo - 1, table.length - 1));
        return table[idx] || 0;
    }

    function colorBonus(colorCount) {
        const table = (typeof BONUS_TABLE !== 'undefined' && BONUS_TABLE.COLOR)
            ? BONUS_TABLE.COLOR
            : [0,0,3,6,12];
        return table[Math.min(colorCount, table.length - 1)] || 0;
    }

    function calculateScore(groups, chainNo) {
        let totalPuyos = 0;
        const colorSet = new Set();
        let bonusTotal = 0;

        for (const { color, group } of groups) {
            totalPuyos += group.length;
            colorSet.add(color);
            bonusTotal += groupBonus(group.length);
        }

        bonusTotal += chainBonus(chainNo);
        bonusTotal += colorBonus(colorSet.size);

        if (bonusTotal <= 0) bonusTotal = 1;
        return 10 * totalPuyos * bonusTotal;
    }

    function resolveBoard(boardState) {
        const C = getColors();
        const scoreFn = (typeof scoreToOjama === 'function')
            ? scoreToOjama
            : (v) => Math.floor(Math.max(0, v) / 70);

        const acBonus = (typeof ALL_CLEAR_SCORE_BONUS !== 'undefined')
            ? ALL_CLEAR_SCORE_BONUS
            : 2100;

        let totalChains = 0;
        let totalScore = 0;
        let totalAttack = 0;

        while (true) {
            gravityOn(boardState);
            const groups = findGroups(boardState);
            if (groups.length === 0) break;

            totalChains++;
            const chainScore = calculateScore(groups, totalChains);
            totalScore += chainScore;
            totalAttack += scoreFn(chainScore);

            const erased = [];
            for (const { group } of groups) {
                for (const p of group) {
                    boardState[p.y][p.x] = C.EMPTY;
                    erased.push(p);
                }
            }
            clearGarbageNeighbors(boardState, erased);
        }

        gravityOn(boardState);

        let allClear = false;
        if (isBoardEmpty(boardState)) {
            allClear = true;
            totalScore += acBonus;
            totalAttack += scoreFn(acBonus);
        }

        return {
            board: boardState,
            chains: totalChains,
            score: totalScore,
            attack: totalAttack,
            allClear
        };
    }

    function simulateMove(boardState, piece, x, y, rotation) {
        const placed = placePiece(boardState, piece, x, y, rotation);
        return resolveBoard(placed);
    }

    // ========= Evaluation =========
    function columnHeights(boardState) {
        const W = getWidth();
        const H = getHeight();
        const C = getColors();
        const heights = Array(W).fill(0);

        for (let x = 0; x < W; x++) {
            let h = 0;
            for (let y = H - 1; y >= 0; y--) {
                if (boardState[y][x] !== C.EMPTY) {
                    h = y + 1;
                    break;
                }
            }
            heights[x] = h;
        }
        return heights;
    }

    function countHoles(boardState, heights) {
        const C = getColors();
        let holes = 0;

        for (let x = 0; x < getWidth(); x++) {
            for (let y = 0; y < heights[x]; y++) {
                if (boardState[y][x] === C.EMPTY) holes++;
            }
        }
        return holes;
    }

    function openNeighborCount(boardState, cells) {
        const W = getWidth();
        const H = getHeight();
        const C = getColors();
        const seen = new Set();
        let count = 0;

        for (const { x, y } of cells) {
            const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
            for (const [dx, dy] of dirs) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < W && ny >= 0 && ny < H && boardState[ny][nx] === C.EMPTY) {
                    const k = `${nx},${ny}`;
                    if (!seen.has(k)) {
                        seen.add(k);
                        count++;
                    }
                }
            }
        }
        return count;
    }

    function findGroupsLoose(boardState) {
        const W = getWidth();
        const H = getHeight();
        const C = getColors();
        const visited = Array.from({ length: H }, () => Array(W).fill(false));
        const out = [];

        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const color = boardState[y][x];
                if (color === C.EMPTY || color === C.GARBAGE || visited[y][x]) continue;

                const stack = [{ x, y }];
                visited[y][x] = true;
                const cells = [];

                while (stack.length) {
                    const cur = stack.pop();
                    cells.push(cur);

                    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
                    for (const [dx, dy] of dirs) {
                        const nx = cur.x + dx;
                        const ny = cur.y + dy;
                        if (
                            nx >= 0 && nx < W &&
                            ny >= 0 && ny < H &&
                            !visited[ny][nx] &&
                            boardState[ny][nx] === color
                        ) {
                            visited[ny][nx] = true;
                            stack.push({ x: nx, y: ny });
                        }
                    }
                }

                out.push({ color, cells });
            }
        }

        return out;
    }

    function dangerPenalty(boardState) {
        const C = getColors();
        const heights = columnHeights(boardState);
        let penalty = 0;
        const x = 2;
        const y = 11;

        if (boardState[y] && boardState[y][x] !== C.EMPTY) penalty += 1000000;
        if (heights[x] >= y + 1) penalty += 250000;
        if (heights[x] >= y - 1) penalty += 80000;

        for (let yy = Math.max(0, y - 2); yy <= y; yy++) {
            if (boardState[yy] && boardState[yy][x] !== C.EMPTY) penalty += 25000;
        }

        return penalty;
    }

    const TEMPLATE_LIBRARY = [
        { name: 'left_stair',   mask: [1, 1, 1, 1, 0, 0], profile: [0, 1, 2, 3, 0, 0], weight: 1.00 },
        { name: 'right_stair',  mask: [0, 0, 1, 1, 1, 1], profile: [0, 0, 3, 2, 1, 0], weight: 1.00 },
        { name: 'left_gtr',     mask: [1, 1, 1, 1, 1, 0], profile: [0, 1, 2, 2, 1, 0], weight: 1.25 },
        { name: 'right_gtr',    mask: [0, 1, 1, 1, 1, 1], profile: [0, 1, 2, 2, 1, 0], weight: 1.25 },
        { name: 'valley',       mask: [1, 1, 1, 1, 1, 1], profile: [2, 1, 0, 0, 1, 2], weight: 1.10 },
        { name: 'center_tower', mask: [0, 1, 1, 1, 1, 0], profile: [0, 1, 2, 3, 2, 1], weight: 1.05 },
        { name: 'bridge',       mask: [1, 1, 1, 1, 1, 1], profile: [1, 2, 1, 1, 2, 1], weight: 0.95 }
    ];

    function templateScore(boardState) {
        const heights = columnHeights(boardState);
        let best1 = 0;
        let best2 = 0;

        for (const t of TEMPLATE_LIBRARY) {
            const masked = [];
            for (let x = 0; x < getWidth(); x++) {
                if (t.mask[x]) masked.push(x);
            }
            if (!masked.length) continue;

            let base = Infinity;
            for (const x of masked) {
                base = Math.min(base, heights[x] - t.profile[x]);
            }
            if (!Number.isFinite(base)) continue;

            let s = 0;
            let occupied = 0;
            for (const x of masked) {
                const target = base + t.profile[x];
                const diff = Math.abs(heights[x] - target);
                s += Math.max(0, 8 - diff * 3);
                if (heights[x] > 0) occupied++;
            }

            s += occupied * 2;
            s *= t.weight;

            if (s > best1) {
                best2 = best1;
                best1 = s;
            } else if (s > best2) {
                best2 = s;
            }
        }

        return best1 + best2 * 0.5;
    }

    function seedScore(boardState) {
        const groups = findGroupsLoose(boardState);
        let s = 0;

        for (const g of groups) {
            const size = g.cells.length;
            if (size === 1) s += 1;
            else if (size === 2) s += 12 + openNeighborCount(boardState, g.cells) * 2;
            else if (size === 3) s += 35 + openNeighborCount(boardState, g.cells) * 4;
        }

        const W = getWidth();
        const H = getHeight();
        const C = getColors();

        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const c = boardState[y][x];
                if (c === C.EMPTY || c === C.GARBAGE) continue;

                if (x + 2 < W && boardState[y][x + 1] === c && boardState[y][x + 2] === c) {
                    if ((x - 1 >= 0 && boardState[y][x - 1] === C.EMPTY) ||
                        (x + 3 < W && boardState[y][x + 3] === C.EMPTY)) {
                        s += 16;
                    }
                }

                if (y + 2 < H && boardState[y + 1][x] === c && boardState[y + 2][x] === c) {
                    if ((y - 1 >= 0 && boardState[y - 1][x] === C.EMPTY) ||
                        (y + 3 < H && boardState[y + 3][x] === C.EMPTY)) {
                        s += 16;
                    }
                }

                if (x + 1 < W && y + 1 < H) {
                    if (boardState[y][x] === c && boardState[y][x + 1] === c && boardState[y + 1][x] === c) {
                        s += 20;
                    }
                }
            }
        }

        return s;
    }

    function evaluateBoard(boardState) {
        const heights = columnHeights(boardState);
        const holes = countHoles(boardState, heights);
        const maxH = Math.max(...heights);
        const bumpiness = heights.reduce((sum, h, i) => sum + (i > 0 ? Math.abs(h - heights[i - 1]) : 0), 0);

        let s = 0;

        s += templateScore(boardState) * 18;
        s += seedScore(boardState) * 10;

        const comps = findGroupsLoose(boardState);
        for (const g of comps) {
            const size = g.cells.length;
            if (size === 2) s += 10;
            else if (size === 3) s += 30 + openNeighborCount(boardState, g.cells) * 3;
            else if (size >= 5) s += Math.min(80, size * 8);
        }

        s -= holes * 38;
        s -= bumpiness * 10;
        s -= maxH * 30;
        s -= dangerPenalty(boardState);

        if (maxH >= getHeight() - 3) s -= 120;
        if (maxH >= getHeight() - 2) s -= 260;

        const counts = [0, 0, 0, 0, 0];
        for (let y = 0; y < getHeight(); y++) {
            for (let x = 0; x < getWidth(); x++) {
                const v = boardState[y][x];
                if (v >= 1 && v <= 4) counts[v]++;
            }
        }

        const sorted = counts.slice(1).sort((a, b) => b - a);
        s += (sorted[0] + sorted[1]) * 0.6;
        s -= (sorted[2] + sorted[3]) * 0.8;

        return s;
    }

    function chainOutcomeValue(sim) {
        const chainPart = Math.pow(sim.chains, 2.1) * 35000;
        const scorePart = sim.score * 8;
        const attackPart = sim.attack * 1800;
        const allClearPart = sim.allClear ? 250000 : 0;
        return chainPart + scorePart + attackPart + allClearPart;
    }

    function quickPlacementValue(boardState, sim) {
        return evaluateBoard(boardState) + chainOutcomeValue(sim) * 0.01;
    }

    function leafPseudoDepth(boardState) {
        let best = evaluateBoard(boardState);

        const allPlays = [];
        for (const color of [1, 2, 3, 4]) {
            const dummy = { mainColor: color, subColor: color };
            const placements = dropPlacements(boardState, dummy);

            for (const p of placements) {
                const sim = simulateMove(boardState, dummy, p.x, p.y, p.rotation);
                const value = sim.chains > 0
                    ? chainOutcomeValue(sim) + evaluateBoard(sim.board) * 0.1
                    : evaluateBoard(sim.board) + seedScore(sim.board) * 3;

                allPlays.push({ value, sim });
            }
        }

        allPlays.sort((a, b) => b.value - a.value);

        const limit = Math.min(AI_CONFIG.LEAF_BRANCH_LIMIT, allPlays.length);
        for (let i = 0; i < limit; i++) {
            const node = allPlays[i];
            let v = node.value;
            if (node.sim.chains === 0) v += evaluateBoard(node.sim.board) * 0.3;
            if (v > best) best = v;
        }

        return best;
    }

    function searchBest(boardState, pieces, depth, memo, rootMove) {
        const key = `${depth}|${boardToKey(boardState)}|${pieces.map(p => `${p.mainColor}${p.subColor}`).join(',')}`;
        if (memo.has(key)) return memo.get(key);

        if (depth >= pieces.length) {
            const score = leafPseudoDepth(boardState);
            const ret = { score, move: rootMove || null };
            memo.set(key, ret);
            return ret;
        }

        const piece = pieces[depth];
        const placements = dropPlacements(boardState, piece);
        if (!placements.length) {
            const ret = { score: -1e15, move: rootMove || null };
            memo.set(key, ret);
            return ret;
        }

        const candidates = [];
        for (const p of placements) {
            const sim = simulateMove(boardState, piece, p.x, p.y, p.rotation);
            const quick = quickPlacementValue(sim.board, sim);
            candidates.push({ ...p, sim, quick });
        }

        candidates.sort((a, b) => b.quick - a.quick);
        const beam = candidates.slice(0, AI_CONFIG.BEAM_WIDTH);

        let best = { score: -1e15, move: rootMove || null };

        for (const c of beam) {
            const moveHere = depth === 0 ? { x: c.x, y: c.y, rotation: c.rotation } : rootMove;

            let total;
            if (c.sim.chains > 0) {
                total = chainOutcomeValue(c.sim) + evaluateBoard(c.sim.board) * 0.1;
            } else if (depth + 1 >= pieces.length) {
                total = evaluateBoard(c.sim.board) * 0.25 + leafPseudoDepth(c.sim.board);
            } else {
                const child = searchBest(c.sim.board, pieces, depth + 1, memo, moveHere);
                total = evaluateBoard(c.sim.board) * 0.25 + child.score;
            }

            if (total > best.score) {
                best = { score: total, move: moveHere };
            }
        }

        memo.set(key, best);
        return best;
    }

    function chooseBestMove() {
        const cur = safeCurrentPuyo();
        const b = safeBoard();
        if (!cur || !b) return null;
        if (typeof gameState !== 'undefined' && gameState !== 'playing') return null;

        // 最初の4手はGTR優先
        if (openingTurn < AI_CONFIG.OPENING_TURNS) {
            const openingMove = chooseOpeningMove();
            if (openingMove) return openingMove;
        }

        const pieces = getUpcomingPieces(3);
        if (!pieces.length) return null;

        MEMO.clear();
        const snapshot = cloneBoard(b);
        const result = searchBest(snapshot, pieces, 0, MEMO, null);
        return result.move;
    }

    function applyMove(move) {
        const cur = safeCurrentPuyo();
        if (!cur || !move) return false;

        cur.mainX = move.x;
        cur.mainY = move.y;
        cur.rotation = move.rotation;

        if (typeof renderBoard === 'function') renderBoard();
        return true;
    }

    function doAI() {
        if (busy) return;

        if (typeof gameState !== 'undefined' && gameState !== 'playing') {
            updateStatus('AI待機中');
            return;
        }

        const cur = safeCurrentPuyo();
        if (!cur) {
            updateStatus('AI待機中');
            return;
        }

        busy = true;
        try {
            updateStatus('AI思考中...');

            const move = chooseBestMove();
            if (!move) {
                updateStatus('手が見つかりません');
                busy = false;
                return;
            }

            applyMove(move);

            const finish = () => {
                if (typeof hardDrop === 'function') hardDrop();
                if (openingTurn < AI_CONFIG.OPENING_TURNS) openingTurn++;
                updateStatus('AI実行完了');
                busy = false;
            };

            if (AI_CONFIG.VISUALIZE_DELAY_MS > 0) {
                setTimeout(finish, AI_CONFIG.VISUALIZE_DELAY_MS);
            } else {
                finish();
            }
        } catch (err) {
            console.error('AI error:', err);
            updateStatus('AIエラー');
            busy = false;
        }
    }

    function tickAuto() {
        if (!autoEnabled || busy) return;
        if (typeof gameState !== 'undefined' && gameState !== 'playing') {
            updateStatus('AI待機中');
            return;
        }
        if (!safeCurrentPuyo()) {
            updateStatus('AI待機中');
            return;
        }
        doAI();
    }

    function startAutoLoop() {
        stopAutoLoop();
        autoTimer = setInterval(tickAuto, AI_CONFIG.AUTO_TICK_MS);
    }

    function stopAutoLoop() {
        if (autoTimer) {
            clearInterval(autoTimer);
            autoTimer = null;
        }
    }

    function resetAIState() {
        openingTurn = 0;
        MEMO.clear();
        busy = false;
        updateStatus('AI待機中');
        updateAutoButton();
    }

    function initAIUI() {
        if (uiInitialized) return;
        uiInitialized = true;
        updateAutoButton();
        updateStatus('AI待機中');
    }

    // ========= Public API =========
    window.runPuyoAI = function () {
        doAI();
    };

    window.toggleAIAuto = function () {
        autoEnabled = !autoEnabled;
        updateAutoButton();

        if (autoEnabled) {
            updateStatus('AI自動起動');
            startAutoLoop();
            tickAuto();
        } else {
            stopAutoLoop();
            updateStatus('AI待機中');
        }
    };

    window.PuyoAI = {
        chooseBestMove,
        chooseOpeningMove,
        evaluateBoard,
        resolveBoard,
        searchBest,
        templateScore,
        seedScore,
        resetAIState
    };

    // ========= Hook reset / rematch =========
    const prevResetGame = window.resetGame;
    window.resetGame = function () {
        if (typeof prevResetGame === 'function') prevResetGame();
        resetAIState();
    };

    if (typeof window.prepareForRematch === 'function') {
        const prevPrepare = window.prepareForRematch;
        window.prepareForRematch = function () {
            if (typeof prevPrepare === 'function') prevPrepare();
            resetAIState();
        };
    }

    // ========= Init =========
    function boot() {
        initAIUI();
        if (autoEnabled) startAutoLoop();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();