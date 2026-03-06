// online.js - PeerJS を使用したオンライン対戦機能

let peer = null;
let myPeerId = null;
let connection = null;
let isInMatch = false;
let matchData = {
    matchCount: 0,
    currentMatch: 0,
    opponentScore: 0,
    opponentChainCount: 0,
    opponentBoard: null
};

// PeerJSの初期化
function initializePeer() {
    if (peer) return;
    
    peer = new Peer({
        config: {
            iceServers: [
                { urls: ['stun:stun.l.google.com:19302'] },
                { urls: ['stun:stun1.l.google.com:19302'] }
            ]
        }
    });
    
    peer.on('open', function(id) {
        myPeerId = id;
        console.log('My Peer ID: ' + id);
        document.getElementById('my-room-id').value = id;
    });
    
    peer.on('connection', function(conn) {
        console.log('Incoming connection from:', conn.peer);
        handleConnection(conn);
    });
    
    peer.on('error', function(err) {
        console.error('Peer error:', err);
        updateOnlineStatus('エラーが発生しました: ' + err.type);
    });
}

// 相手に接続
function connectToOpponent() {
    if (!myPeerId) {
        updateOnlineStatus('まだ初期化中です。少々お待ちください。');
        return;
    }
    
    const opponentId = document.getElementById('opponent-room-id').value.trim();
    if (!opponentId) {
        updateOnlineStatus('相手のIDを入力してください。');
        return;
    }
    
    if (opponentId === myPeerId) {
        updateOnlineStatus('自分自身のIDは指定できません。');
        return;
    }
    
    updateOnlineStatus('接続中...');
    connection = peer.connect(opponentId);
    handleConnection(connection);
}

// 接続を処理
function handleConnection(conn) {
    connection = conn;
    
    connection.on('open', function() {
        console.log('Connection established with:', conn.peer);
        updateOnlineStatus('相手と接続しました。試合数を提案してください。');
        
        // 接続成功時、対戦準備UIを表示
        showMatchProposalUI();
    });
    
    connection.on('data', function(data) {
        console.log('Received data:', data);
        handleReceivedData(data);
    });
    
    connection.on('close', function() {
        console.log('Connection closed');
        updateOnlineStatus('相手との接続が切断されました。');
        isInMatch = false;
        closeMatchUI();
    });
    
    connection.on('error', function(err) {
        console.error('Connection error:', err);
        updateOnlineStatus('接続エラー: ' + err);
    });
}

// 受信したデータを処理
function handleReceivedData(data) {
    if (data.type === 'match-proposal') {
        // 試合数の提案を受け取った
        showMatchProposalResponse(data.matchCount);
    } else if (data.type === 'match-start') {
        // 対戦開始
        startMatch(data.matchCount);
    } else if (data.type === 'board-update') {
        // 相手の盤面更新
        updateOpponentBoard(data.board, data.score, data.chainCount);
    } else if (data.type === 'match-end') {
        // 対戦終了
        handleMatchEnd(data);
    }
}

// UIの開閉
function openOnlineOverlay() {
    initializePeer();
    document.getElementById('online-overlay').classList.add('show');
}

function closeOnlineOverlay() {
    document.getElementById('online-overlay').classList.remove('show');
}

// オンラインステータスの更新
function updateOnlineStatus(message) {
    document.getElementById('online-status').textContent = message;
}

// 試合提案UIの表示
function showMatchProposalUI() {
    const content = document.getElementById('online-content');
    content.innerHTML = `
        <div class="online-input-group">
            <label for="match-count-input">試合数を入力:</label>
            <input type="number" id="match-count-input" min="1" max="10" value="3">
        </div>
        <button class="online-button primary" onclick="proposeMatch()">提案する</button>
        <button class="online-button secondary" onclick="closeOnlineOverlay()">キャンセル</button>
        <div class="online-status" id="online-status">試合数を提案してください。</div>
    `;
}

// 試合数を提案
function proposeMatch() {
    const matchCount = parseInt(document.getElementById('match-count-input').value);
    if (isNaN(matchCount) || matchCount < 1) {
        updateOnlineStatus('有効な試合数を入力してください。');
        return;
    }
    
    connection.send({
        type: 'match-proposal',
        matchCount: matchCount
    });
    
    updateOnlineStatus('相手の承認を待機中...');
}

// 試合提案への応答UI
function showMatchProposalResponse(matchCount) {
    const content = document.getElementById('online-content');
    content.innerHTML = `
        <p style="text-align: center; color: #fff;">相手が <strong>${matchCount}</strong> 本の試合を提案しています。</p>
        <button class="online-button primary" onclick="acceptMatch(${matchCount})">承認</button>
        <button class="online-button secondary" onclick="rejectMatch()">拒否</button>
        <div class="online-status" id="online-status">試合数の提案を受け取りました。</div>
    `;
}

// 試合を承認
function acceptMatch(matchCount) {
    connection.send({
        type: 'match-start',
        matchCount: matchCount
    });
    
    startMatch(matchCount);
}

// 試合を拒否
function rejectMatch() {
    updateOnlineStatus('試合を拒否しました。');
    showMatchProposalUI();
}

// 対戦開始
function startMatch(matchCount) {
    console.log('Match started! Total matches:', matchCount);
    isInMatch = true;
    matchData.matchCount = matchCount;
    matchData.currentMatch = 1;
    
    // UI切り替え
    closeOnlineOverlay();
    
    // 対戦中のUI設定
    applyMatchUIChanges();
    
    // ゲームをリセット
    resetGame();
    
    // 自動落下をONに
    autoDropEnabled = true;
    updateUI();
    
    // 連鎖速度をデフォルトに
    gravityWaitTime = 300;
    chainWaitTime = 300;
    document.getElementById('gravity-wait-value').textContent = '300ms';
    document.getElementById('chain-wait-value').textContent = '300ms';
    
    updateOnlineStatus(`対戦開始! (${matchData.currentMatch}/${matchCount})`);
}

// 対戦中のUI変更を適用
function applyMatchUIChanges() {
    // シミュレーター特有のボタンを非表示
    document.getElementById('undo-button').style.display = 'none';
    document.getElementById('redo-button').style.display = 'none';
    document.getElementById('raise-puyo-button').style.display = 'none';
    document.getElementById('reset-button-play').style.display = 'none';
    document.querySelector('.mode-toggle-btn').style.display = 'none';
    document.querySelector('.setting-toggle-btn').style.display = 'none';
    document.getElementById('online-button').style.display = 'none';
    
    // 相手の盤面を表示
    document.getElementById('opponent-board-container').classList.add('show');
    
    // 相手の盤面を初期化
    initializeOpponentBoard();
}

// 対戦中のUI変更を戻す
function closeMatchUI() {
    document.getElementById('undo-button').style.display = 'block';
    document.getElementById('redo-button').style.display = 'block';
    document.getElementById('raise-puyo-button').style.display = 'block';
    document.getElementById('reset-button-play').style.display = 'block';
    document.querySelector('.mode-toggle-btn').style.display = 'block';
    document.querySelector('.setting-toggle-btn').style.display = 'block';
    document.getElementById('online-button').style.display = 'block';
    
    document.getElementById('opponent-board-container').classList.remove('show');
}

// 相手の盤面を初期化
function initializeOpponentBoard() {
    const boardElement = document.getElementById('opponent-board');
    boardElement.innerHTML = '';
    
    for (let y = HEIGHT - 1; y >= 0; y--) {
        for (let x = 0; x < WIDTH; x++) {
            const cell = document.createElement('div');
            cell.id = `opponent-cell-${x}-${y}`;
            
            const puyo = document.createElement('div');
            puyo.className = 'puyo puyo-0';
            puyo.setAttribute('data-color', 0);
            
            cell.appendChild(puyo);
            boardElement.appendChild(cell);
        }
    }
}

// 相手の盤面を更新
function updateOpponentBoard(board, score, chainCount) {
    if (!board) return;
    
    matchData.opponentScore = score;
    matchData.opponentChainCount = chainCount;
    
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const color = board[y][x];
            const cellId = `opponent-cell-${x}-${y}`;
            const cell = document.getElementById(cellId);
            
            if (cell) {
                const puyo = cell.querySelector('.puyo');
                puyo.className = `puyo puyo-${color}`;
                puyo.setAttribute('data-color', color);
            }
        }
    }
}

// 自分の盤面を相手に送信
function sendBoardUpdate() {
    if (!isInMatch || !connection) return;
    
    connection.send({
        type: 'board-update',
        board: board,
        score: score,
        chainCount: chainCount
    });
}

// 対戦終了を処理
function handleMatchEnd(data) {
    console.log('Match ended. Result:', data);
    
    // 次の試合へ
    if (matchData.currentMatch < matchData.matchCount) {
        matchData.currentMatch++;
        setTimeout(() => {
            startMatch(matchData.matchCount);
        }, 2000);
    } else {
        // 全試合終了
        isInMatch = false;
        closeMatchUI();
        updateOnlineStatus('全試合が終了しました。');
    }
}

// ゲーム終了時に相手に通知
function notifyMatchEnd() {
    if (!isInMatch || !connection) return;
    
    connection.send({
        type: 'match-end',
        finalScore: score,
        finalChainCount: chainCount
    });
}

// 初期化
window.addEventListener('DOMContentLoaded', function() {
    console.log('Online module loaded');
    // onlineボタンのイベントリスナーを確実に登録
    const onlineBtn = document.getElementById('online-button');
    if (onlineBtn) {
        onlineBtn.onclick = openOnlineOverlay;
    }
});