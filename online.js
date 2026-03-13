// online.js
(function() {
    let peer = null;
    let conn = null;
    let myId = "";
    let isHost = false;
    let winTarget = 0;  // 何本先取か
    let myWins = 0;
    let oppWins = 0;
    let isMatchActive = false;
    let originalAlert = window.alert; // 元のalert関数を保存

    let peerInitialized = false;
    let peerInitializing = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 3;
    
    // 相手の情報
    let oppScore = 0;
    let oppChainCount = 0;

    // --- 盤面監視用変数 ---
    let lastBoardJson = "";
    let lastGameState = "";
    let monitorInterval = null;

    // puyoSim.js から参照されるグローバル変数
    window.isMatchActive = false; 

    // ゲームオーバー時にpuyoSim.jsから呼び出される関数
    window.notifyGameOverToOpponent = function() {
        if (conn && conn.open && window.isMatchActive) {
            conn.send({ type: 'GAME_OVER' });
            console.log('自分：ゲームオーバーを相手に通知しました。');
            endRound(false); // 自分がゲームオーバーなので敗北
        }
    };

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
        const overlay = document.getElementById('match-proposal-overlay');
        if (overlay) overlay.style.display = 'none';
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
            if (confirm('対戦を降参しますか？（シリーズ敗北となります）')) {
                conn.send({ type: 'OPPONENT_SURRENDERED' });
                showMatchResult('シリーズ敗北...');
                endMatch();
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
                playStatsInfo.appendChild(winContainer);
            }
        }

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
                document.getElementById('online-status').textContent = `エラー: ${err.type}`;
            });
            peer.on('disconnected', () => {
                peerInitialized = false;
                document.getElementById('online-status').textContent = 'サーバーから切断されました。再接続中...';
                setTimeout(() => { if (!peerInitialized && peer) peer.reconnect(); }, 2000);
            });
        } catch (err) {
            console.error('Failed to initialize Peer:', err);
            peerInitializing = false;
        }
    }

    function setupConnection() {
        conn.on('open', () => {
            window.hideOnlineOverlay();
            document.getElementById('online-status').textContent = '接続済み';
            if (isHost) showMatchProposal();
            // 対戦中の盤面状態を監視し、相手に送信
            startMonitor();
        });
        conn.on('data', (data) => {
            handleReceivedData(data);
        });
        conn.on('close', () => {
            console.log('相手との接続が切れました。');
            document.getElementById('online-status').textContent = '切断されました';
            stopMonitor();
            if (isMatchActive) {
                showMatchResult('相手が切断しました。');
                endMatch();
            }
        });
        conn.on('error', (err) => {
            console.error('Connection Error:', err);
            document.getElementById('online-status').textContent = `接続エラー: ${err.type}`;
            stopMonitor();
            if (isMatchActive) {
                showMatchResult('接続エラーが発生しました。');
                endMatch();
            }
        });
    }

    function startMonitor() {
        if (monitorInterval) clearInterval(monitorInterval);
        monitorInterval = setInterval(() => {
            if (conn && conn.open && window.isMatchActive) {
                // puyoSim.js の現在の盤面と状態を取得
                // puyoSim.js の変数がグローバルスコープにあることを前提とする
                const currentBoard = window.board; 
                const currentNextQueue = window.nextQueue; 
                const currentQueueIndex = window.queueIndex; 
                const currentScore = window.score; 
                const currentChainCount = window.chainCount; 
                const currentGameState = window.gameState; 

                const boardJson = JSON.stringify(currentBoard);
                // gameStateがplayingまたはchainingの場合のみ送信
                if (boardJson !== lastBoardJson || currentGameState !== lastGameState) {
                    conn.send({
                        type: 'BOARD_UPDATE',
                        board: currentBoard,
                        nextQueue: currentNextQueue,
                        queueIndex: currentQueueIndex,
                        score: currentScore,
                        chainCount: currentChainCount,
                        gameState: currentGameState
                    });
                    lastBoardJson = boardJson;
                    lastGameState = currentGameState;
                }
            }
        }, 100); // 100msごとに監視
    }

    function stopMonitor() {
        if (monitorInterval) {
            clearInterval(monitorInterval);
            monitorInterval = null;
        }
    }

    function handleReceivedData(data) {
        switch (data.type) {
            case 'BOARD_UPDATE':
                renderOpponentBoard(data.board);
                oppScore = data.score;
                oppChainCount = data.chainCount;
                updateOpponentUI();
                break;
            case 'PROPOSE_MATCH':
                showMatchProposal(data.winTarget, conn.peer);
                break;
            case 'ACCEPT_MATCH':
                startMatch(data.winTarget);
                break;
            case 'GAME_OVER':
                console.log('相手：ゲームオーバーを通知されました。');
                endRound(true); // 相手がゲームオーバーなので勝利
                break;
            case 'OPPONENT_SURRENDERED':
                showMatchResult('相手が降参しました！');
                endMatch();
                break;
            case 'ROUND_START':
                console.log('相手からラウンド開始通知を受信しました。');
                // puyoSim.js の初期化関数を呼び出す
                if (typeof window.initializeGame === 'function') window.initializeGame();
                if (typeof window.generateNewPuyo === 'function') window.generateNewPuyo();
                if (typeof window.startPuyoDropLoop === 'function') window.startPuyoDropLoop();
                break;
        }
    }

    function renderOpponentBoard(boardData) {
        for (let y = 0; y < 14; y++) {
            for (let x = 0; x < 6; x++) {
                const cellElement = document.getElementById(`opp-cell-${x}-${y}`);
                if (cellElement) {
                    const puyoElement = cellElement.firstChild;
                    const color = boardData[y][x];
                    puyoElement.className = 'puyo puyo-' + color;
                }
            }
        }
    }

    function updateOpponentUI() {
        document.getElementById('opp-score').textContent = oppScore;
        document.getElementById('opp-chain').textContent = oppChainCount;
    }

    function showMatchProposal(winTarget = 0, opponentId = '') {
        const overlay = document.getElementById('match-proposal-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
            if (winTarget > 0) {
                // 相手からの提案
                document.getElementById('proposal-title').textContent = '対戦の提案';
                document.getElementById('proposal-content').innerHTML = `<p>相手 (${opponentId}) から ${winTarget}本先取の対戦が提案されました。</p>`;
                document.getElementById('proposal-actions').innerHTML = `
                    <button class="online-btn" onclick="acceptMatch(${winTarget})">承認</button>
                    <button class="online-btn secondary" onclick="rejectMatch()">拒否</button>
                `;
            } else {
                // 自分の提案UI
                document.getElementById('proposal-title').textContent = '対戦を提案';
                document.getElementById('proposal-content').innerHTML = `
                    <p>何本先取にしますか？</p>
                    <select id="match-win-target-select">
                        <option value="1">1本先取</option>
                        <option value="3">3本先取</option>
                        <option value="5">5本先取</option>
                    </select>
                `;
                document.getElementById('proposal-actions').innerHTML = `
                    <button class="online-btn" onclick="proposeMatch()">提案する</button>
                    <button class="online-btn secondary" onclick="rejectMatch()">キャンセル</button>
                `;
            }
        }
    }

    function showMatchResult(message) {
        const overlay = document.getElementById('match-result-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
            document.getElementById('result-title').textContent = '対戦結果';
            document.getElementById('result-content').textContent = message;
            document.getElementById('result-actions').innerHTML = `
                <button class="online-btn" onclick="hideMatchResult()">閉じる</button>
            `;
        }
    }

    window.hideMatchResult = function() {
        const overlay = document.getElementById('match-result-overlay');
        if (overlay) overlay.style.display = 'none';
    };

    function updateWinCountDisplay() {
        document.getElementById('win-count-display').textContent = `${myWins} - ${oppWins}`;
    }

    function startMatch(target) {
        winTarget = target;
        myWins = 0;
        oppWins = 0;
        isMatchActive = true;
        window.isMatchActive = true; // puyoSim.js から参照されるグローバル変数
        updateWinCountDisplay();
        document.getElementById("match-proposal-overlay").style.display = "none";
        document.getElementById("online-toggle-btn").textContent = "対戦中";
        document.getElementById("online-toggle-btn").disabled = true;
        document.getElementById("surrender-button").style.display = "block";

        // puyoSim.js のゲームを初期化
        if (typeof window.initializeGame === 'function') window.initializeGame();
        if (typeof window.generateNewPuyo === 'function') window.generateNewPuyo();
        if (typeof window.startPuyoDropLoop === 'function') window.startPuyoDropLoop();

        // online.js 側の初期化
        if (isHost) {
            setTimeout(() => syncNextPuyos(), 500); // ホストがNEXTを同期
        }

        // online.js 側のUI更新
        document.getElementById("online-status").textContent = "対戦中";

        // alertを一時的に上書き
        window.alert = function(message) {
            if (window.isMatchActive) {
                console.log("オンライン対戦中のアラートを抑制: " + message);
                // ここでアラートの代わりに、ゲーム内メッセージ表示などの処理を追加することも可能
            } else {
                originalAlert(message);
            }
        };
    }

    function endMatch() {
        isMatchActive = false;
        window.isMatchActive = false;
        document.getElementById("online-toggle-btn").textContent = "対戦";
        document.getElementById("online-toggle-btn").disabled = false;
        document.getElementById("surrender-button").style.display = "none";
        stopMonitor();
        // alertを元に戻す
        window.alert = originalAlert;
    }

    function endRound(isWinner) {
        if (isWinner) {
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
            // 次のラウンドへ
            console.log('次のラウンドを開始します。');
            // puyoSim.js の初期化関数を呼び出す
            if (typeof window.initializeGame === 'function') window.initializeGame();
            if (typeof window.generateNewPuyo === 'function') window.generateNewPuyo();
            if (typeof window.startPuyoDropLoop === 'function') window.startPuyoDropLoop();
            // 必要に応じて、オンライン対戦用の初期化処理を追加
            if (conn && conn.open) {
                conn.send({ type: 'ROUND_START' });
            }
        }
    }

    // DOMContentLoadedでUI初期化
    document.addEventListener('DOMContentLoaded', () => {
        initOnlineUI();
    });

})();
