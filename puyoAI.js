/* puyoAI.js
 * Worker-backed AI for pp-sim2
 * - current piece + NEXT1 + NEXT2
 * - beam search + future-seed evaluation
 * - robust worker loader for GitHub Pages
 */
(function () {
    'use strict';

    const AI_CONFIG = {
        WORKER_URLS: [
            './puyo-ai-worker.js',
            './puyo-ai-worker.js?v=5'
        ],
        AUTO_TICK_MS: 140,
        THINK_TIMEOUT_MS: 12000,
        READY_TIMEOUT_MS: 8000
    };

    const AI_STATE = {
        worker: null,
        ready: false,
        readyPromise: null,
        busy: false,
        autoEnabled: false,
        autoTimer: null,
        jobSeq: 0,
        jobs: new Map(),
        booted: false
    };

    function getWidth() {
        return typeof WIDTH !== 'undefined' ? WIDTH : 6;
    }

    function getHeight() {
        return typeof HEIGHT !== 'undefined' ? HEIGHT : 14;
    }

    function getCurrentPuyo() {
        if (typeof currentPuyo === 'undefined' || !currentPuyo) return null;
        return currentPuyo;
    }

    function getGameState() {
        return typeof gameState !== 'undefined' ? gameState : 'playing';
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
        if (typeof queueIndex !== 'undefined' && Number.isFinite(queueIndex)) {
            return queueIndex;
        }
        return 0;
    }

    function getPendingOjama() {
        if (typeof pendingOjama !== 'undefined' && Number.isFinite(pendingOjama)) {
            return pendingOjama;
        }
        return 0;
    }

    function setStatus(text) {
        const el = document.getElementById('ai-status');
        if (el) el.textContent = text;
    }

    function updateAutoButton() {
        const btn = document.getElementById('ai-auto-button');
        if (btn) btn.textContent = AI_STATE.autoEnabled ? 'AI自動: ON' : 'AI自動: OFF';
    }

    function flattenBoard() {
        const W = getWidth();
        const H = getHeight();
        const out = new Uint8Array(W * H);

        if (typeof board === 'undefined' || !Array.isArray(board)) return out;

        for (let y = 0; y < H; y++) {
            const row = Array.isArray(board[y]) ? board[y] : [];
            for (let x = 0; x < W; x++) {
                out[y * W + x] = row[x] | 0;
            }
        }
        return out;
    }

    function packState() {
        const pieces = [];
        const cur = getCurrentPuyo();
        const q = getQueueArray();
        const qi = getQueueIndex();

        if (cur) {
            pieces.push({ mainColor: cur.mainColor | 0, subColor: cur.subColor | 0 });
        }

        for (let i = 0; i < 2; i++) {
            const pair = q[qi + i];
            if (Array.isArray(pair) && pair.length >= 2) {
                pieces.push({ mainColor: pair[1] | 0, subColor: pair[0] | 0 });
            }
        }

        const pieceBuffer = new Uint8Array(6);
        for (let i = 0; i < Math.min(3, pieces.length); i++) {
            pieceBuffer[i * 2] = pieces[i].mainColor | 0;
            pieceBuffer[i * 2 + 1] = pieces[i].subColor | 0;
        }

        return {
            width: getWidth(),
            height: getHeight(),
            hiddenRows: typeof HIDDEN_ROWS !== 'undefined' ? HIDDEN_ROWS : 2,
            boardBuffer: flattenBoard(),
            pieceBuffer,
            pendingOjama: getPendingOjama(),
            gameState: getGameState()
        };
    }

    function parseMovePayload(msg) {
        if (!msg) return null;
        const move = msg.move || msg;
        if (
            move &&
            Number.isFinite(move.x) &&
            Number.isFinite(move.y) &&
            Number.isFinite(move.rotation)
        ) {
            return {
                x: move.x | 0,
                y: move.y | 0,
                rotation: move.rotation | 0
            };
        }
        return null;
    }

    function createWorkerFromUrl(url) {
        return new Promise((resolve, reject) => {
            let worker = null;
            let settled = false;

            try {
                worker = new Worker(new URL(url, window.location.href).href);
            } catch (err) {
                reject(err);
                return;
            }

            const cleanup = () => {
                if (worker) {
                    worker.onmessage = null;
                    worker.onerror = null;
                }
            };

            const readyTimer = setTimeout(() => {
                if (settled) return;
                settled = true;
                cleanup();
                try { worker.terminate(); } catch (_) {}
                reject(new Error(`Worker ready timeout: ${url}`));
            }, AI_CONFIG.READY_TIMEOUT_MS);

            worker.onmessage = (ev) => {
                const msg = ev.data || {};
                if (msg.type === 'ready') {
                    if (settled) return;
                    settled = true;
                    clearTimeout(readyTimer);
                    cleanup();
                    resolve(worker);
                }
            };

            worker.onerror = (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(readyTimer);
                cleanup();
                try { worker.terminate(); } catch (_) {}
                reject(err instanceof Error ? err : new Error(String(err)));
            };
        });
    }

    async function ensureWorker() {
        if (AI_STATE.worker && AI_STATE.ready) return true;
        if (AI_STATE.readyPromise) return AI_STATE.readyPromise;

        AI_STATE.readyPromise = (async () => {
            let lastErr = null;

            for (const url of AI_CONFIG.WORKER_URLS) {
                try {
                    const worker = await createWorkerFromUrl(url);
                    AI_STATE.worker = worker;
                    AI_STATE.ready = true;

                    worker.onmessage = (ev) => {
                        const msg = ev.data || {};

                        if (msg.type === 'result') {
                            const job = AI_STATE.jobs.get(msg.jobId);
                            if (!job) return;
                            AI_STATE.jobs.delete(msg.jobId);
                            clearTimeout(job.timer);
                            job.resolve(msg);
                            return;
                        }

                        if (msg.type === 'error') {
                            const job = AI_STATE.jobs.get(msg.jobId);
                            if (job) {
                                AI_STATE.jobs.delete(msg.jobId);
                                clearTimeout(job.timer);
                                job.reject(new Error(msg.message || 'AI worker error'));
                            }
                            setStatus('AIエラー');
                        }
                    };

                    worker.onerror = (err) => {
                        console.error('AI worker runtime error:', err);
                        AI_STATE.ready = false;
                        setStatus('AI workerエラー');
                    };

                    setStatus('AI待機中');
                    return true;
                } catch (err) {
                    lastErr = err;
                }
            }

            AI_STATE.ready = false;
            throw lastErr || new Error('All worker candidates failed');
        })();

        try {
            await AI_STATE.readyPromise;
            return true;
        } catch (err) {
            console.error('Failed to initialize AI worker:', err);
            setStatus('AI worker初期化失敗');
            AI_STATE.readyPromise = null;
            throw err;
        } finally {
            if (!AI_STATE.ready) {
                AI_STATE.readyPromise = null;
            }
        }
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

                const timer = setTimeout(() => {
                    const job = AI_STATE.jobs.get(jobId);
                    if (job) {
                        AI_STATE.jobs.delete(jobId);
                        job.reject(new Error('AI search timeout'));
                        setStatus('AI思考タイムアウト');
                    }
                }, AI_CONFIG.THINK_TIMEOUT_MS);

                AI_STATE.jobs.set(jobId, {
                    resolve,
                    reject,
                    timer
                });

                AI_STATE.worker.postMessage(
                    { type: 'search', jobId, state },
                    [state.boardBuffer.buffer, state.pieceBuffer.buffer]
                );
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
            setStatus('AI待機中');
            return;
        }

        const cur = getCurrentPuyo();
        if (!cur) {
            setStatus('AI待機中');
            return;
        }

        AI_STATE.busy = true;
        setStatus('AI思考中...');

        try {
            const result = await requestBestMove();
            const move = parseMovePayload(result);

            if (!move) {
                setStatus('手が見つかりません');
                return;
            }

            applyMove(move);
            hardDropCurrent();
            setStatus('AI実行完了');
        } catch (err) {
            console.error('AI error:', err);
            setStatus('AIエラー');
        } finally {
            AI_STATE.busy = false;
        }
    }

    function tickAuto() {
        if (!AI_STATE.autoEnabled || AI_STATE.busy) return;
        if (getGameState() !== 'playing') return;
        if (!getCurrentPuyo()) return;
        runOneMove();
    }

    function startAutoLoop() {
        stopAutoLoop();
        AI_STATE.autoTimer = setInterval(tickAuto, AI_CONFIG.AUTO_TICK_MS);
    }

    function stopAutoLoop() {
        if (AI_STATE.autoTimer) {
            clearInterval(AI_STATE.autoTimer);
            AI_STATE.autoTimer = null;
        }
    }

    function initUI() {
        updateAutoButton();
        setStatus('AI待機中');
    }

    window.runPuyoAI = function () {
        runOneMove();
    };

    window.toggleAIAuto = function () {
        AI_STATE.autoEnabled = !AI_STATE.autoEnabled;
        updateAutoButton();

        if (AI_STATE.autoEnabled) {
            setStatus('AI自動起動');
            startAutoLoop();
            runOneMove();
        } else {
            stopAutoLoop();
            setStatus('AI待機中');
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
            setStatus('AI worker初期化失敗');
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    window.addEventListener('beforeunload', () => {
        stopAutoLoop();
        for (const job of AI_STATE.jobs.values()) {
            clearTimeout(job.timer);
        }
        AI_STATE.jobs.clear();
        if (AI_STATE.worker) {
            AI_STATE.worker.terminate();
            AI_STATE.worker = null;
        }
    });
})();