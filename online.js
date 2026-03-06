/* online.js */
(function() {
    let peer = null;
    let conn = null;
    let myId = '';
    let opponentId = '';
    let isHost = false;
    let matchCount = 0;
    let currentMatch = 0;
    let isMatchActive = false;
    let peerInitialized = false;
    let peerInitializing = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 3;

    // グローバル関数
    window.showOnlineOverlay = function() {
        const overlay = document.getElementById('online-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
            if (!peerInitialized && !peerInitializing) {
                initPeer();
            }
        }
    };

    window.hideOnlineOverlay = function() {
        const overlay = document.getElementById('online-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    };

    window.proposeMatch = function() {
        const count = parseInt(document.getElementById('match-count-select').value);
        if (conn && conn.open) {
            conn.send({ type: 'PROPOSE_MATCH', count: count });
            document.getElementById('proposal-content').innerHTML = `<p>${count}試合先取の提案を送信しました。相手の承認を待っています...</p>`;
            document.getElementById('proposal-actions').innerHTML = '';
        }
    };

    window.acceptMatch = function(count) {
        if (conn && conn.open) {
            conn.send({ type: 'ACCEPT_MATCH', count: count });
            startMatch(count);
        }
    };

    window.rejectMatch = function() {
        document.getElementById('match-proposal-overlay').style.display = 'none';
    };

    window.connectToOpponent = function() {
        const targetId = document.getElementById('opponent-id-input').value.trim();
        if (!targetId) {
            alert('相手のIDを入力してください');
            return;
        }
        
        if (!peer || !myId) {
            alert('PeerJSがまだ初期化されていません。少々お待ちください。');
            return;
        }

        if (conn && conn.open) {
            alert('既に接続済みです');
            return;
        }

        document.getElementById('online-status').textContent = '接続中...';
        reconnectAttempts = 0;
        attemptConnection(targetId);
    };

    function attemptConnection(targetId) {
        try {
            conn = peer.connect(targetId, { reliable: true });
            setupConnection();
            isHost = false;
        } catch (err) {
            console.error('Connection attempt failed:', err);
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                document.getElementById('online-status').textContent = `接続中... (再試行 ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`;
                setTimeout(() => attemptConnection(targetId), 1000);
            } else {
                document.getElementById('online-status').textContent = '接続失敗。もう一度お試しください。';
                alert('接続に失敗しました。相手のIDが正しいか確認してください。');
            }
        }
    }

    function initOnlineUI() {
        // オーバーレイの作成（存在しない場合のみ）
        if (!document.getElementById('online-overlay')) {
            const overlay = document.createElement('div');
            overlay.id = 'online-overlay';
            overlay.innerHTML = `
                <div class="online-box">
                    <h2>オンライン対戦</h2>
                    <div id="online-status">PeerJSを初期化中...</div>
                    <div id="my-id-display" style="margin: 10px 0; font-size: 0.9em; color: #aaa;">
                        あなたのID: <span id="my-peer-id" style="color: #fff; font-weight: bold;">----</span>
                    </div>
                    <input type="text" id="opponent-id-input" placeholder="相手のIDを入力">
                    <button class="online-btn" onclick="connectToOpponent()">接続する</button>
                    <button class="online-btn secondary" onclick="hideOnlineOverlay()">キャンセル</button>
                </div>
            `;
            document.body.appendChild(overlay);
        }

        // マッチ提案オーバーレイの作成（存在しない場合のみ）
        if (!document.getElementById('match-proposal-overlay')) {
            const proposalOverlay = document.createElement('div');
            proposalOverlay.id = 'match-proposal-overlay';
            proposalOverlay.innerHTML = `
                <div class="online-box">
                    <h2 id="proposal-title">対戦の提案</h2>
                    <div id="proposal-content"></div>
                    <div id="proposal-actions" style="margin-top: 15px;"></div>
                </div>
            `;
            document.body.appendChild(proposalOverlay);
        }

        // 相手の盤面コンテナの作成（存在しない場合のみ）
        if (!document.getElementById('opponent-board-container')) {
            const playStatsInfo = document.getElementById('play-stats-info');
            if (playStatsInfo) {
                const oppContainer = document.createElement('div');
                oppContainer.id = 'opponent-board-container';
                oppContainer.innerHTML = `
                    <h3>相手の盤面</h3>
                    <div id="opponent-board"></div>
                `;
                playStatsInfo.appendChild(oppContainer);
                createOpponentBoardDOM();
            }
        }
    }

    function createOpponentBoardDOM() {
        const boardElement = document.getElementById('opponent-board');
        if (!boardElement) return;
        boardElement.innerHTML = '';
        // 14x6の盤面作成
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

    function initPeer() {
        if (peerInitialized || peerInitializing) return;
        
        peerInitializing = true;
        
        try {
            peer = new Peer({
                debug: 0,
                config: {
                    iceServers: [
                        { urls: ['stun:stun.l.google.com:19302'] },
                        { urls: ['stun:stun1.l.google.com:19302'] },
                        { urls: ['stun:stun2.l.google.com:19302'] }
                    ]
                }
            });

            peer.on('open', (id) => {
                myId = id;
                peerInitialized = true;
                peerInitializing = false;
                document.getElementById('my-peer-id').textContent = id;
                document.getElementById('online-status').textContent = '接続待機中...';
                console.log('PeerJS initialized with ID:', id);
            });

            peer.on('connection', (connection) => {
                if (conn && conn.open) {
                    connection.close();
                    return;
                }
                conn = connection;
                setupConnection();
                isHost = true;
                showMatchProposal();
            });

            peer.on('error', (err) => {
                console.error('PeerJS Error:', err);
                peerInitializing = false;
                
                if (err.type === 'unavailable-id') {
                    document.getElementById('online-status').textContent = 'IDの生成に失敗しました。ページをリロードしてください。';
                    alert('PeerJSサーバーに接続できません。ページをリロードしてお試しください。');
                } else if (err.type === 'disconnected') {
                    document.getElementById('online-status').textContent = 'サーバーから切断されました。再接続中...';
                    setTimeout(() => {
                        if (!peerInitialized) initPeer();
                    }, 2000);
                } else {
                    document.getElementById('online-status').textContent = `エラー: ${err.type}`;
                    alert(`接続エラーが発生しました: ${err.type}`);
                }
            });

            peer.on('disconnected', () => {
                console.warn('Peer disconnected');
                peerInitialized = false;
                document.getElementById('online-status').textContent = 'サーバーから切断されました。再接続中...';
                setTimeout(() => {
                    if (!peerInitialized && peer) {
                        peer.reconnect();
                    }
                }, 2000);
            });

        } catch (err) {
            console.error('Failed to initialize Peer:', err);
            peerInitializing = false;
            document.getElementById('online-status').textContent = 'PeerJSの初期化に失敗しました。';
            alert('PeerJSの初期化に失敗しました: ' + err.message);
        }
    }

    function setupConnection() {
        conn.on('open', () => {
            console.log('Connection established');
            window.hideOnlineOverlay();
            document.getElementById('online-status').textContent = '接続済み';
            if (isHost) {
                showMatchProposal();
            }
        });

        conn.on('data', (data) => {
            handleReceivedData(data);
        });

        conn.on('close', () => {
            console.warn('Connection closed');
            alert('対戦相手との接続が切れました。');
            endMatch();
            conn = null;
        });

        conn.on('error', (err) => {
            console.error('Connection error:', err);
            alert('接続エラーが発生しました: ' + err.type);
        });
    }

    function handleReceivedData(data) {
        switch(data.type) {
            case 'PROPOSE_MATCH':
                showApprovalUI(data.count);
                break;
            case 'ACCEPT_MATCH':
                startMatch(data.count);
                break;
            case 'BOARD_UPDATE':
                updateOpponentBoard(data.board, data.currentPuyo, data.gameState);
                break;
            case 'SYNC_NEXT':
                if (window.setNextPuyos) window.setNextPuyos(data.nextPuyos);
                break;
        }
    }

    function showMatchProposal() {
        const overlay = document.getElementById('match-proposal-overlay');
        const content = document.getElementById('proposal-content');
        const actions = document.getElementById('proposal-actions');
        
        if (!overlay) return;
        
        overlay.style.display = 'flex';
        document.getElementById('proposal-title').textContent = '対戦設定';
        content.innerHTML = `
            <p>試合数を選択してください</p>
            <select id="match-count-select" style="width: 100%; padding: 10px; margin-bottom: 10px; background: #222; color: white; border: 1px solid #444; border-radius: 5px;">
                <option value="1">1試合先取</option>
                <option value="3">3試合先取</option>
                <option value="5">5試合先取</option>
                <option value="10">10試合先取</option>
            </select>
        `;
        actions.innerHTML = `
            <button class="online-btn" onclick="proposeMatch()">提案を送る</button>
        `;
    }

    function showApprovalUI(count) {
        const overlay = document.getElementById('match-proposal-overlay');
        const content = document.getElementById('proposal-content');
        const actions = document.getElementById('proposal-actions');
        
        if (!overlay) return;
        
        overlay.style.display = 'flex';
        document.getElementById('proposal-title').textContent = '対戦の誘い';
        content.innerHTML = `<p>相手から <strong>${count}試合先取</strong> の対戦提案が届きました。</p>`;
        actions.innerHTML = `
            <button class="online-btn" onclick="acceptMatch(${count})">承認して開始</button>
            <button class="online-btn secondary" onclick="rejectMatch()">拒否</button>
        `;
    }

    function startMatch(count) {
        matchCount = count;
        isMatchActive = true;
        document.getElementById('match-proposal-overlay').style.display = 'none';
        document.body.classList.add('online-match-active');

        // シミュレーターの設定を強制
        if (window.updateGravityWait) window.updateGravityWait(300);
        if (window.updateChainWait) window.updateChainWait(300);
        
        // 自動落下を強制ON
        if (typeof autoDropEnabled !== 'undefined' && !autoDropEnabled) {
            if (window.toggleAutoDrop) window.toggleAutoDrop();
        }

        // 盤面リセット
        if (window.resetGame) window.resetGame();

        // ホストならネクストを生成して同期
        if (isHost) {
            setTimeout(() => syncNextPuyos(), 500);
        }
    }

    function syncNextPuyos() {
        if (typeof nextPuyoColors !== 'undefined' && conn && conn.open) {
            conn.send({ type: 'SYNC_NEXT', nextPuyos: nextPuyoColors });
        }
    }

    window.sendBoardData = function() {
        if (!isMatchActive || !conn || !conn.open) return;
        
        try {
            if (typeof board !== 'undefined') {
                conn.send({
                    type: 'BOARD_UPDATE',
                    board: board,
                    currentPuyo: typeof currentPuyo !== 'undefined' ? currentPuyo : null,
                    gameState: typeof gameState !== 'undefined' ? gameState : 'playing'
                });
            }
        } catch (err) {
            console.error('Failed to send board data:', err);
        }
    };

    function updateOpponentBoard(oppBoard, oppCurrentPuyo, oppGameState) {
        for (let y = 0; y < 14; y++) {
            for (let x = 0; x < 6; x++) {
                const cell = document.getElementById(`opp-cell-${x}-${y}`);
                if (!cell) continue;
                const puyo = cell.firstChild;
                if (!puyo) continue;
                
                let color = oppBoard[y][x];
                
                // 操作中のぷよの描画
                if (oppGameState === 'playing' && oppCurrentPuyo) {
                    const { mainX, mainY, rotation, mainColor, subColor } = oppCurrentPuyo;
                    let subX = mainX, subY = mainY;
                    if (rotation === 0) subY = mainY + 1;
                    if (rotation === 1) subX = mainX - 1;
                    if (rotation === 2) subY = mainY - 1;
                    if (rotation === 3) subX = mainX + 1;

                    if ((x === mainX && y === mainY)) color = mainColor;
                    if ((x === subX && y === subY)) color = subColor;
                }

                puyo.className = `puyo puyo-${color}`;
            }
        }
    }

    function endMatch() {
        isMatchActive = false;
        document.body.classList.remove('online-match-active');
    }

    // puyoSim.js へのフック
    window.setNextPuyos = function(newNext) {
        if (typeof nextPuyoColors !== 'undefined') {
            nextPuyoColors = JSON.parse(JSON.stringify(newNext));
            if (window.renderBoard) window.renderBoard();
        }
    };

    // ページ読み込み時に自動初期化開始
    function autoInitPeer() {
        if (!peerInitialized && !peerInitializing) {
            console.log('Auto-initializing PeerJS on page load');
            initPeer();
        }
    }

    // 初期化実行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initOnlineUI();
            autoInitPeer();
        });
    } else {
        initOnlineUI();
        autoInitPeer();
    }
})();
