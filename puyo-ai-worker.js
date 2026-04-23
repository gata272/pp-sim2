/* puyo-ai-worker.js
 * Module worker that loads the generated WASM module
 */
import createModule from './puyoAI_wasm.mjs';

let wasmModule = null;
let chooseMove = null;
let initPromise = null;
let readySent = false;

function allocIntArray(mod, arr) {
    const ptr = mod._malloc(arr.length * 4);
    mod.HEAP32.set(arr, ptr >> 2);
    return ptr;
}

function decodeMove(packed) {
    return {
        rotation: packed & 0xff,
        x: (packed >> 8) & 0xff,
        y: (packed >> 16) & 0xff
    };
}

async function ensureWasm() {
    if (wasmModule) return wasmModule;

    if (!initPromise) {
        initPromise = createModule({
            noInitialRun: true,
            locateFile: (path) => new URL(path, import.meta.url).href
        }).then((mod) => {
            wasmModule = mod;
            chooseMove = mod.cwrap('ai_choose_move', 'number', ['number', 'number']);
            if (!readySent) {
                readySent = true;
                self.postMessage({ type: 'ready' });
            }
            return mod;
        });
    }

    return initPromise;
}

self.onmessage = async (event) => {
    const data = event.data;
    if (!data || data.type !== 'solve') return;

    try {
        const mod = await ensureWasm();
        if (!chooseMove) throw new Error('ai_choose_move is not available');

        const board = data.board instanceof Int32Array ? data.board : Int32Array.from(data.board || []);
        const pieces = data.pieces instanceof Int32Array ? data.pieces : Int32Array.from(data.pieces || []);

        const boardPtr = allocIntArray(mod, board);
        const piecesPtr = allocIntArray(mod, pieces);

        let packed = 0;
        try {
            packed = chooseMove(boardPtr, piecesPtr) | 0;
        } finally {
            mod._free(boardPtr);
            mod._free(piecesPtr);
        }

        self.postMessage({
            type: 'result',
            move: decodeMove(packed)
        });
    } catch (err) {
        self.postMessage({
            type: 'error',
            message: err?.message || String(err)
        });
    }
};