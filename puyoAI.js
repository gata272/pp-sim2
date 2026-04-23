/* puyoAI.js
 * WASM + Web Worker wrapper
 * Buttons:
 *   - #ai-step-button
 *   - #ai-auto-button
 *   - #ai-status
 */
(function () {
    'use strict';

    const BOARD_W = 6;
    const BOARD_H = 14;

    let worker = null;
    let workerReady = false;
    let pendingResolve = null;
    let pendingReject = null;
    let autoEnabled = false;
    let autoTimer = null;
    let busy = false;

    function getBoardFlat() {
        if (typeof board === 'undefined' || !Array.isArray(board)) return null;

        const flat = new Int32Array(BOARD_W * BOARD_H);
        for (let y = 0; y < BOARD_H; y++) {
            for (let x = 0; x < BOARD_W; x++) {
                flat[y * BOARD_W + x] = board[y]?.[x] ?? 0;
            }
        }
        return flat;
    }

    function getPiecePayload() {
        if (typeof currentPuyo === 'undefined' || !currentPuyo) return null;
        if (typeof window.getNextQueue !== 'function') return null;

        const q = window.getNextQueue();
        if (!Array.isArray(q) || q.length < 2) return null;

        const p1 = q[queueIndex] || [0, 0];
        const p2 = q[queueIndex + 1] || [0, 0];

        return new Int32Array([
            currentPuyo.subColor || 0,
            currentPuyo.mainColor || 0,
            p1[0] || 0,
            p1[1] || 0,
            p2[0] || 0,
            p2[1] || 0
        ]);
    }

    function setStatus(text) {
        const el = document.getElementById('ai-status');
        if (el) el.textContent = text;
    }

    function updateAutoButton() {
        const btn = document.getElementById('ai-auto-button');
        if (btn) btn.textContent = autoEnabled ? 'AI自動: ON' : 'AI自動: OFF';
    }

    function ensureWorker() {
        if (worker) return worker;

        worker = new Worker('./puyo-ai-worker.js', { type: 'module' });

        worker.onmessage = (event) => {
            const data = event.data;

            if (data.type === 'result') {
                workerReady = true;
                if (pendingResolve) {
                    pendingResolve(data.move);
                    pendingResolve = null;
                    pendingReject = null;
                }
            } else if (data.type === 'error') {
                if (pendingReject) {
                    pendingReject(new Error(data.message || 'AI worker error'));
                    pendingResolve = null;
                    pendingReject = null;
                } else {
                    setStatus('AIエラー');
                    console.error(data.message);
                }
            }
        };

        worker.onerror = (err) => {
            console.error('AI worker error:', err);
            workerReady = false;
            if (pendingReject) {
                pendingReject(err);
                pendingResolve = null;
                pendingReject = null;
            }
            setStatus('AIエラー');
        };

        return worker;
    }

    function requestMove() {
        return new Promise((resolve, reject) => {
            if (typeof gameState !== 'undefined' && gameState !== 'playing') {
                reject(new Error('not playing'));
                return;
            }

            const b = getBoardFlat();
            const pieces = getPiecePayload();

            if (!b || !pieces) {
                reject(new Error('snapshot unavailable'));
                return;
            }

            ensureWorker();

            pendingResolve = resolve;
            pendingReject = reject;

            worker.postMessage(
                { type: 'solve', board: b, pieces },
                [b.buffer, pieces.buffer]
            );
        });
    }

    function applyMove(move) {
        if (typeof currentPuyo === 'undefined' || !currentPuyo) return false;

        currentPuyo.mainX = move.x;
        currentPuyo.mainY = move.y;
        currentPuyo.rotation = move.rotation;

        if (typeof renderBoard === 'function') renderBoard();
        return true;
    }

    async function runOnce() {
        if (busy) return;
        if (typeof gameState !== 'undefined' && gameState !== 'playing') {
            setStatus('AI待機中');
            return;
        }
        if (typeof currentPuyo === 'undefined' || !currentPuyo) {
            setStatus('AI待機中');
            return;
        }

        busy = true;
        setStatus('AI思考中...');

        try {
            const move = await requestMove();
            if (!move) {
                setStatus('手なし');
                return;
            }

            applyMove(move);

            if (typeof hardDrop === 'function') {
                hardDrop();
            }

            setStatus('AI実行完了');
        } catch (err) {
            if (String(err?.message || err).includes('not playing')) {
                setStatus('AI待機中');
            } else {
                console.error(err);
                setStatus('AIエラー');
            }
        } finally {
            busy = false;
        }
    }

    function startAuto() {
        stopAuto();
        autoTimer = setInterval(() => {
            if (autoEnabled && !busy) {
                runOnce();
            }
        }, 120);
    }

    function stopAuto() {
        if (autoTimer) {
            clearInterval(autoTimer);
            autoTimer = null;
        }
    }

    function boot() {
        ensureWorker();
        setStatus('AI待機中');
        updateAutoButton();
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
        runOnce,
        requestMove
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();