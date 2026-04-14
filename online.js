/* online.js（入力同期方式 完全版） */
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
    let peerInitializing = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 3;

    // ===== UI =====

    window.showOnlineOverlay = function() {
        const overlay = document.getElementById('online-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
            if (!peerInitialized && !peerInitializing) initPeer();
        }
    };

    window.hideOnlineOverlay = function() {
        const overlay = document.getElementById('online-overlay');
        if (overlay) overlay.style.display = 'none';
    };

    // ===== 接続 =====

    window.connectToOpponent = function() {
        const targetId = document.getElementById('opponent-id-input').value.trim();
        if (!targetId) return alert('相手のIDを入力してください');
        if (!peer || !myId) return alert('Peer未初期化');

        if (conn && conn.open) return alert('既に接続済み');

        document.getElementById('online-status').textContent = '接続中...';
        reconnectAttempts = 0;
        attemptConnection(targetId);
    };

    function attemptConnection(targetId) {
        try {
            conn = peer.connect(targetId);
            setupConnection();
            isHost = false;
        } catch (err) {
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                setTimeout(() => attemptConnection(targetId), 1000);
            } else {
                alert('接続失敗');
            }
        }
    }

    function initPeer() {
        if (peerInitialized || peerInitializing) return;
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
            if (conn && conn.open) return connection.close();
            conn = connection;
            setupConnection();
            isHost = true;
            showMatchProposal();
        });
    }

    function setupConnection() {
        conn.on('open', () => {
            hideOnlineOverlay();
            document.getElementById('online-status').textContent = '接続済み';
            if (isHost) showMatchProposal();
        });

        conn.on('data', handleReceivedData);

        conn.on('close', () => {
            alert('切断されました');
            endMatch();
        });
    }

    // ===== 入力同期 =====

    window.sendInput = function(action) {
        if (!conn || !conn.open || !isMatchActive) return;
        conn.send({
            type: 'INPUT',
            action
        });
    };

    function applyRemoteInput(data) {
        switch(data.action) {
            case 'LEFT': moveLeft(); break;
            case 'RIGHT': moveRight(); break;
            case 'DOWN': softDrop(); break;
            case 'ROTATE': rotate(); break;
            case 'DROP': hardDrop(); break;
        }
    }

    // ===== seed同期 =====

    function generateSeed() {
        return Math.floor(Math.random() * 1e9);
    }

    // ===== 通信受信 =====

    function handleReceivedData(data) {
        switch(data.type) {
            case 'PROPOSE_MATCH':
                showApprovalUI(data.winTarget);
                break;

            case 'ACCEPT_MATCH':
                startMatch(data.winTarget);
                break;

            case 'START_GAME':
                initGameWithSeed(data.seed);
                break;

            case 'INPUT':
                applyRemoteInput(data);
                break;

            case 'GAME_OVER':
                endMatchWithWinner(true);
                break;

            case 'OPPONENT_SURRENDERED':
                showMatchResult('シリーズ勝利！');
                endMatch();
                break;
        }
    }

    // ===== マッチ管理 =====

    window.proposeMatch = function() {
        const count = parseInt(document.getElementById('match-win-target-select').value);
        conn.send({ type: 'PROPOSE_MATCH', winTarget: count });
    };

    window.acceptMatch = function(target) {
        conn.send({ type: 'ACCEPT_MATCH', winTarget: target });
        startMatch(target);
    };

    function startMatch(target) {
        winTarget = target;
        myWins = 0;
        oppWins = 0;
        isMatchActive = true;

        document.getElementById('match-proposal-overlay').style.display = 'none';
        document.body.classList.add('online-match-active');

        ensureSurrenderButton();
        updateWinCountDisplay();

        if (isHost) {
            const seed = generateSeed();
            conn.send({ type: 'START_GAME', seed });
            initGameWithSeed(seed);
        }
    }

    window.notifyGameOver = function() {
        if (conn && conn.open) {
            conn.send({ type: 'GAME_OVER' });
            endMatchWithWinner(false);
        }
    };

    function endMatchWithWinner(iWon) {
        if (iWon) myWins++; else oppWins++;

        updateWinCountDisplay();

        if (myWins >= winTarget) {
            showMatchResult('シリーズ勝利！');
            endMatch();
        } else if (oppWins >= winTarget) {
            showMatchResult('シリーズ敗北...');
            endMatch();
        } else {
            setTimeout(() => {
                resetGame();
                if (isHost) {
                    const seed = generateSeed();
                    conn.send({ type: 'START_GAME', seed });
                    initGameWithSeed(seed);
                }
            }, 1500);
        }
    }

    function endMatch() {
        isMatchActive = false;
        document.body.classList.remove('online-match-active');
    }

    // ===== UI =====

    function updateWinCountDisplay() {
        const el = document.getElementById('win-count-display');
        if (el) el.textContent = `${myWins} - ${oppWins}`;
    }

    function ensureSurrenderButton() {
        let btn = document.getElementById('surrender-button');
        if (!btn) {
            const area = document.getElementById('play-controls');
            if (!area) return;
            btn = document.createElement('button');
            btn.id = 'surrender-button';
            btn.textContent = '降参';
            btn.onclick = window.surrenderMatch;
            area.appendChild(btn);
        }
        btn.style.display = 'block';
    }

    window.surrenderMatch = function() {
        if (!isMatchActive) return;
        if (confirm('降参しますか？')) {
            conn.send({ type: 'OPPONENT_SURRENDERED' });
            showMatchResult('シリーズ敗北...');
            endMatch();
        }
    };

    function showMatchProposal() {
        const overlay = document.getElementById('match-proposal-overlay');
        overlay.style.display = 'flex';
        document.getElementById('proposal-content').innerHTML = `
            <select id="match-win-target-select">
                ${[1,2,3,4,5].map(n => `<option value="${n}">${n}本</option>`)}
            </select>
        `;
        document.getElementById('proposal-actions').innerHTML =
            `<button onclick="proposeMatch()">送信</button>`;
    }

    function showApprovalUI(target) {
        const overlay = document.getElementById('match-proposal-overlay');
        overlay.style.display = 'flex';
        document.getElementById('proposal-content').innerHTML =
            `${target}本先取の対戦`;
        document.getElementById('proposal-actions').innerHTML =
            `<button onclick="acceptMatch(${target})">開始</button>`;
    }

    function showMatchResult(msg) {
        const overlay = document.getElementById('match-result-overlay');
        overlay.style.display = 'flex';
        document.getElementById('result-content').innerHTML =
            `${msg}<br>${myWins} - ${oppWins}`;
    }

    // ===== 初期化 =====

    function autoInitPeer() {
        if (!peerInitialized && !peerInitializing) initPeer();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInitPeer);
    } else {
        autoInitPeer();
    }

})();
