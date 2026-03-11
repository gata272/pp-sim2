/* online.js (新バージョン puyoSim.js 対応版) */
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

    // --- 盤面監視用変数 ---
    let lastBoardJson = "";
    let lastGameState = "";
    let monitorInterval = null;

    // グローバル関数
    window.isMatchActive = false; // puyoSim.js から参照される
    window.notifyGameOverToOpponent = function() {
        if (conn && conn.open && window.isMatchActive) {
            conn.send({ type: 'GAME_OVER' });
            console.log('自分：ゲームオーバーを相手に通知しました。');
            // 自分の盤面をリセットし、次のラウンドの準備をする
            // puyoSim.js の resetGame() を呼び出す前に、online.js 側で必要な処理を行う
            // 例: スコア更新、次のラウンド開始メッセージ表示など
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
            // 対戦中であれば監視を開始
            startMonitoring();
        });
        conn.on('data', (data) => { handleReceivedData(data); });
        conn.on('close', () => {
            alert('対戦相手との接続が切れました。');
            endMatch();
        });
        conn.on('error', (err) => {
            alert('接続エラーが発生しました: ' + err.type);
        });
    }

    function handleReceivedData(data) {
        switch(data.type) {
            case 'PROPOSE_MATCH': showApprovalUI(data.winTarget); break;
            case 'GAME_OVER':
                console.log('相手からゲームオーバー通知を受信しました。');
                endRound(true); // 相手がゲームオーバーなので自分が勝利
                break;
            case 'ACCEPT_MATCH': startMatch(data.winTarget); break;
            case 'BOARD_UPDATE':
                updateOpponentBoard(data.board, data.currentPuyo, data.gameState);
                oppScore = data.score || 0;
                oppChainCount = data.chainCount || 0;
                updateOpponentInfo();
                break;
            case 'SYNC_NEXT': 
                if (window.setNextPuyos) {
                    window.setNextPuyos(data.nextPuyos);
                } else if (typeof nextQueue !== 'undefined') {
                    // puyoSim.js に setNextPuyos がない場合の直接更新
                    nextQueue = JSON.parse(JSON.stringify(data.nextPuyos));
                    queueIndex = 0;
                    if (window.renderBoard) window.renderBoard();
                }
                break;
            case 'OPPONENT_LOST':
                endMatchWithWinner(true);
                break;
            case 'OPPONENT_SURRENDERED':
                showMatchResult('相手が降参しました！');
                endMatch();
                break;
            case 'ROUND_START':
                console.log('相手からラウンド開始通知を受信しました。');
                window.initializeGame();
                window.generateNewPuyo();
                window.startPuyoDropLoop();
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
                ${[1,2,3,4,5,6,7,8,9,10].map(n => `<option value="${n}">${n}本先取</option>`).join('')}
            </select>
        `;
        actions.innerHTML = `
            <button class="online-btn" onclick="proposeMatch()">提案を送る</button>
            <button class="online-btn secondary" onclick="hideOnlineOverlay()">キャンセル</button>
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
        window.isMatchActive = true;
        const proposalOverlay = document.getElementById('match-proposal-overlay');
        if (proposalOverlay) proposalOverlay.style.display = 'none';
        document.body.classList.add('online-match-active');
        ensureSurrenderButton();
        
        // puyoSim.js の関数呼び出し（存在する場合のみ）
        if (window.updateGravityWait) window.updateGravityWait(300);
        if (window.updateChainWait) window.updateChainWait(300);
        if (typeof autoDropEnabled !== 'undefined' && !autoDropEnabled) {
            if (window.toggleAutoDrop) window.toggleAutoDrop();
        }
        if (window.resetGame) window.initializeGame();
        
        updateWinCountDisplay();
        if (isHost) setTimeout(() => syncNextPuyos(), 500);
        
        // 盤面監視を開始
        startMonitoring();
    }

    // --- 盤面監視ロジック (puyoSim.js を変更しないための追加) ---
    function startMonitoring() {
        if (monitorInterval) clearInterval(monitorInterval);
        lastBoardJson = "";
        lastGameState = "";
        monitorInterval = setInterval(() => {
            if (!isMatchActive || !conn || !conn.open) {
                clearInterval(monitorInterval);
                return;
            }

            // 1. 盤面データの変化を監視して送信
            if (typeof board !== 'undefined') {
                const currentBoardJson = JSON.stringify(board);
                const currentPuyoJson = typeof currentPuyo !== 'undefined' ? JSON.stringify(currentPuyo) : "null";
                const currentScore = typeof score !== 'undefined' ? score : 0;
                const currentChain = typeof chainCount !== 'undefined' ? chainCount : 0;
                const currentState = typeof gameState !== 'undefined' ? gameState : 'playing';

                // 盤面、操作ぷよ、スコア、連鎖、状態のいずれかが変わったら送信
                const combinedState = currentBoardJson + currentPuyoJson + currentScore + currentChain + currentState;
                
                if (combinedState !== lastBoardJson) {
                    window.sendBoardData();
                    lastBoardJson = combinedState;
                }

                // 2. ゲームオーバーを検知して通知
                if (currentState === 'gameover' && lastGameState !== 'gameover') {
                    window.notifyGameOver();
                }
                lastGameState = currentState;
            }
        }, 100); // 100ms ごとにチェック
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
        // 新バージョンの nextQueue を優先的に参照
        let currentNext = null;
        if (typeof nextQueue !== 'undefined') {
            currentNext = nextQueue;
        } else if (typeof nextPuyoColors !== 'undefined') {
            currentNext = nextPuyoColors;
        }

        if (currentNext && conn && conn.open) {
            conn.send({ type: 'SYNC_NEXT', nextPuyos: currentNext });
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
        } catch (err) { console.error('Failed to send board data:', err); }
    };

    window.notifyGameOver = function() {
        if (isMatchActive && conn && conn.open) {
            conn.send({ type: 'OPPONENT_LOST' });
            endMatchWithWinner(false);
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
            setTimeout(() => {
                if (window.resetGame) window.initializeGame();
                if (isHost) setTimeout(() => syncNextPuyos(), 500);
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
        actions.innerHTML = `<button class="online-btn" onclick="location.reload()">終了</button>`;
    }

    function endRound(iWon) {
        if (!isMatchActive) return;

        if (iWon) {
            myWins++;
            console.log(`自分：ラウンド勝利！ 現在のスコア: ${myWins}-${oppWins}`);
        } else {
            oppWins++;
            console.log(`相手：ラウンド勝利！ 現在のスコア: ${myWins}-${oppWins}`);
        }
        updateWinCountDisplay();

        if (myWins >= winTarget || oppWins >= winTarget) {
            // シリーズ終了
            showMatchResult(myWins >= winTarget ? 'シリーズ勝利！' : 'シリーズ敗北...');
            endMatch();
        } else {
            // 次のラウンドへ
            console.log('次のラウンドを開始します。');
            window.initializeGame(); // puyoSim.js のリセット関数を呼び出す
            window.generateNewPuyo(); // 新しいぷよを生成
            window.startPuyoDropLoop(); // 自動落下を再開
            // 必要に応じて、オンライン対戦用の初期化処理を追加
            if (conn && conn.open) {
                conn.send({ type: 'ROUND_START' }); // 相手にラウンド開始を通知
            }
        }
    }

    function endMatch() {
        isMatchActive = false;
        if (monitorInterval) clearInterval(monitorInterval);
        document.body.classList.remove('online-match-active');
        const surrenderBtn = document.getElementById('surrender-button');
        if (surrenderBtn) surrenderBtn.style.display = 'none';
    }

    // puyoSim.js から呼ばれることを期待されている関数の代替実装
    window.setNextPuyos = function(newNext) {
        if (typeof nextQueue !== 'undefined') {
            nextQueue = JSON.parse(JSON.stringify(newNext));
            queueIndex = 0;
            if (window.renderBoard) window.renderBoard();
        } else if (typeof nextPuyoColors !== 'undefined') {
            nextPuyoColors = JSON.parse(JSON.stringify(newNext));
            if (window.renderBoard) window.renderBoard();
        }
    };

    function autoInitPeer() {
        if (!peerInitialized && !peerInitializing) initPeer();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { initOnlineUI(); autoInitPeer(); });
    } else {
        initOnlineUI(); autoInitPeer();
    }
})();