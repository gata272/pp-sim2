/* online.js  安定版 */

(function(){

let peer=null;
let conn=null;
let isHost=false;

let winTarget=0;
let myWins=0;
let oppWins=0;

let matchActive=false;

function send(type,data={}){
 if(!conn||!conn.open) return;
 conn.send({type,...data});
}

function startRound(){

 if(window.resetGame) resetGame();

 setTimeout(()=>{
  if(isHost) syncNext();
 },200);

}

function syncNext(){

 if(typeof nextQueue==="undefined") return;

 send("SYNC_NEXT",{
  next:nextQueue
 });

}

window.setNextPuyos=function(newNext){

 if(typeof nextQueue!=="undefined"){

  nextQueue=JSON.parse(JSON.stringify(newNext));
  queueIndex=0;

 }

};

window.sendBoardData=function(){

 if(!matchActive) return;

 send("BOARD_UPDATE",{

  board:board,
  currentPuyo:currentPuyo,
  score:score,
  chainCount:chainCount,
  state:gameState

 });

};

window.notifyGameOver=function(){

 if(!matchActive) return;

 send("PLAYER_LOST");

 endRound(false);

};

function endRound(iWon){

 if(iWon) myWins++;
 else oppWins++;

 updateScore();

 if(myWins>=winTarget){

  showResult("シリーズ勝利");
  endMatch();
  return;

 }

 if(oppWins>=winTarget){

  showResult("シリーズ敗北");
  endMatch();
  return;

 }

 setTimeout(startRound,1500);

}

function updateScore(){

 const el=document.getElementById("win-count-display");
 if(el) el.textContent=`${myWins} - ${oppWins}`;

}

function handleData(d){

 switch(d.type){

 case "SYNC_NEXT":

  setNextPuyos(d.next);
 break;

 case "BOARD_UPDATE":

  updateOpponentBoard(d.board,d.currentPuyo);
 break;

 case "PLAYER_LOST":

  endRound(true);
 break;

 }

}

function startMatch(target){

 winTarget=target;

 myWins=0;
 oppWins=0;

 matchActive=true;

 updateScore();

 startRound();

}

function endMatch(){

 matchActive=false;

}

function updateOpponentBoard(b,p){

 if(!b) return;

 for(let y=0;y<14;y++){
 for(let x=0;x<6;x++){

  const el=document.getElementById(`opp-cell-${x}-${y}`);
  if(!el) continue;

  const puyo=el.firstChild;
  let color=b[y][x];

  if(p){

   if(p.mainX===x&&p.mainY===y) color=p.mainColor;

  }

  puyo.className=`puyo puyo-${color}`;

 }
 }

}

function showResult(text){

 alert(text);

}

})();