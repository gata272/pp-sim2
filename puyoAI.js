/* puyoAI.js
 * Worker-based Puyo AI
 * - current piece + NEXT1 + NEXT2 exact search
 * - beam search + pseudo leaf rollout
 * - GTR / key-stack / fron / stair / valley template scoring
 * - Worker snapshot uses transferable ArrayBuffers
 */
(function () {
    'use strict';

    const AI_CONFIG = {
        WORKER_URL: 'puyoAI.worker.js',
        AUTO_TICK_MS: 140,
        THINK_TIMEOUT_MS: 12000
    };

    const AI_STATE = {
        worker: null,
        ready: false,
        readyPromise: null,
        readyResolve: null,
        readyReject: null,
        busy: false,
        autoEnabled: false,
        autoTimer: null,
        jobSeq: 0,
        pendingJobs: new Map(),
        booted: false
    };

    const getWidth = () => (typeof WIDTH !== 'undefined' ? WIDTH : 6);
    const getHeight = () => (typeof HEIGHT !== 'undefined' ? HEIGHT : 14);
    const getHiddenRows = () => (typeof HIDDEN_ROWS !== 'undefined' ? HIDDEN_ROWS : 2);

    function updateStatus(text) {
        const el = document.getElementById('ai-status');
        if (el) el.textContent = text;
    }

    function updateAutoButton() {
        const btn = document.getElementById('ai-auto-button');
        if (btn) btn.textContent = AI_STATE.autoEnabled ? 'AI自動: ON' : 'AI自動: OFF';
    }

    function getGameState() {
        return typeof gameState !== 'undefined' ? gameState : 'playing';
    }

    function getCurrentPuyo() {
        if (typeof currentPuyo === 'undefined' || !currentPuyo) return null;
        return currentPuyo;
    }

    function getQueueArray() {
        if (typeof window.getNextQueue === 'function') {
            const q = window.getNextQueue();
            return Array.isArray(q) ? q : [];
        }
        if (typeof nextQueue !== 'undefined' && Array.isArray(nextQueue)) {
            return nextQueue.map(pair => Array.isArray(pair) ? pair.slice() : [0, 0]);
        }
        return [];
    }

    function getQueueIndex() {
        if (typeof queueIndex !== 'undefined' && Number.isFinite(queueIndex)) return queueIndex;
        return 0;
    }

    function getPendingOjama() {
        if (typeof pendingOjama !== 'undefined' && Number.isFinite(pendingOjama)) return pendingOjama;
        return 0;
    }

    function flattenBoard() {
        const W = getWidth();
        const H = getHeight();
        const out = new Uint8Array(W * H);

        if (typeof board === 'undefined' || !Array.isArray(board)) {
            return out;
        }

        for (let y = 0; y < H; y++) {
            const row = Array.isArray(board[y]) ? board[y] : [];
            for (let x = 0; x < W; x++) {
                out[y * W + x] = row[x] || 0;
            }
        }
        return out;
    }

    function readVisiblePieces() {
        const cur = getCurrentPuyo();
        const q = getQueueArray();
        const qi = getQueueIndex();

        const pieces = [];
        if (cur) {
            pieces.push({ mainColor: cur.mainColor | 0, subColor: cur.subColor | 0 });
        }

        const p1 = q[qi];
        const p2 = q[qi + 1];

        if (Array.isArray(p1) && p1.length >= 2) {
            pieces.push({ mainColor: p1[1] | 0, subColor: p1[0] | 0 });
        }
        if (Array.isArray(p2) && p2.length >= 2) {
            pieces.push({ mainColor: p2[1] | 0, subColor: p2[0] | 0 });
        }

        return pieces;
    }

    function ensureWorker() {
        if (AI_STATE.worker) return AI_STATE.readyPromise || Promise.resolve();

        AI_STATE.readyPromise = new Promise((resolve, reject) => {
            AI_STATE.readyResolve = resolve;
            AI_STATE.readyReject = reject;

            try {
                const worker = new Worker(AI_CONFIG.WORKER_URL);
                AI_STATE.worker = worker;

                worker.onmessage = (ev) => {
                    const msg = ev.data || {};
                    if (msg.type === 'ready') {
                        AI_STATE.ready = true;
                        updateStatus('AI待機中');
                        if (AI_STATE.readyResolve) AI_STATE.readyResolve(true);
                        AI_STATE.readyResolve = null;
                        AI_STATE.readyReject = null;
                        return;
                    }

                    if (msg.type === 'result') {
                        const job = AI_STATE.pendingJobs.get(msg.jobId);
                        if (!job) return;
                        AI_STATE.pendingJobs.delete(msg.jobId);
                        job.resolve(msg);
                        return;
                    }

                    if (msg.type === 'error') {
                        const job = AI_STATE.pendingJobs.get(msg.jobId);
                        if (job) {
                            AI_STATE.pendingJobs.delete(msg.jobId);
                            job.reject(new Error(msg.message || 'AI worker error'));
                        }
                        updateStatus('AIエラー');
                    }
                };

                worker.onerror = (err) => {
                    console.error('AI worker error:', err);
                    AI_STATE.ready = false;
                    if (AI_STATE.readyReject) AI_STATE.readyReject(err);
                    AI_STATE.readyResolve = null;
                    AI_STATE.readyReject = null;
                    updateStatus('AI worker初期化失敗');
                };
            } catch (err) {
                console.error('Failed to create worker:', err);
                AI_STATE.ready = false;
                if (AI_STATE.readyReject) AI_STATE.readyReject(err);
                AI_STATE.readyResolve = null;
                AI_STATE.readyReject = null;
                updateStatus('AI worker初期化失敗');
            }
        });

        return AI_STATE.readyPromise;
    }

    function packState() {
        const boardBuffer = flattenBoard();
        const pieces = readVisiblePieces();
        const pieceBuffer = new Uint8Array(6); // current + NEXT1 + NEXT2, each [main, sub]
        for (let i = 0; i < Math.min(3, pieces.length); i++) {
            pieceBuffer[i * 2] = pieces[i].mainColor | 0;
            pieceBuffer[i * 2 + 1] = pieces[i].subColor | 0;
        }

        return {
            width: getWidth(),
            height: getHeight(),
            hiddenRows: getHiddenRows(),
            boardBuffer,
            pieceBuffer,
            pendingOjama: getPendingOjama()
        };
    }

    function requestBestMove() {
        return new Promise(async (resolve, reject) => {
            try {
                await ensureWorker();
                if (!AI_STATE.worker || !AI_STATE.ready) {
                    reject(new Error('AI worker not ready'));
                    return;
                }

                const jobId = ++AI_STATE.jobSeq;
                const state = packState();

                AI_STATE.pendingJobs.set(jobId, { resolve, reject });

                AI_STATE.worker.postMessage(
                    {
                        type: 'search',
                        jobId,
                        state
                    },
                    [state.boardBuffer.buffer, state.pieceBuffer.buffer]
                );

                setTimeout(() => {
                    const job = AI_STATE.pendingJobs.get(jobId);
                    if (job) {
                        AI_STATE.pendingJobs.delete(jobId);
                        job.reject(new Error('AI search timeout'));
                        updateStatus('AI思考タイムアウト');
                    }
                }, AI_CONFIG.THINK_TIMEOUT_MS);
            } catch (err) {
                reject(err);
            }
        });
    }

    function applyMove(move) {
        const cur = getCurrentPuyo();
        if (!cur || !move) return false;

        cur.mainX = move.x | 0;
        cur.mainY = move.y | 0;
        cur.rotation = move.rotation | 0;

        if (typeof renderBoard === 'function') renderBoard();
        return true;
    }

    function hardDropCurrent() {
        if (typeof hardDrop === 'function') {
            hardDrop();
            return;
        }
        if (typeof lockPuyo === 'function') {
            lockPuyo();
        }
    }

    async function runOneMove() {
        if (AI_STATE.busy) return;
        if (getGameState() !== 'playing') {
            updateStatus('AI待機中');
            return;
        }
        if (!getCurrentPuyo()) {
            updateStatus('AI待機中');
            return;
        }

        AI_STATE.busy = true;
        updateStatus('AI思考中...');

        try {
            const result = await requestBestMove();
            if (!result || !result.move) {
                updateStatus('手が見つかりません');
                return;
            }

            applyMove(result.move);
            hardDropCurrent();
            updateStatus('AI実行完了');
        } catch (err) {
            console.error('AI error:', err);
            updateStatus('AIエラー');
        } finally {
            AI_STATE.busy = false;
        }
    }

    function startAutoLoop() {
        stopAutoLoop();
        AI_STATE.autoTimer = setInterval(() => {
            if (!AI_STATE.autoEnabled || AI_STATE.busy) return;
            if (getGameState() !== 'playing') return;
            if (!getCurrentPuyo()) return;
            runOneMove();
        }, AI_CONFIG.AUTO_TICK_MS);
    }

    function stopAutoLoop() {
        if (AI_STATE.autoTimer) {
            clearInterval(AI_STATE.autoTimer);
            AI_STATE.autoTimer = null;
        }
    }

    function initUI() {
        updateAutoButton();
        updateStatus('AI待機中');
    }

    window.runPuyoAI = function () {
        runOneMove();
    };

    window.toggleAIAuto = function () {
        AI_STATE.autoEnabled = !AI_STATE.autoEnabled;
        updateAutoButton();

        if (AI_STATE.autoEnabled) {
            updateStatus('AI自動起動');
            startAutoLoop();
            runOneMove();
        } else {
            stopAutoLoop();
            updateStatus('AI待機中');
        }
    };

    window.PuyoAI = {
        requestBestMove,
        applyMove,
        ensureWorker,
        startAutoLoop,
        stopAutoLoop
    };

    function boot() {
        if (AI_STATE.booted) return;
        AI_STATE.booted = true;
        initUI();
        ensureWorker().catch((err) => {
            console.error(err);
            updateStatus('AI worker初期化失敗');
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    window.addEventListener('beforeunload', () => {
        stopAutoLoop();
        if (AI_STATE.worker) {
            AI_STATE.worker.terminate();
            AI_STATE.worker = null;
        }
    });
})();