/* online.js (バックアップ復元版 + おじゃまスタック表示欄のみ追加) */
(function() {
    let peer = null;
    let conn = null;
    let myId = '';
    let isHost = false;
    let winTarget = 3;
    let myWins = 0;
    let oppWins = 0;
    let isMatchActive = false;
    let peerInitialized = false;
    let peerInitializing = false;
    
    let oppScore = 0;
    let oppChainCount = 0;
    let oppGarbageStack = 0; // 追加

    let monitorInterval = null;
    let lastBoardJson = "";
    let lastGameState = "";

    function initOnlineUI() {
        // 1. オーバーレイ（オンライン設定用）
        if (!document.getElementById('online-overlay')) {
            const overlay = document.createElement('div');
            overlay.id = 'online-overlay';
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); display: none; justify-content: center; align-items: center; z-index: 10000; font-family: sans-serif;';
            overlay.innerHTML = `
                <div style="background: #222; padding: 25px; border-radius: 12px; border: 1px solid #444; width: 320px; text-align: center; color: white; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                    <h2 style="margin: 0 0 15px 0; font-size: 1.4em;">オンライン対戦</h2>
                    <div id="online-status" style="margin-bottom: 12px; font-size: 0.9em; color: #aaa;">PeerJSを初期化中...</div>
                    <div id="my-id-display" style="margin-bottom: 20px; font-size: 0.85em; color: #888; background: #111; padding: 10px; border-radius: 6px;">あなたのID: <span id="my-peer-id" style="color: #3498db; font-weight: bold; font-family: monospace;">----</span></div>
                    <input type="text" id="opponent-id-input" placeholder="相手のIDを入力" style="width: 100%; padding: 12px; margin-bottom: 12px; background: #333; color: white; border: 1px solid #555; border-radius: 6px; box-sizing: border-box;">
                    <button id="btn-connect" style="width: 100%; padding: 12px; margin-bottom: 12px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">接続する</button>
                    <button id="btn-cancel" style="width: 100%; padding: 10px; background: #444; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.9em;">キャンセル</button>
                </div>
            `;
            document.body.appendChild(overlay);
            document.getElementById('btn-connect').onclick = window.connectToOpponent;
            document.getElementById('btn-cancel').onclick = window.hideOnlineOverlay;
        }

        // 2. 試合提案・結果オーバーレイ
        if (!document.getElementById('match-proposal-overlay')) {
            const proposalOverlay = document.createElement('div');
            proposalOverlay.id = 'match-proposal-overlay';
            proposalOverlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); display: none; justify-content: center; align-items: center; z-index: 10001; font-family: sans-serif;';
            proposalOverlay.innerHTML = `
                <div style="background: #222; padding: 25px; border-radius: 12px; border: 1px solid #444; width: 320px; text-align: center; color: white;">
                    <h2 id="proposal-title" style="margin: 0 0 15px 0; font-size: 1.3em;">対戦設定</h2>
                    <div id="proposal-content" style="margin-bottom: 25px; font-size: 1em; line-height: 1.4;"></div>
                    <div id="proposal-actions" style="display: flex; gap: 10px; justify-content: center;"></div>
                </div>
            `;
            document.body.appendChild(proposalOverlay);
        }

        // 3. 情報パネルへの対戦情報・おじゃまスタック欄の追加
        const infoPanel = document.getElementById('info-panel');
        if (infoPanel && !document.getElementById('online-stats-container')) {
            const statsContainer = document.createElement('div');
            statsContainer.id = 'online-stats-container';
            statsContainer.style.cssText = 'margin-top: 10px; padding: 10px; background: #1a1a1a; border-radius: 8px; border: 1px solid #333; display: none; width: 100%; box-sizing: border-box; clear: both;'; 
            statsContainer.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid #333; padding-bottom: 5px;">
                    <span style="font-size: 0.8em; color: #aaa;">勝利数</span>
                    <span id="win-count-display" style="font-weight: bold; color: #f1c40f; font-size: 1.1em;">0 - 0</span>
                </div>
                <!-- 自分のおじゃまスタック表示欄 -->
                <div id="my-garbage-info" style="text-align: center; margin-bottom: 10px;">
                    <div style="font-size: 0.75em; color: #888; margin-bottom: 2px;">自分のおじゃま</div>
                    <div id="my-garbage-stack-val" style="font-weight: bold; color: #e74c3c; font-size: 1.2em; font-family: monospace;">0</div>
                </div>
                <div id="opponent-section" style="border-top: 1px solid #333; padding-top: 10px;">
                    <h3 style="font-size: 0.8em; color: #aaa; margin: 0 0 8px 0; text-align: center;">相手の盤面</h3>
                    <div id="opponent-board" style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 1px; background: #000; border: 1px solid #444; width: 90px; height: 210px; margin: 0 auto;"></div>
                    <!-- 相手のおじゃまスタック表示欄 -->
                    <div style="text-align: center; margin-top: 8px;">
                        <div style="font-size: 0.75em; color: #888; margin-bottom: 2px;">相手のおじゃま</div>
                        <div id="opp-garbage-stack" style="font-weight: bold; color: #e74c3c; font-size: 1.1em; font-family: monospace;">0</div>
                    </div>
                </div>
            `;
            infoPanel.appendChild(statsContainer);
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
                cell.style.cssText = 'background: #111; position: relative; width: 100%; height: 100%;';
                const puyo = document.createElement('div');
                puyo.className = 'puyo puyo-0';
                puyo.style.cssText = 'width: 100%; height: 100%; border-radius: 50%; transform: scale(0.9);';
                cell.appendChild(puyo);
                boardElement.appendChild(cell);
            }
        }
    }

    window.showOnlineOverlay = function() {
        const overlay = document.getElementById('online-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
            if (!peerInitialized) initPeer();
        }
    };

    window.hideOnlineOverlay = function() {
        const overlay = document.getElementById('online-overlay');
        if (overlay) overlay.style.display = 'none';
    };

    function initPeer() {
        if (peerInitializing) return;
        peerInitializing = true;
        peer = new Peer();
        peer.on('open', (id) => {
            myId = id;
            peerInitialized = true;
            peerInitializing = false;
            document.getElementById('my-peer-id').textContent = id;
            document.getElementById('online-status').textContent = '接続待機中...';
        });
        peer.on('connection', (connection) => {
            conn = connection;
            setupConnection();
            isHost = true;
        });
        peer.on('error', (err) => {
            console.error('PeerJS Error:', err);
            peerInitializing = false;
            document.getElementById('online-status').textContent = 'エラーが発生しました';
        });
    }

    function setupConnection() {
        conn.on('open', () => {
            window.hideOnlineOverlay();
            if (isHost) showMatchProposal();
        });
        conn.on('data', handleReceivedData);
        conn.on('close', () => {
            alert('接続が切断されました');
            location.reload();
        });
    }

    window.connectToOpponent = function() {
        const targetId = document.getElementById('opponent-id-input').value.trim();
        if (!targetId) return;
        conn = peer.connect(targetId);
        isHost = false;
        setupConnection();
    };

    function handleReceivedData(data) {
        switch(data.type) {
            case 'PROPOSE_MATCH': showApprovalUI(data.winTarget); break;
            case 'ACCEPT_MATCH': startMatch(data.winTarget); break;
            case 'BOARD_UPDATE':
                updateOpponentBoard(data.board, data.currentPuyo, data.gameState);
                // 相手のおじゃまスタック数値を受信
                oppGarbageStack = data.garbageStack || 0;
                const oppStackEl = document.getElementById('opp-garbage-stack');
                if (oppStackEl) oppStackEl.textContent = oppGarbageStack;
                break;
            case 'SYNC_NEXT':
                if (typeof nextQueue !== 'undefined') {
                    nextQueue = JSON.parse(JSON.stringify(data.nextPuyos));
                    queueIndex = 0;
                    if (window.renderBoard) window.renderBoard();
                }
                break;
            case 'OPPONENT_LOST':
                endMatchWithWinner(true);
                break;
        }
    }

    function showMatchProposal() {
        const overlay = document.getElementById('match-proposal-overlay');
        overlay.style.display = 'flex';
        document.getElementById('proposal-title').textContent = '対戦設定';
        document.getElementById('proposal-content').innerHTML = `
            <p>何本先取にしますか？</p>
            <select id="win-target-select" style="width: 100%; padding: 10px; margin-top: 10px; background: #333; color: white; border: 1px solid #555; border-radius: 6px;">
                ${[1,2,3,5,10].map(n => `<option value="${n}" ${n===3?'selected':''}>${n}本先取</option>`).join('')}
            </select>
        `;
        document.getElementById('proposal-actions').innerHTML = `<button id="btn-propose" style="width: 100%; padding: 12px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">提案を送る</button>`;
        document.getElementById('btn-propose').onclick = () => {
            const target = parseInt(document.getElementById('win-target-select').value);
            conn.send({ type: 'PROPOSE_MATCH', winTarget: target });
            document.getElementById('proposal-content').innerHTML = `<p>${target}本先取の提案を送信しました。待機中...</p>`;
            document.getElementById('proposal-actions').innerHTML = '';
        };
    }

    function showApprovalUI(target) {
        const overlay = document.getElementById('match-proposal-overlay');
        overlay.style.display = 'flex';
        document.getElementById('proposal-title').textContent = '対戦の誘い';
        document.getElementById('proposal-content').innerHTML = `<p>相手から <strong>${target}本先取</strong> の提案が届きました。</p>`;
        document.getElementById('proposal-actions').innerHTML = `
            <button id="btn-accept" style="flex: 1; padding: 12px; background: #2ecc71; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">承認</button>
            <button id="btn-reject" style="flex: 1; padding: 12px; background: #e74c3c; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">拒否</button>
        `;
        document.getElementById('btn-accept').onclick = () => {
            conn.send({ type: 'ACCEPT_MATCH', winTarget: target });
            startMatch(target);
        };
        document.getElementById('btn-reject').onclick = () => {
            overlay.style.display = 'none';
        };
    }

    function startMatch(target) {
        winTarget = target;
        myWins = 0; oppWins = 0;
        isMatchActive = true;
        document.getElementById('match-proposal-overlay').style.display = 'none';
        document.body.classList.add('online-match-active');
        const stats = document.getElementById('online-stats-container');
        if (stats) stats.style.display = 'block'; 
        updateWinCountDisplay();
        
        if (window.resetGame) window.resetGame();
        if (isHost) setTimeout(syncNextPuyos, 500);
        
        startMonitoring();
    }

    function syncNextPuyos() {
        if (typeof nextQueue !== 'undefined' && conn && conn.open) {
            conn.send({ type: 'SYNC_NEXT', nextPuyos: nextQueue });
        }
    }

    function startMonitoring() {
        if (monitorInterval) clearInterval(monitorInterval);
        lastBoardJson = "";
        lastGameState = "";
        monitorInterval = setInterval(() => {
            if (!isMatchActive || !conn || !conn.open) {
                clearInterval(monitorInterval);
                return;
            }
            if (typeof board !== 'undefined') {
                const currentBoardJson = JSON.stringify(board);
                const currentPuyoJson = typeof currentPuyo !== 'undefined' ? JSON.stringify(currentPuyo) : "null";
                // おじゃまスタックも監視対象に含める
                const currentGarbage = typeof myGarbageStack !== 'undefined' ? myGarbageStack : 0;
                const currentState = typeof gameState !== 'undefined' ? gameState : 'playing';

                const combined = currentBoardJson + currentPuyoJson + currentGarbage + currentState;
                if (combined !== lastBoardJson) {
                    window.sendBoardData();
                    lastBoardJson = combined;
                }

                if (currentState === 'gameover' && lastGameState !== 'gameover') {
                    window.notifyGameOver();
                }
                lastGameState = currentState;
            }
        }, 100);
    }

    window.sendBoardData = function() {
        if (!isMatchActive || !conn || !conn.open) return;
        conn.send({
            type: 'BOARD_UPDATE',
            board: board,
            currentPuyo: typeof currentPuyo !== 'undefined' ? currentPuyo : null,
            gameState: typeof gameState !== 'undefined' ? gameState : 'playing',
            // 自分のおじゃまスタック数値を送信
            garbageStack: typeof myGarbageStack !== 'undefined' ? myGarbageStack : 0
        });
    };

    window.notifyGameOver = function() {
        if (isMatchActive && conn && conn.open) {
            conn.send({ type: 'OPPONENT_LOST' });
            endMatchWithWinner(false);
        }
    };

    function endMatchWithWinner(iWon) {
        if (iWon) myWins++; else oppWins++;
        updateWinCountDisplay();
        
        if (myWins >= winTarget || oppWins >= winTarget) {
            const msg = myWins >= winTarget ? 'シリーズ勝利！' : 'シリーズ敗北...';
            setTimeout(() => {
                alert(msg);
                location.reload();
            }, 500);
        } else {
            setTimeout(() => {
                if (window.resetGame) window.resetGame();
                if (isHost) setTimeout(syncNextPuyos, 500);
            }, 1500);
        }
    }

    function updateWinCountDisplay() {
        const el = document.getElementById('win-count-display');
        if (el) el.textContent = `${myWins} - ${oppWins}`;
    }

    function updateOpponentBoard(oppBoard, oppCurrentPuyo, oppGameState) {
        for (let y = 0; y < 14; y++) {
            for (let x = 0; x < 6; x++) {
                const cell = document.getElementById(`opp-cell-${x}-${y}`);
                if (!cell) continue;
                const puyo = cell.firstChild;
                let color = oppBoard[y][x];
                if (oppGameState === 'playing' && oppCurrentPuyo) {
                    const { mainX, mainY, rotation, mainColor, subColor } = oppCurrentPuyo;
                    let sx = mainX, sy = mainY;
                    if (rotation === 0) sy++; else if (rotation === 1) sx--; else if (rotation === 2) sy--; else if (rotation === 3) sx++;
                    if (x === mainX && y === mainY) color = mainColor;
                    if (x === sx && y === sy) color = subColor;
                }
                const colors = ['transparent', '#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#888'];
                puyo.style.backgroundColor = colors[color] || 'transparent';
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initOnlineUI);
    } else {
        initOnlineUI();
    }
})();
