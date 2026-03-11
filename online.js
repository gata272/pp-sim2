/* online.js (最終修正版: 既存UI完全保護・おじゃまぷよ・相殺・自動移行対応) */
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

    // UI初期化：既存のHTMLを一切破壊せず、必要な要素のみを追加する
    function initOnlineUI() {
        // オーバーレイ（オンライン設定用）
        if (!document.getElementById('online-overlay')) {
            const overlay = document.createElement('div');
            overlay.id = 'online-overlay';
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: none; justify-content: center; align-items: center; z-index: 10000;';
            overlay.innerHTML = `
                <div style="background: #222; padding: 20px; border-radius: 10px; border: 1px solid #444; width: 300px; text-align: center; color: white;">
                    <h2 style="margin-bottom: 15px;">オンライン対戦</h2>
                    <div id="online-status" style="margin-bottom: 10px; font-size: 0.9em; color: #aaa;">PeerJSを初期化中...</div>
                    <div id="my-id-display" style="margin-bottom: 15px; font-size: 0.8em; color: #888;">あなたのID: <span id="my-peer-id" style="color: #fff; font-weight: bold;">----</span></div>
                    <input type="text" id="opponent-id-input" placeholder="相手のIDを入力" style="width: 100%; padding: 8px; margin-bottom: 10px; background: #333; color: white; border: 1px solid #555; border-radius: 4px;">
                    <button onclick="connectToOpponent()" style="width: 100%; padding: 10px; margin-bottom: 10px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;">接続する</button>
                    <button onclick="hideOnlineOverlay()" style="width: 100%; padding: 10px; background: #444; color: white; border: none; border-radius: 4px; cursor: pointer;">キャンセル</button>
                </div>
            `;
            document.body.appendChild(overlay);
        }

        // 試合提案オーバーレイ
        if (!document.getElementById('match-proposal-overlay')) {
            const proposalOverlay = document.createElement('div');
            proposalOverlay.id = 'match-proposal-overlay';
            proposalOverlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: none; justify-content: center; align-items: center; z-index: 10001;';
            proposalOverlay.innerHTML = `
                <div style="background: #222; padding: 20px; border-radius: 10px; border: 1px solid #444; width: 300px; text-align: center; color: white;">
                    <h2 id="proposal-title" style="margin-bottom: 15px;">対戦の提案</h2>
                    <div id="proposal-content" style="margin-bottom: 20px;"></div>
                    <div id="proposal-actions"></div>
                </div>
            `;
            document.body.appendChild(proposalOverlay);
        }

        // 情報パネルへのおじゃま表示追加
        const infoPanel = document.getElementById('info-panel');
        if (infoPanel && !document.getElementById('online-stats-container')) {
            const statsContainer = document.createElement('div');
            statsContainer.id = 'online-stats-container';
            statsContainer.style.cssText = 'margin-top: 15px; padding-top: 15px; border-top: 1px solid #444;';
            statsContainer.innerHTML = `
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span style="font-size: 0.8em; color: #aaa;">勝利数</span>
                    <span id="win-count-display" style="font-weight: bold; color: #f1c40f;">0 - 0</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
                    <span style="font-size: 0.8em; color: #aaa;">おじゃま</span>
                    <span id="my-garbage-stack" style="font-weight: bold; color: #e74c3c;">0</span>
                </div>
                <div id="opponent-section">
                    <h3 style="font-size: 0.8em; color: #aaa; margin-bottom: 5px; text-align: center;">相手の盤面</h3>
                    <div id="opponent-board" style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 1px; background: #333; border: 1px solid #444; width: 120px; height: 280px; margin: 0 auto;"></div>
                    <div style="text-align: center; margin-top: 5px;">
                        <span style="font-size: 0.7em; color: #aaa;">相手のおじゃま: </span>
                        <span id="opp-garbage-stack" style="font-weight: bold; color: #e74c3c; font-size: 0.8em;">0</span>
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
                cell.className = 'opp-cell';
                cell.style.cssText = 'background: #000; position: relative; width: 100%; height: 100%;';
                const puyo = document.createElement('div');
                puyo.className = 'puyo puyo-0';
                puyo.style.cssText = 'width: 100%; height: 100%; border-radius: 50%;';
                cell.appendChild(puyo);
                boardElement.appendChild(cell);
            }
        }
    }

    // イベント登録
    function setupEventListeners() {
        const btn = document.getElementById('online-toggle-btn');
        if (btn) {
            btn.onclick = window.showOnlineOverlay;
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

    // おじゃまぷよ送信
    window.sendGarbage = function(amount) {
        if (conn && conn.open) {
            conn.send({ type: 'RECEIVE_GARBAGE', amount: amount });
        }
    };

    // 盤面データ送信
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

    function handleReceivedData(data) {
        switch(data.type) {
            case 'PROPOSE_MATCH': showApprovalUI(data.winTarget); break;
            case 'ACCEPT_MATCH': startMatch(data.winTarget); break;
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
        }
    }

    function updateWinCountDisplay() {
        const el = document.getElementById('win-count-display');
        if (el) el.textContent = `${myWins} - ${oppWins}`;
    }

    function checkSeriesWinner() {
        if (myWins >= winTarget) {
            alert('シリーズ勝利！');
            isMatchActive = false;
            location.reload();
        } else {
            setTimeout(() => { if (window.resetGame) window.resetGame(); }, 1000);
        }
    }

    window.notifyGameOver = function() {
        if (isMatchActive && conn && conn.open) {
            conn.send({ type: 'OPPONENT_LOST' });
            oppWins++;
            updateWinCountDisplay();
            if (oppWins >= winTarget) {
                alert('シリーズ敗北...');
                isMatchActive = false;
                location.reload();
            } else {
                setTimeout(() => { if (window.resetGame) window.resetGame(); }, 1000);
            }
        }
    };

    function updateOpponentBoard(oppBoard, oppCurrentPuyo, oppGameState) {
        const boardEl = document.getElementById('opponent-board');
        if (!boardEl) return;
        const cells = boardEl.querySelectorAll('.opp-cell');
        for (let y = 0; y < 14; y++) {
            for (let x = 0; x < 6; x++) {
                const idx = (13 - y) * 6 + x;
                const puyo = cells[idx].firstChild;
                let color = oppBoard[y][x];
                if (oppGameState === 'playing' && oppCurrentPuyo) {
                    const { mainX, mainY, rotation, mainColor, subColor } = oppCurrentPuyo;
                    let subX = mainX, subY = mainY;
                    if (rotation === 0) subY++; else if (rotation === 1) subX--; else if (rotation === 2) subY--; else if (rotation === 3) subX++;
                    if (x === mainX && y === mainY) color = mainColor;
                    if (x === subX && y === subY) color = subColor;
                }
                // 背景色でぷよの色を表現（簡易版）
                const colors = ['transparent', '#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#888'];
                puyo.style.backgroundColor = colors[color] || 'transparent';
            }
        }
    }

    function initPeer() {
        peer = new Peer();
        peer.on('open', (id) => {
            myId = id;
            peerInitialized = true;
            document.getElementById('my-peer-id').textContent = id;
            document.getElementById('online-status').textContent = '接続待機中...';
        });
        peer.on('connection', (connection) => {
            conn = connection;
            setupConnection();
            isHost = true;
            showMatchProposal();
        });
    }

    function setupConnection() {
        conn.on('open', () => {
            window.hideOnlineOverlay();
            if (isHost) showMatchProposal();
        });
        conn.on('data', handleReceivedData);
    }

    function showMatchProposal() {
        const overlay = document.getElementById('match-proposal-overlay');
        overlay.style.display = 'flex';
        document.getElementById('proposal-content').innerHTML = `
            <p>何本先取にしますか？</p>
            <select id="win-target-select" style="width: 100%; padding: 8px; margin-top: 10px; background: #333; color: white; border: 1px solid #555;">
                <option value="1">1本先取</option>
                <option value="2">2本先取</option>
                <option value="3" selected>3本先取</option>
                <option value="5">5本先取</option>
            </select>
        `;
        document.getElementById('proposal-actions').innerHTML = `<button onclick="proposeMatch()" style="width: 100%; padding: 10px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;">提案を送る</button>`;
    }

    window.proposeMatch = function() {
        const target = parseInt(document.getElementById('win-target-select').value);
        conn.send({ type: 'PROPOSE_MATCH', winTarget: target });
        document.getElementById('proposal-content').innerHTML = `<p>${target}本先取の提案を送信しました。待機中...</p>`;
        document.getElementById('proposal-actions').innerHTML = '';
    };

    function showApprovalUI(target) {
        const overlay = document.getElementById('match-proposal-overlay');
        overlay.style.display = 'flex';
        document.getElementById('proposal-content').innerHTML = `<p>相手から ${target}本先取 の対戦提案が届きました。</p>`;
        document.getElementById('proposal-actions').innerHTML = `
            <button onclick="acceptMatch(${target})" style="width: 48%; padding: 10px; background: #2ecc71; color: white; border: none; border-radius: 4px; cursor: pointer;">承認</button>
            <button onclick="rejectMatch()" style="width: 48%; padding: 10px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer;">拒否</button>
        `;
    }

    window.acceptMatch = function(target) {
        conn.send({ type: 'ACCEPT_MATCH', winTarget: target });
        startMatch(target);
    };

    window.rejectMatch = function() {
        document.getElementById('match-proposal-overlay').style.display = 'none';
    };

    function startMatch(target) {
        winTarget = target;
        myWins = 0; oppWins = 0;
        isMatchActive = true;
        document.getElementById('match-proposal-overlay').style.display = 'none';
        updateWinCountDisplay();
        if (window.resetGame) window.resetGame();
    }

    window.connectToOpponent = function() {
        const targetId = document.getElementById('opponent-id-input').value.trim();
        if (!targetId) return;
        conn = peer.connect(targetId);
        setupConnection();
        isHost = false;
    };

    // 初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { initOnlineUI(); setupEventListeners(); });
    } else {
        initOnlineUI(); setupEventListeners();
    }
})();
