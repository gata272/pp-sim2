/* puyoAI.js
 * Worker-backed AI wrapper
 * - Uses current piece + NEXT1 + NEXT2
 * - Keeps the heuristic/search structure from your pasted AI
 * - Moves heavy work off the main thread
 */
(function () {
    'use strict';

    const AI_CONFIG = {
        AUTO_TICK_MS: 120,
        WORKER_TIMEOUT_MS: 6000
    };

    const W = typeof WIDTH !== 'undefined' ? WIDTH : 6;
    const H = typeof HEIGHT !== 'undefined' ? HEIGHT : 14;

    let worker = null;
    let pendingJob = null;
    let autoEnabled = false;
    let autoTimer = null;
    let busy = false;
    let booted = false;

    function setStatus(text) {
        const el = document.getElementById('ai-status');
        if (el) el.textContent = text;
    }

    function updateAutoButton() {
        const btn = document.getElementById('ai-auto-button');
        if (btn) btn.textContent = autoEnabled ? 'AI自動: ON' : 'AI自動: OFF';
    }

    function safeBoard() {
        if (typeof board === 'undefined' || !Array.isArray(board)) return null;
        return board;
    }

    function safeCurrentPuyo() {
        if (typeof currentPuyo === 'undefined' || !currentPuyo) return null;
        return currentPuyo;
    }

    function getQueueSnapshot() {
        if (typeof window.getNextQueue === 'function') {
            const q = window.getNextQueue();
            return Array.isArray(q) ? q : [];
        }
        if (typeof nextQueue !== 'undefined' && Array.isArray(nextQueue)) {
            return nextQueue.map(pair => pair.slice());
        }
        return [];
    }

    function getQueueIndex() {
        return (typeof queueIndex === 'number' && Number.isFinite(queueIndex)) ? queueIndex : 0;
    }

    function boardSnapshotFlat() {
        const b = safeBoard();
        if (!b) return null;

        const flat = new Int32Array(W * H);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                flat[y * W + x] = b[y]?.[x] ?? 0;
            }
        }
        return flat;
    }

    function piecesSnapshotFlat() {
        const cur = safeCurrentPuyo();
        if (!cur) return null;

        const q = getQueueSnapshot();
        if (!Array.isArray(q) || q.length < 2) return null;

        const idx = getQueueIndex();
        const p1 = q[idx] || [0, 0];
        const p2 = q[idx + 1] || [0, 0];

        return new Int32Array([
            cur.subColor || 0,
            cur.mainColor || 0,
            p1[0] || 0,
            p1[1] || 0,
            p2[0] || 0,
            p2[1] || 0
        ]);
    }

    function terminateWorker() {
        if (worker) {
            try {
                worker.terminate();
            } catch (_) {}
        }
        worker = null;
    }

    function ensureWorker() {
        if (worker) return worker;

        try {
            worker = new Worker('./puyo-ai-worker.js', { type: 'module' });

            worker.onmessage = (event) => {
                const data = event.data || {};
                if (data.type === 'ready') {
                    setStatus('AI待機中');
                    return;
                }

                if (!pendingJob) return;

                if (pendingJob.timer) clearTimeout(pendingJob.timer);
                const job = pendingJob;
                pendingJob = null;

                if (data.type === 'result') {
                    job.resolve(data.move || null);
                } else {
                    setStatus('AIエラー');
                    job.reject(new Error(data.message || 'AI worker error'));
                }
            };

            worker.onerror = (err) => {
                console.error('AI worker error:', err);
                if (pendingJob) {
                    if (pendingJob.timer) clearTimeout(pendingJob.timer);
                    const job = pendingJob;
                    pendingJob = null;
                    job.reject(err instanceof Error ? err : new Error('AI worker error'));
                }
                setStatus('AIエラー');
                terminateWorker();
            };

            worker.onmessageerror = (err) => {
                console.error('AI worker message error:', err);
                if (pendingJob) {
                    if (pendingJob.timer) clearTimeout(pendingJob.timer);
                    const job = pendingJob;
                    pendingJob = null;
                    job.reject(new Error('AI worker message error'));
                }
                setStatus('AIエラー');
                terminateWorker();
            };
        } catch (err) {
            console.error('Failed to create AI worker:', err);
            setStatus('AIエラー');
            terminateWorker();
        }

        return worker;
    }

    function requestMove() {
        return new Promise((resolve, reject) => {
            if (typeof gameState !== 'undefined' && gameState !== 'playing') {
                reject(new Error('not playing'));
                return;
            }

            const b = boardSnapshotFlat();
            const pieces = piecesSnapshotFlat();

            if (!b || !pieces) {
                reject(new Error('snapshot unavailable'));
                return;
            }

            const w = ensureWorker();
            if (!w) {
                reject(new Error('worker unavailable'));
                return;
            }

            const timer = setTimeout(() => {
                if (pendingJob && pendingJob.timer === timer) {
                    pendingJob = null;
                }
                terminateWorker();
                reject(new Error('worker timeout'));
            }, AI_CONFIG.WORKER_TIMEOUT_MS);

            pendingJob = { resolve, reject, timer };

            try {
                w.postMessage(
                    { type: 'solve', board: b, pieces },
                    [b.buffer, pieces.buffer]
                );
            } catch (err) {
                clearTimeout(timer);
                pendingJob = null;
                reject(err);
            }
        });
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

    async function runOnce() {
        if (busy) return;

        if (typeof gameState !== 'undefined' && gameState !== 'playing') {
            setStatus('AI待機中');
            return;
        }

        if (!safeCurrentPuyo()) {
            setStatus('AI待機中');
            return;
        }

        busy = true;
        setStatus('AI思考中...');

        try {
            const move = await requestMove();

            if (!move) {
                setStatus('手が見つかりません');
                return;
            }

            if (!applyMove(move)) {
                setStatus('AIエラー');
                return;
            }

            if (typeof hardDrop === 'function') {
                hardDrop();
            }

            setStatus('AI実行完了');
        } catch (err) {
            console.error('AI error:', err);
            if (String(err?.message || err).includes('not playing')) {
                setStatus('AI待機中');
            } else {
                setStatus('AIエラー');
            }
        } finally {
            busy = false;
        }
    }

    function tickAuto() {
        if (!autoEnabled || busy) return;

        if (typeof gameState !== 'undefined' && gameState !== 'playing') {
            setStatus('AI待機中');
            return;
        }

        if (!safeCurrentPuyo()) {
            setStatus('AI待機中');
            return;
        }

        runOnce();
    }

    function startAuto() {
        stopAuto();
        autoTimer = setInterval(tickAuto, AI_CONFIG.AUTO_TICK_MS);
    }

    function stopAuto() {
        if (autoTimer) {
            clearInterval(autoTimer);
            autoTimer = null;
        }
    }

    function boot() {
        if (booted) return;
        booted = true;
        updateAutoButton();
        setStatus('AI待機中');
        ensureWorker();
    }

    window.runPuyoAI = function () {
        runOnce();
    };

    window.toggleAIAuto = function () {
        autoEnabled = !autoEnabled;
        updateAutoButton();

        if (autoEnabled) {
            setStatus('AI自動起動');
            startAuto();
            runOnce();
        } else {
            stopAuto();
            setStatus('AI待機中');
        }
    };

    window.PuyoAI = {
        requestMove,
        runOnce
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();