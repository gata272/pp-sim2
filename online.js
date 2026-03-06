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

    // UI要素の初期化
    function initOnlineUI() {
        // オンラインボタンを既存のUIに追加
        const playControls = document.getElementById('play-controls');
        if (playControls) {
            const onlineBtn = document.createElement('button');
            onlineBtn.id = 'online-toggle-btn';
            onlineBtn.textContent = 'オンライン対戦';
            onlineBtn.style.width = '100%';
            onlineBtn.style.padding = '8px';
            onlineBtn.style.border = 'none';
            onlineBtn.style.borderRadius = '5px';
            onlineBtn.style.fontSize = '0.85em';
            onlineBtn.style.fontWeight = 'bold';
            onlineBtn.style.backgroundColor = '#457b9d';
            onlineBtn.style.color = 'white';
            onlineBtn.style.marginTop = '5px';
            onlineBtn.onclick = showOnlineOverlay;
            playControls.appendChild(onlineBtn);
        }

        // 相手の盤面コンテナをスコアの下に追加
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

        // オーバーレイの作成
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
                <button class="online-btn" id="connect-btn">接続する</button>
                <button class="online-btn secondary" onclick="hideOnlineOverlay()">キャンセル</button>
            </div>
        `;
        document.body.appendChild(overlay);

        // マッチ提案オーバーレイ
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

        document.getElementById('connect-btn').onclick = connectToOpponent;
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

    function showOnlineOverlay() {
        document.getElementById('online-overlay').style.display = 'flex';
        if (!peer) initPeer();
    }

    function hideOnlineOverlay() {
        document.getElementById('online-overlay').style.display = 'none';
    }

    function initPeer() {
        peer = new Peer();
        peer.on('open', (id) => {
            myId = id;
            document.getElementById('my-peer-id').textContent = id;
            document.getElementById('online-status').textContent = '接続待機中...';
        });

        peer.on('connection', (connection) => {
            if (conn) {
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
            alert('接続エラーが発生しました: ' + err.type);
        });
    }

    function connectToOpponent() {
        const targetId = document.getElementById('opponent-id-input').value.trim();
        if (!targetId) return;
        
        document.getElementById('online-status').textContent = '接続中...';
        conn = peer.connect(targetId);
        setupConnection();
        isHost = false;
    }

    function setupConnection() {
        conn.on('open', () => {
            hideOnlineOverlay();
            document.getElementById('online-status').textContent = '接続済み';
            if (!isHost) {
                // ゲスト側はホストからの提案を待つ
            }
        });

        conn.on('data', (data) => {
            handleReceivedData(data);
        });

        conn.on('close', () => {
            alert('対戦相手との接続が切れました。');
            endMatch();
            conn = null;
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
                // ネクストの同期（ホストからゲストへ）
                if (window.setNextPuyos) window.setNextPuyos(data.nextPuyos);
                break;
        }
    }

    function showMatchProposal() {
        const overlay = document.getElementById('match-proposal-overlay');
        const content = document.getElementById('proposal-content');
        const actions = document.getElementById('proposal-actions');
        
        overlay.style.display = 'flex';
        document.getElementById('proposal-title').textContent = '対戦設定';
        content.innerHTML = `
            <p>試合数を選択してください</p>
            <select id="match-count-select" style="width: 100%; padding: 10px; margin-bottom: 10px;">
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

    window.proposeMatch = function() {
        const count = parseInt(document.getElementById('match-count-select').value);
        conn.send({ type: 'PROPOSE_MATCH', count: count });
        document.getElementById('proposal-content').innerHTML = `<p>${count}試合先取の提案を送信しました。相手の承認を待っています...</p>`;
        document.getElementById('proposal-actions').innerHTML = '';
    };

    function showApprovalUI(count) {
        const overlay = document.getElementById('match-proposal-overlay');
        const content = document.getElementById('proposal-content');
        const actions = document.getElementById('proposal-actions');
        
        overlay.style.display = 'flex';
        document.getElementById('proposal-title').textContent = '対戦の誘い';
        content.innerHTML = `<p>相手から <strong>${count}試合先取</strong> の対戦提案が届きました。</p>`;
        actions.innerHTML = `
            <button class="online-btn" onclick="acceptMatch(${count})">承認して開始</button>
            <button class="online-btn secondary" onclick="rejectMatch()">拒否</button>
        `;
    }

    window.acceptMatch = function(count) {
        conn.send({ type: 'ACCEPT_MATCH', count: count });
        startMatch(count);
    };

    window.rejectMatch = function() {
        document.getElementById('match-proposal-overlay').style.display = 'none';
        // 拒否の送信は任意
    };

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
            syncNextPuyos();
        }

        // 盤面送信は renderBoard から行われるため、ループは不要
    }

    function syncNextPuyos() {
        if (typeof nextPuyoColors !== 'undefined') {
            conn.send({ type: 'SYNC_NEXT', nextPuyos: nextPuyoColors });
        }
    }

    window.sendBoardData = function() {
        if (!isMatchActive || !conn) return;
        
        // 盤面データの送信
        if (typeof board !== 'undefined') {
            conn.send({
                type: 'BOARD_UPDATE',
                board: board,
                currentPuyo: typeof currentPuyo !== 'undefined' ? currentPuyo : null,
                gameState: typeof gameState !== 'undefined' ? gameState : 'playing'
            });
        }
    };

    function updateOpponentBoard(oppBoard, oppCurrentPuyo, oppGameState) {
        for (let y = 0; y < 14; y++) {
            for (let x = 0; x < 6; x++) {
                const cell = document.getElementById(`opp-cell-${x}-${y}`);
                if (!cell) continue;
                const puyo = cell.firstChild;
                let color = oppBoard[y][x];
                
                // 操作中のぷよの描画
                if (oppGameState === 'playing' && oppCurrentPuyo) {
                    // 簡易的な座標計算（online.js側で再現）
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

    // 初期化実行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initOnlineUI);
    } else {
        initOnlineUI();
    }
})();
