/* online.js */
(function() {
    let peer = null;
    let conn = null;
    let myId = '';
    let isHost = false;
    let winTarget = 0;  // 何本先取か
    let myWins = 0;
    let oppWins = 0;
    let isMatchActive = false;
    let peerInitialized = false;
    let peerInitializing = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 3;
    
    // 相手の情報
    let oppScore = 0;
    let oppChainCount = 0;

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
        const count = parseInt(document.getElementById('match-win-target-select').value);
        if (conn && conn.open) {
            conn.send({ type: 'PROPOSE_MATCH', winTarget: count });
            document.getElementById('proposal-content').innerHTML = `<p>${count}本先取の提案を送信しました。相手の承認を待っています...</p>`;
            document.getElementById('proposal-actions').innerHTML = '';
        }
    };

    window.acceptMatch = function(target) {
        if (conn && conn.open) {
            conn.send({ type: 'ACCEPT_MATCH', winTarget: target });
            startMatch(target);
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

    window.surrenderMatch = function() {
        if (isMatchActive && conn && conn.open) {
            if (confirm('対戦を降参しますか？')) {
                conn.send({ type: 'OPPONENT_SURRENDERED' });
                endMatchWithWinner(false);
            }
        }
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

        // リザルトオーバーレイの作成（存在しない場合のみ）
        if (!document.getElementById('match-result-overlay')) {
            const resultOverlay = document.createElement('div');
            resultOverlay.id = 'match-result-overlay';
            resultOverlay.innerHTML = `
                <div class="online-box">
                    <h2 id="result-title">対戦終了</h2>
                    <div id="result-content" style="margin: 20px 0; font-size: 1.1em;"></div>
                    <div id="result-actions" style="margin-top: 15px;"></div>
                </div>
            `;
            document.body.appendChild(resultOverlay);
        }

        // 勝利数枠の作成（存在しない場合のみ）
        if (!document.getElementById('win-count-container')) {
            const playStatsInfo = document.getElementById('play-stats-info');
            if (playStatsInfo) {
                const winContainer = document.createElement('div');
                winContainer.id = 'win-count-container';
                winContainer.className = 'stat-item';
                winContainer.innerHTML = `
                    <span class="stat-label">勝利数</span>
                    <span id="win-count-display" class="stat-value">0 - 0</span>
                `;
                // 連鎖数表示の後に挿入
                playStatsInfo.appendChild(winContainer);
            }
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
                    <div id="opponent-info" style="margin-top: 8px; display: flex; justify-content: space-around; font-size: 0.85em; color: #aaa;">
                        <div>スコア: <span id="opp-score">0</span></div>
                        <div>連鎖: <span id="opp-chain">0</span></div>
                    </div>
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
                    // alertは出さない
                } else if (err.type === 'disconnected') {
                    document.getElementById('online-status').textContent = 'サーバーから切断されました。再接続中...';
                    setTimeout(() => {
                        if (!peerInitialized) initPeer();
                    }, 2000);
                } else if (err.type === 'network') {
                    document.getElementById('online-status').textContent = 'ネットワークエラーが発生しました。';
                    // alertは出さない
                } else {
                    document.getElementById('online-status').textContent = `エラー: ${err.type}`;
                    // alertは出さない
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
                showApprovalUI(data.winTarget);
                break;
            case 'ACCEPT_MATCH':
                startMatch(data.winTarget);
                break;
            case 'BOARD_UPDATE':
                updateOpponentBoard(data.board, data.currentPuyo, data.gameState);
                oppScore = data.score || 0;
                oppChainCount = data.chainCount || 0;
                updateOpponentInfo();
                break;
            case 'SYNC_NEXT':
                if (window.setNextPuyos) window.setNextPuyos(data.nextPuyos);
                break;
            case 'OPPONENT_LOST':
                endMatchWithWinner(true);
                break;
            case 'OPPONENT_SURRENDERED':
                endMatchWithWinner(true);
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
            <p>何本先取にしますか？</p>
            <select id="match-win-target-select" style="width: 100%; padding: 10px; margin-bottom: 10px; background: #222; color: white; border: 1px solid #444; border-radius: 5px;">
                <option value="1">1本先取</option>
                <option value="2">2本先取</option>
                <option value="3">3本先取</option>
                <option value="4">4本先取</option>
                <option value="5">5本先取</option>
                <option value="6">6本先取</option>
                <option value="7">7本先取</option>
                <option value="8">8本先取</option>
                <option value="9">9本先取</option>
                <option value="10">10本先取</option>
            </select>
        `;
        actions.innerHTML = `
            <button class="online-btn" onclick="proposeMatch()">提案を送る</button>
        `;
    }

    function showApprovalUI(target) {
        const overlay = document.getElementById('match-proposal-overlay');
        const content = document.getElementById('proposal-content');
        const actions = document.getElementById('proposal-actions');
        
        if (!overlay) return;
        
        overlay.style.display = 'flex';
        document.getElementById('proposal-title').textContent = '対戦の誘い';
        content.innerHTML = `<p>相手から <strong>${target}本先取</strong> の対戦提案が届きました。</p>`;
        actions.innerHTML = `
            <button class="online-btn" onclick="acceptMatch(${target})">承認して開始</button>
            <button class="online-btn secondary" onclick="rejectMatch()">拒否</button>
        `;
    }

    function startMatch(target) {
        winTarget = target;
        myWins = 0;
        oppWins = 0;
        oppScore = 0;
        oppChainCount = 0;
        isMatchActive = true;
        document.getElementById('match-proposal-overlay').style.display = 'none';
        document.body.classList.add('online-match-active');

        // 降参ボタンを表示
        ensureSurrenderButton();

        // シミュレーターの設定を強制
        if (window.updateGravityWait) window.updateGravityWait(300);
        if (window.updateChainWait) window.updateChainWait(300);
        
        // 自動落下を強制ON
        if (typeof autoDropEnabled !== 'undefined' && !autoDropEnabled) {
            if (window.toggleAutoDrop) window.toggleAutoDrop();
        }

        // 盤面リセット
        if (window.resetGame) window.resetGame();

        // 勝利数表示更新
        updateWinCountDisplay();

        // ホストならネクストを生成して同期
        if (isHost) {
            setTimeout(() => syncNextPuyos(), 500);
        }
    }

    function ensureSurrenderButton() {
        let surrenderBtn = document.getElementById('surrender-button');
        if (!surrenderBtn) {
            const playControls = document.getElementById('play-controls');
            if (playControls) {
                surrenderBtn = document.createElement('button');
                surrenderBtn.id = 'surrender-button';
                surrenderBtn.onclick = window.surrenderMatch;
                surrenderBtn.style.cssText = 'width: 100%; padding: 8px; border: none; border-radius: 5px; font-size: 0.85em; font-weight: bold; background-color: #d9534f; color: white; margin-top: 5px; display: none;';
                surrenderBtn.textContent = '降参';
                playControls.appendChild(surrenderBtn);
            }
        }
        if (surrenderBtn) surrenderBtn.style.display = 'block';
    }

    function updateWinCountDisplay() {
        const winDisplay = document.getElementById('win-count-display');
        if (winDisplay) {
            winDisplay.textContent = `${myWins} - ${oppWins}`;
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
                    gameState: typeof gameState !== 'undefined' ? gameState : 'playing',
                    score: typeof score !== 'undefined' ? score : 0,
                    chainCount: typeof chainCount !== 'undefined' ? chainCount : 0
                });
            }
        } catch (err) {
            console.error('Failed to send board data:', err);
        }
    };

    window.notifyGameOver = function() {
        if (isMatchActive && conn && conn.open) {
            conn.send({ type: 'OPPONENT_LOST' });
            endMatchWithWinner(true);
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

    function updateOpponentInfo() {
        const scoreSpan = document.getElementById('opp-score');
        const chainSpan = document.getElementById('opp-chain');
        if (scoreSpan) scoreSpan.textContent = oppScore;
        if (chainSpan) chainSpan.textContent = oppChainCount;
    }

    function endMatchWithWinner(iWon) {
        if (iWon) {
            myWins++;
        } else {
            oppWins++;
        }

        updateWinCountDisplay();

        if (myWins >= winTarget) {
            showMatchResult('シリーズ勝利！');
            endMatch();
        } else if (oppWins >= winTarget) {
            showMatchResult('シリーズ敗北...');
            endMatch();
        } else {
            // 次の試合へ
            setTimeout(() => {
                if (window.resetGame) window.resetGame();
                if (isHost) {
                    setTimeout(() => syncNextPuyos(), 500);
                }
            }, 2000);
        }
    }

    function showMatchResult(message) {
        const overlay = document.getElementById('match-result-overlay');
        const content = document.getElementById('result-content');
        const actions = document.getElementById('result-actions');
        
        if (!overlay) return;
        
        overlay.style.display = 'flex';
        content.innerHTML = `
            <p>${message}</p>
            <p style="font-size: 1.2em; margin-top: 10px;">最終スコア: ${myWins} - ${oppWins}</p>
        `;
        actions.innerHTML = `
            <button class="online-btn" onclick="location.reload()">終了</button>
        `;
    }

    function endMatch() {
        isMatchActive = false;
        document.body.classList.remove('online-match-active');
        
        // 降参ボタンを非表示
        const surrenderBtn = document.getElementById('surrender-button');
        if (surrenderBtn) surrenderBtn.style.display = 'none';
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
