/* online.js (おじゃまぷよ・相殺・自動移行対応版) */
(function() {
    let peer = null;
    let conn = null;
    let myId = '';
    let isHost = false;
    let winTarget = 0;
    let myWins = 0;
    let oppWins = 0;
    let isMatchActive = false;
    let peerInitialized = false;
    
    // 相手のおじゃまぷよスタック
    let oppGarbageStack = 0;

    // UI初期化
    function initOnlineUI() {
        // 既存のUIを削除して再構築
        ['online-overlay', 'match-proposal-overlay', 'match-result-overlay'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });

        const overlay = document.createElement('div');
        overlay.id = 'online-overlay';
        overlay.innerHTML = `
            <div class="online-box">
                <h2>オンライン対戦</h2>
                <div id="online-status">PeerJSを初期化中...</div>
                <div id="my-id-display">あなたのID: <span id="my-peer-id">----</span></div>
                <input type="text" id="opponent-id-input" placeholder="相手のIDを入力">
                <button class="online-btn" onclick="connectToOpponent()">接続する</button>
                <button class="online-btn secondary" onclick="hideOnlineOverlay()">キャンセル</button>
            </div>
        `;
        document.body.appendChild(overlay);

        // 勝利数の下に自分のおじゃまスタックを表示
        const playStatsInfo = document.getElementById('play-stats-info');
        if (playStatsInfo) {
            // 勝利数表示の調整
            let winContainer = document.getElementById('win-count-container');
            if (!winContainer) {
                winContainer = document.createElement('div');
                winContainer.id = 'win-count-container';
                winContainer.className = 'stat-item';
                playStatsInfo.appendChild(winContainer);
            }
            winContainer.innerHTML = `
                <span class="stat-label">勝利数</span>
                <span id="win-count-display" class="stat-value">0 - 0</span>
                <div id="my-garbage-display" style="color: #ff4d4d; font-weight: bold; margin-top: 5px;">
                    おじゃま: <span id="my-garbage-stack">0</span>
                </div>
            `;

            // 相手の盤面の下に相手のおじゃまスタックを表示
            let oppContainer = document.getElementById('opponent-board-container');
            if (!oppContainer) {
                oppContainer = document.createElement('div');
                oppContainer.id = 'opponent-board-container';
                playStatsInfo.appendChild(oppContainer);
            }
            oppContainer.innerHTML = `
                <h3>相手の盤面</h3>
                <div id="opponent-board"></div>
                <div id="opponent-garbage-display" style="color: #ff4d4d; font-weight: bold; margin-top: 5px; text-align: center;">
                    おじゃま: <span id="opp-garbage-stack">0</span>
                </div>
            `;
            createOpponentBoardDOM();
        }
    }

    function createOpponentBoardDOM() {
        const boardElement = document.getElementById('opponent-board');
        if (!boardElement) return;
        boardElement.innerHTML = '';
        for (let y = 13; y >= 0; y--) {
            for (let x = 0; x < 6; x++) {
                const cell = document.createElement('div');
                cell.id = `opp-cell-${x}-${y}`;
                const puyo = document.createElement('div');
                puyo.className = 'puyo puyo-0';
                cell.appendChild(puyo);
                boardElement.appendChild(cell);
            }
        }
    }

    // おじゃまぷよ送信
    window.sendGarbage = function(amount) {
        if (conn && conn.open) {
            conn.send({ type: 'RECEIVE_GARBAGE', amount: amount });
        }
    };

    // 盤面データ送信（おじゃまスタック量も含む）
    window.sendBoardData = function() {
        if (!isMatchActive || !conn || !conn.open) return;
        if (typeof board !== 'undefined') {
            conn.send({
                type: 'BOARD_UPDATE',
                board: board,
                currentPuyo: typeof currentPuyo !== 'undefined' ? currentPuyo : null,
                gameState: typeof gameState !== 'undefined' ? gameState : 'playing',
                garbageStack: typeof myGarbageStack !== 'undefined' ? myGarbageStack : 0
            });
        }
    };

    // データ受信ハンドラ
    function handleReceivedData(data) {
        switch(data.type) {
            case 'BOARD_UPDATE':
                updateOpponentBoard(data.board, data.currentPuyo, data.gameState);
                oppGarbageStack = data.garbageStack || 0;
                const oppStackEl = document.getElementById('opp-garbage-stack');
                if (oppStackEl) oppStackEl.textContent = oppGarbageStack;
                break;
            case 'RECEIVE_GARBAGE':
                if (window.receiveGarbage) window.receiveGarbage(data.amount);
                break;
            case 'OPPONENT_LOST':
                myWins++;
                updateWinCountDisplay();
                checkSeriesWinner();
                break;
            // 他のメッセージタイプは既存のものを踏襲
        }
    }

    function checkSeriesWinner() {
        if (myWins >= winTarget) {
            alert('シリーズ勝利！');
            location.reload();
        } else {
            // アラートなしで次へ
            setTimeout(() => {
                if (window.resetGame) window.resetGame();
            }, 1000);
        }
    }

    window.notifyGameOver = function() {
        if (isMatchActive && conn && conn.open) {
            conn.send({ type: 'OPPONENT_LOST' });
            oppWins++;
            updateWinCountDisplay();
            if (oppWins >= winTarget) {
                alert('シリーズ敗北...');
                location.reload();
            } else {
                // アラートなしで次へ
                setTimeout(() => {
                    if (window.resetGame) window.resetGame();
                }, 1000);
            }
        }
    };

    // --- PeerJS初期化などは既存のものを流用 ---
    // (ここでは簡略化のため要点のみ記述、実際には既存のonline.jsのPeerJS周りを結合)
    
    // ... (PeerJS init, setupConnection 等) ...

    window.addEventListener('load', initOnlineUI);
})();
